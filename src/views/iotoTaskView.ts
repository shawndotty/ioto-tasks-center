/**
 * `IOTOTask`：把任务笔记（.md）以「Section → Block → 任务卡片」呈现的视图。
 *
 * 之所以用 `TextFileView` 而不是 `ItemView`：`TextFileView → EditableFileView → FileView`，
 * `FileView.file` 会被设置，`workspace.getActiveFile()` 因此能返回该任务文件 —— 这是
 * ioto-settings「AI 执行任务」主链路（resolveActiveFile → isTaskNote → vault.process）
 * 照常工作的前提（见 [[Research-20261002-192145]] 第二节）。
 *
 * v1 只读；本期（[[Plan-20261003-073911]]）增加行级编辑：
 * - 3a 勾选：点 checkbox ↔ 行内 `[ ]` / `[x]`（单行 `vault.process`，乐观更新）；
 * - 3b 卡片正文内联编辑：借用核心编辑器（`embedded-editor.ts`），失焦提交；
 * - 3c `Enter` 新建同级 / 空卡片 `Backspace` 删除 / `Tab` `Shift+Tab` 缩进 / `Esc` 取消。
 *
 * 交互（[[Plan-20261003-194909]]）：`idle → selected → editing` 显式状态机。
 * 单击 = 选中，再点 / `Enter` = 编辑，`Esc` = 先提交再落回本卡选择态，
 * 选择态 `↑`/`↓` 增量移动选择、`Delete`/`Backspace` 只删当前行。
 * 选中态用 `selectedLine` 承载且**不持久化**，但整树重建后由 `syncSelectionClass` 回填。
 *
 * 🔴 红线：写盘成功后必须同步 `this.data` 与 `this.lastLoadedText`，否则 `getViewData()`
 * 会返回过期字节，`TextFileView` 的保存路径会把用户的编辑写回去。编辑期间用
 * `editingLine` 抑制位挡住外部写入触发的重绘，避免编辑器被冲掉。
 */

import type { EditorView } from '@codemirror/view';
import {
	Keymap,
	MarkdownRenderer,
	Notice,
	Platform,
	setIcon,
	TextFileView,
	type App,
	type HoverPopover,
	type PaneType,
	type TFile,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import { t } from '../lang/helpter';
import {
	buildExportFileName,
	canvasToBlob,
	captureTaskViewCanvas,
	clampExportScale,
	composeExportFooter,
	composeExportHeader,
	copyCanvasToClipboard,
	readableTextColor,
	saveCanvasToVault,
	resolveExportBackground,
} from '../export';
import type {
	TaskViewAppearanceStyle,
	TaskViewExportOptions,
} from '../settings';
import {
	readBooleanProperty,
	readScalarProperty,
	writeScalarProperties,
} from '../tasks-center/frontmatter-properties';
import {
	buildSiblingTaskLine,
	buildTasksSectionHeading,
	buildTopLevelTaskLine,
	continuationIndentForTaskLine,
	dedentLines,
	findSectionByTitle,
	indentContinuationLines,
	indentLevelOf,
	insertSoftBreak,
	isTaskContinuationLine,
	parentIndentLevelOfTaskLine,
	parseChecklistItems,
	parseSections,
	replaceTaskBody,
	setTaskIndent,
	SOFT_BREAK,
	splitTaskLine,
	taskBodyForEditor,
	toggleTaskMarker,
} from '../tasks-center/note-structure';
import { isTemplateAvailableForProject } from '../tasks-center/batch-task-template';
import { extractListPropertyValuesFromContent } from '../tasks-center/task-creation';
import {
	buildEntryTemplateLines,
	extractEntryTemplateVariables,
	renderEntryTemplate,
	type EntryTemplateConfig,
} from '../tasks-center/task-entry-template';
import {
	EntryTemplateSelectModal,
	EntryTemplateVariablesModal,
} from '../ui/entryTemplateModals';
import {
	collectCardLines,
	pickAdjacentLine,
	pickEdgeLine,
	pickLineAfterDelete,
} from './ioto-task/card-navigation';
import {
	commitTaskContinuation,
	commitTaskLineAction,
	commitTaskText,
	type CommitOutcome,
	type TaskLineTransform,
} from './ioto-task/commit-task-line';
import {
	createAutosaveScheduler,
	type AutosaveScheduler,
} from './ioto-task/edit-autosave';
import {
	mountEmbeddedEditor,
	type EmbeddedEditorHandle,
} from './ioto-task/embedded-editor';
import {
	captureIotoTaskScroll,
	restoreIotoTaskScroll,
	IOTO_TASK_CARD_SELECTOR,
	IOTO_TASK_SCROLL_SELECTOR,
} from './ioto-task/ioto-task-scroll';
import {
	captureCardSnapshots,
	prepareSwapTransition,
} from './ioto-task/list-transition';
import {
	getSectionStateKey,
	renderCardActions,
	renderTaskNote,
	type TaskNoteEditing,
	type TaskNoteFilters,
	type TaskNoteLinks,
} from './ioto-task/render-note';
import { applySearchHighlight } from './ioto-task/search-highlight';
import { normalizeQuery } from './ioto-task/task-query-filter';
import type { ModEnterHost } from './ioto-task/select-mode-scope';
import type { SearchHost } from './ioto-task/search-scope';
import {
	IOTO_TASK_VIEW_HOVER_SOURCE_ID,
	type TaskHoverPreviewPayload,
} from './task-hover-preview';
import { IOTO_TASK_VIEW_TYPE } from './ioto-task/item-control-bridge';

export { IOTO_TASK_VIEW_TYPE };

/** 自动落盘窗口：与核心 2000ms 对齐；移动端 I/O 与电量敏感，放宽一档。 */
const AUTOSAVE_INTERVAL_MS = Platform.isMobile ? 4000 : 2000;

/** 关键词实时过滤的输入 debounce（[[Discuss-20261006-160043]] §六 Q2）。 */
const SEARCH_DEBOUNCE_MS = 200;

/** 过滤开关的 frontmatter 属性名（唯一真源，[[Plan-20261004-110845]] §二.1）。 */
const PROPERTY_ONLY_TASK_BLOCKS = 'iotoTaskViewOnlyTaskBlocks';
const PROPERTY_ONLY_PENDING = 'iotoTaskViewOnlyPending';
const PROPERTY_RECENT_ONLY = 'iotoTaskViewRecentOnly';

/**
 * 过滤开关 → frontmatter 属性名映射（`toggleFilter` 的写盘真源）。
 * 开关新增时只需在此登记，写盘 / 补齐逻辑自动覆盖（[[Plan-20261005-101007]] §2.7）。
 */
const FILTER_PROPERTY_NAMES: Record<keyof TaskNoteFilters, string> = {
	onlyTaskBlocks: PROPERTY_ONLY_TASK_BLOCKS,
	onlyPending: PROPERTY_ONLY_PENDING,
	recentOnly: PROPERTY_RECENT_ONLY,
};

/** ③「执行任务」由 ioto-settings 注册的命令 ID（按钮只派发，粒度交给对方）。 */
const RUN_TASK_COMMAND_ID = 'ioto-settings:ioto-run-task';

/** 卡片动作区「插入出链」按钮派发的命令 ID（[[Plan-20261005-111411]] §三 步骤 4）。 */
const INSERT_OUTGOING_LINK_COMMAND_ID =
	'ioto-settings:ioto-insert-outgoing-link';

/** 卡片动作区「编辑条目控制」按钮派发的命令 ID（同上）。 */
const EDIT_ITEM_CONTROLS_COMMAND_ID = 'ioto-settings:ioto-edit-item-controls';

/**
 * 命令就绪补偿轮询间隔（[[Research-20261008-122828]] 方案 A）。
 *
 * ioto-settings 在 `onload` 后固定延迟 1s 才注册上述两条命令；视图若落在这 1s
 * 窗口内渲染，前两个动作按钮会因命令缺位而不被创建，且此后不重绘就一直残缺。
 */
const COMMAND_READINESS_POLL_MS = 120;

/** 命令就绪补偿等待上限：超时保持隐藏（ioto-settings 未启用时的既有语义）。 */
const COMMAND_READINESS_TIMEOUT_MS = 5000;

/** `app.commands` 的最小可判定形状（照抄 task-creation.ts 的 `CommandRegistryLike` 口径）。 */
interface CommandRegistryLike {
	executeCommandById?: (commandId: string) => unknown;
	commands?: Record<string, unknown>;
}

/**
 * 工具栏按钮 `click` 回调拿到的指针上下文（[[Discuss-20261007-062838]] §三.②）。
 * `shiftKey` 只在**真实指针**按下时为真，键盘激活合成的 click 恒为 false。
 */
interface ToolbarButtonClickContext {
	shiftKey: boolean;
}

/** IOTOTask 视图供「条目控制」桥接读写当前编辑卡片的宿主（见 item-control-bridge.ts）。 */
export interface ItemControlBridgeHost {
	/** 视图打开的任务文件（必须是真 `TFile`，满足 ioto-settings 的 `instanceof` 判据） */
	file: TFile;
	/** 当前内联编辑行的 0 基**文件行号**（面板据此定位，不是卡片内的相对行号） */
	line: number;
	/** 打开编辑时的原始整行（写回时的冲突二次定位基线） */
	originalLine: string;
	/** 面板要读的整行：磁盘行 + 未提交的 CM 正文合成（`replaceTaskBody`） */
	readBridgeLine(): string;
	/** 除编辑行外的其它行按磁盘内容返回 */
	readDiskLine(line: number): string;
	/** 面板确认后的新整行 → 落盘并同步 `data` / `lastLoadedText` / `editingOriginalLine` */
	commitBridgeLine(nextLine: string): Promise<CommitOutcome>;
	/** 供面板定位：该行卡片的视口坐标 */
	getLineCoords(line: number): {
		top: number;
		left: number;
		bottom: number;
		right: number;
	};
	/** 视图滚动容器宽度（面板用它约束自身宽度） */
	getScrollWidth(): number;
}

export class IOTOTaskView extends TextFileView {
	private collapsedSections = new Set<string>();
	private lastLoadedText = '';
	private isRendering = false;
	/**
	 * 命令就绪补偿计时器句柄（[[Research-20261008-122828]] 方案 A）：`null` = 无在途
	 * 轮询。渲染时若 ioto-settings 两条命令尚未注册，则挂一趟短轮询，命令一旦出现就
	 * 对全部卡补建动作按钮；命令齐 / 超时即自停，连续重绘共用同一趟、不叠加。
	 */
	private commandReadinessTimer: number | null = null;
	private editingLine: number | null = null;
	/**
	 * 聚焦放大态的文件行号（0 基）；非放大 `null`。**瞬态**：不进 `getState`，
	 * 且在退出编辑 / 换文件 / 清空时解除（[[Discuss-20261008-111641]] §2.5）。
	 */
	private zoomLine: number | null = null;
	/**
	 * 选择态行号（[[Plan-20261003-194909]] §四）。
	 *
	 * `idle → selected → editing` 显式状态机的载体：**同一时刻只有一张卡片被选中**，
	 * 且 `selected` 是 `editing` 的前置态。按拍板结论**不持久化**（不进 `getState`），
	 * 但必须**可重建**——任何整树重建（折叠 / 删除 / 外部写入）后由 `syncSelectionClass` 回填。
	 */
	private selectedLine: number | null = null;
	/**
	 * 待删除确认中的文件行号（0 基）；非 pending 为 `null`。选择态**瞬态子状态**，
	 * 不持久化，也不引入第四个大状态（[[Plan-20261005-141853]] §三）。
	 *
	 * 它是唯一真源；同一时刻最多一个遮罩，`pendingDeleteEl` 只是它的 DOM 影子。
	 */
	private pendingDeleteLine: number | null = null;
	/** 当前遮罩元素（回收用）；与 `pendingDeleteLine` 同生共死。 */
	private pendingDeleteEl: HTMLElement | null = null;
	/**
	 * 进出场动画自增令牌：新一次渲染 / 收尾立即作废上一场的异步 rAF 回调
	 * （[[Plan-20261005-150106]] 坑 6，避免连续增删叠影）。
	 */
	private listTransitionToken = 0;
	/** 上一场动画的收尾函数（移除浮层、清临时类与 inline transform）。 */
	private listTransitionCleanup: (() => void) | null = null;
	private editingOriginalLine = '';
	private editingHandle: EmbeddedEditorHandle | null = null;
	/**
	 * 续行编辑态：拥有该续行的任务行（0 基文件行号）；非编辑态为 `null`。
	 * 与 `editingLine`（标题编辑器）互斥，进入任一方前先提交另一方。
	 */
	private continuationLine: number | null = null;
	private continuationStartLine = 0;
	private continuationEndLine = 0;
	private continuationOriginalLines: string[] = [];
	private continuationHandle: EmbeddedEditorHandle | null = null;
	/** 当前续行编辑器的宿主 div（`destroy()` 只 empty 不 remove，需在此显式回收） */
	private continuationHostEl: HTMLElement | null = null;
	/** 本次续行编辑器是否为「新建草稿」（磁盘上尚无该续行块）：空草稿不落盘、不走自动落盘。 */
	private continuationIsNew = false;
	/** 新建草稿时临时创建的 `.card-continuation` 容器（回收用；复用既有容器时为 `null`）。 */
	private continuationDraftContainerEl: HTMLElement | null = null;
	private pendingCommit: Promise<void> | null = null;
	/** 自动落盘节流器（视图级单例，编辑期间复用） */
	private readonly autosave: AutosaveScheduler = createAutosaveScheduler(
		() => {
			void this.autosaveEdit();
		},
		AUTOSAVE_INTERVAL_MS,
	);
	/** 自动落盘进行中：与 `pendingCommit`（blur 提交）互斥，避免并发写同一行 */
	private autosaveRunning = false;
	/**
	 * 外部写回窗口（[[Research-20261008-105532]] 方案 A）：Templater 等命令运行期
	 * 挂起 blur 销毁，使事后的 `replaceSelection` 落在活编辑器上。
	 */
	private externalWritebackActive = false;
	/** 窗口内是否发生过 blur（换视图等）→ 结束后据此补一次提交退出编辑态。 */
	private externalWritebackBlurred = false;
	/** 窗口内文档是否变更（模板写回）→ 结束后据此补一次提交（无 blur 也要落盘）。 */
	private externalWritebackDirty = false;
	private readonly supportsInlineEdit: () => boolean;
	private readonly appearanceStyleProvider: () => TaskViewAppearanceStyle;
	private readonly recentTaskCountProvider: () => number;
	private readonly exportOptionsProvider: () => TaskViewExportOptions;
	/** 条目模板配置（只读快照，触发时取一次）。 */
	private readonly entryTemplateProvider: () => EntryTemplateConfig;
	/** 桌面端是否显示工具栏「删除」按钮（移动端恒显示，见 `refreshDeleteButtonVisibility`）。 */
	private readonly deleteButtonOnDesktopProvider: () => boolean;
	/**
	 * 导出重入锁（[[Plan-20261006-102142]] §三.6）：克隆几百张卡 + 内联样式可能耗时数秒，
	 * 期间禁止重复触发（工具栏连点 / 命令面板重入）。
	 */
	private isExporting = false;
	/**
	 * 视图级稳定对象：否则弹窗无法复用 / 关闭
	 * （与 `iotoTasksCenterView` 同一口径，[[Plan-20261004-004408]] §3.2 ④）。
	 */
	private readonly hoverPreviewParent: { hoverPopover: HoverPopover | null } =
		{
			hoverPopover: null,
		};
	/**
	 * 顶部固定控制栏（[[Plan-20261004-110845]] 批次 A）：`__toolbar` + `__body` 是
	 * 常驻外壳，`renderNote` 只重建 `__body` 内容，栏不随列表滚动、重绘不闪。
	 */
	private toolbarEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private toggleTaskBlocksEl: HTMLButtonElement | null = null;
	private togglePendingEl: HTMLButtonElement | null = null;
	private toggleRecentEl: HTMLButtonElement | null = null;
	private runTaskEl: HTMLButtonElement | null = null;
	private addTaskEl: HTMLButtonElement | null = null;
	/** 工具栏「删除」入口（[[Plan-20261007-194826]]）：仅在有选中卡且未编辑时可见。 */
	private deleteTaskEl: HTMLButtonElement | null = null;
	/**
	 * 搜索关键词：**瞬态**，不进 `getState` / 不写 frontmatter / 关闭即归零
	 * （[[Plan-20261006-161121]] §2.3a、§三.3）。
	 */
	private searchQuery = '';
	private searchBarEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;
	private searchPrevEl: HTMLButtonElement | null = null;
	private searchNextEl: HTMLButtonElement | null = null;
	private searchDebounce: number | null = null;
	/** 过滤开关运行态：**每次 renderNote 从 `this.data`（frontmatter）重读**，不持久化。 */
	private filters: TaskNoteFilters = {
		onlyTaskBlocks: false,
		onlyPending: false,
		recentOnly: false,
	};

	constructor(
		leaf: WorkspaceLeaf,
		supportsInlineEdit: () => boolean,
		appearanceStyleProvider: () => TaskViewAppearanceStyle,
		recentTaskCountProvider: () => number,
		exportOptionsProvider: () => TaskViewExportOptions,
		entryTemplateProvider: () => EntryTemplateConfig,
		deleteButtonOnDesktopProvider: () => boolean,
	) {
		super(leaf);
		this.allowNoFile = false;
		this.supportsInlineEdit = supportsInlineEdit;
		this.appearanceStyleProvider = appearanceStyleProvider;
		this.recentTaskCountProvider = recentTaskCountProvider;
		this.exportOptionsProvider = exportOptionsProvider;
		this.entryTemplateProvider = entryTemplateProvider;
		this.deleteButtonOnDesktopProvider = deleteButtonOnDesktopProvider;
	}

	getViewType(): string {
		return IOTO_TASK_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.basename ?? t('view.iotoTaskView.fallbackTitle');
	}

	getIcon(): string {
		return 'list-todo';
	}

	getViewData(): string {
		return this.data;
	}

	setViewData(data: string, clear: boolean): void {
		if (clear) {
			this.clear();
		}

		this.data = data;
		this.lastLoadedText = data;
		this.zoomLine = null;
		this.renderNote(data);
	}

	clear(): void {
		this.destroyActiveEditor();
		this.destroyContinuationEditor();
		this.editingLine = null;
		this.zoomLine = null;
		this.continuationLine = null;
		this.continuationOriginalLines = [];
		this.selectedLine = null;
		this.editingOriginalLine = '';
		this.cancelPendingDelete(false);
		this.resetSearchState();
		// 保留常驻外壳（toolbar / body），只清列表内容。
		this.bodyEl?.empty();
		this.filters = {
			onlyTaskBlocks: false,
			onlyPending: false,
			recentOnly: false,
		};
		this.refreshToolbarState();
		this.data = '';
		this.lastLoadedText = '';
		this.collapsedSections.clear();
	}

	onunload(): void {
		this.destroyActiveEditor();
		this.destroyContinuationEditor();
		this.resetSearchState();
		this.clearCommandReadinessTimer();
		this.autosave.dispose();
		super.onunload();
	}

	async onClose(): Promise<void> {
		// 视图销毁后 debounce 回调不得再触发（[[Plan-20261006-161121]] §2.3f）。
		this.resetSearchState();
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			collapsedSections: [...this.collapsedSections],
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === 'object') {
			const collapsed = (state as { collapsedSections?: unknown })
				.collapsedSections;
			if (Array.isArray(collapsed)) {
				this.collapsedSections = new Set(
					collapsed.filter(
						(key): key is string => typeof key === 'string',
					),
				);
			}
		}

		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('ioto-task-view');
		// 按设置挂 / 去外观风格类（玻璃 `.is-glass` / 现代 `.is-modern` / 简洁 `.is-simple` / 莫兰迪 `.is-morandi`），
		// 保证打开即应用当前外观（[[Plan-20261003-215547]] §7.1、[[Plan-20261005-200436]]、[[Plan-20261007-063658]]）。
		this.applyAppearanceStyle();
		// 常驻控制栏 + 列表容器（批次 A）：栏固定，renderNote 只重建 body。
		this.buildToolbar();

		// 外部写入（含 Phase 2 的 AI 回写）→ 重读重绘；编辑期间由 editingLine 抑制。
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (!this.file || file.path !== this.file.path) {
					return;
				}
				void this.reloadFromVault();
			}),
		);
	}

	/* ------------------------------------------------------------------ *
	 * 顶部控制栏（[[Plan-20261004-110845]] 批次 A）
	 * ------------------------------------------------------------------ */

	/** 建常驻外壳：`__toolbar`（固定）+ `__body`（可滚）。幂等，重绘不重建。 */
	private buildToolbar(): void {
		if (
			this.toolbarEl?.isConnected &&
			this.bodyEl?.isConnected
		) {
			return;
		}

		const toolbarEl = this.contentEl.createDiv({
			cls: 'ioto-task-view__toolbar',
		});
		const leftEl = toolbarEl.createDiv({
			cls: 'ioto-task-view__toolbar-left',
		});
		const rightEl = toolbarEl.createDiv({
			cls: 'ioto-task-view__toolbar-right',
		});

		this.toggleTaskBlocksEl = this.createToolbarButton(leftEl, {
			cls: 'ioto-task-view__toggle',
			icon: 'list-todo',
			label: t('view.iotoTaskView.toolbar.toggleTaskBlocks'),
			title: t('view.iotoTaskView.toolbar.toggleTaskBlocksTooltip'),
			attr: { 'data-filter': 'task-blocks' },
			onClick: () => {
				void this.toggleFilter('onlyTaskBlocks');
			},
		});
		this.togglePendingEl = this.createToolbarButton(leftEl, {
			cls: 'ioto-task-view__toggle',
			icon: 'circle-check-big',
			label: t('view.iotoTaskView.toolbar.togglePending'),
			title: t('view.iotoTaskView.toolbar.togglePendingTooltip'),
			attr: { 'data-filter': 'pending' },
			onClick: () => {
				void this.toggleFilter('onlyPending');
			},
		});
		// ③ 显示最近任务：每个 Section 只保留末尾 N 个顶级任务（阈值取自设置）。
		this.toggleRecentEl = this.createToolbarButton(leftEl, {
			cls: 'ioto-task-view__toggle',
			icon: 'history',
			label: t('view.iotoTaskView.toolbar.toggleRecent'),
			title: this.recentTaskTitle(),
			attr: { 'data-filter': 'recent' },
			onClick: () => {
				void this.toggleFilter('recentOnly');
			},
		});
		// 删除按钮建在「执行」之前：`toolbar-right` 右锚（`margin-inline-start:auto`），
		// 显隐只改右簇左边界，「执行 / 添加」不平移（[[Plan-20261007-194826]] §六.4）。
		// 初值显隐交给末尾的 `refreshToolbarState()`（建栏时 `selectedLine` 为 null，自动隐藏）。
		this.deleteTaskEl = this.createToolbarButton(rightEl, {
			cls: 'ioto-task-view__action',
			icon: 'trash-2',
			label: t('view.iotoTaskView.toolbar.deleteTask'),
			title: t('view.iotoTaskView.toolbar.deleteTaskTooltip'),
			attr: { 'data-action': 'delete-task' },
			onClick: () => {
				this.requestDeleteSelected();
			},
		});
		this.runTaskEl = this.createToolbarButton(rightEl, {
			cls: 'ioto-task-view__action',
			icon: 'play',
			label: t('view.iotoTaskView.toolbar.runTask'),
			title: t('view.iotoTaskView.toolbar.runTaskTooltip'),
			attr: { 'data-action': 'run-task' },
			onClick: () => {
				void this.runTask();
			},
		});
		this.addTaskEl = this.createToolbarButton(rightEl, {
			cls: 'ioto-task-view__action',
			icon: 'plus',
			label: t('view.iotoTaskView.toolbar.addTask'),
			title: this.addTaskTooltip(),
			attr: { 'data-action': 'add-task' },
			onClick: (context) => {
				this.triggerAddTask(context);
			},
		});

		// DOM 顺序固定 `__toolbar` → `__searchbar` → `__body`（[[Plan-20261006-161121]] §2.3b）。
		const searchbarEl = this.contentEl.createDiv({
			cls: 'ioto-task-view__searchbar is-hidden',
		});
		this.searchInputEl = searchbarEl.createEl('input', {
			cls: 'ioto-task-view__search-input',
			attr: {
				type: 'search',
				placeholder: t('view.iotoTaskView.search.placeholder'),
				'aria-label': t('view.iotoTaskView.search.placeholder'),
			},
		});
		const searchActionsEl = searchbarEl.createDiv({
			cls: 'ioto-task-view__search-actions',
		});
		this.searchPrevEl = this.createSearchButton(searchActionsEl, {
			icon: 'chevron-up',
			label: t('view.iotoTaskView.search.prev'),
			action: 'search-prev',
			onClick: () => this.stepMatch(-1),
		});
		this.searchNextEl = this.createSearchButton(searchActionsEl, {
			icon: 'chevron-down',
			label: t('view.iotoTaskView.search.next'),
			action: 'search-next',
			onClick: () => this.stepMatch(1),
		});
		this.createSearchButton(searchActionsEl, {
			icon: 'x',
			label: t('view.iotoTaskView.search.close'),
			action: 'search-close',
			onClick: () => this.closeSearch(),
		});
		this.searchBarEl = searchbarEl;

		const input = this.searchInputEl;
		input.addEventListener('input', () => this.onSearchInput());
		input.addEventListener('keydown', (event) => {
			if (event.isComposing) {
				return; // IME 组字放行
			}
			if (event.key === 'Enter') {
				// Enter = 下一个 / Shift+Enter = 上一个（对齐核心查找条）
				event.preventDefault();
				this.stepMatch(event.shiftKey ? -1 : 1);
				return;
			}
			if (event.key === 'Escape') {
				// Esc = 关闭 + 清空（Q5）
				event.preventDefault();
				this.closeSearch();
			}
		});

		this.bodyEl = this.contentEl.createDiv({ cls: 'ioto-task-view__body' });
		this.toolbarEl = toolbarEl;
		this.refreshToolbarState();
		this.refreshSearchNavState();
	}

	private createToolbarButton(
		parentEl: HTMLElement,
		options: {
			cls: string;
			icon: string;
			label: string;
			title: string;
			attr: Record<string, string>;
			onClick: (context: ToolbarButtonClickContext) => void;
		},
	): HTMLButtonElement {
		const btn = parentEl.createEl('button', {
			cls: options.cls,
			attr: {
				type: 'button',
				'aria-label': options.label,
				title: options.title,
				...options.attr,
			},
		});
		const iconEl = btn.createSpan({
			cls: 'ioto-task-view__toolbar-icon',
		});
		setIcon(iconEl, options.icon);
		btn.createSpan({
			cls: 'ioto-task-view__toolbar-label',
			text: options.label,
		});
		/**
		 * 真实指针按下时采样一次 Shift（[[Discuss-20261007-062838]] §三.②）：
		 * 按钮被聚焦后 Shift+Enter / Shift+Space 也会激活它，合成的 `click` 同样带
		 * `shiftKey === true` —— 但不会先派发 `pointerdown`，以此只认真实指针。
		 */
		let pressedShift = false;
		btn.addEventListener('pointerdown', (event) => {
			pressedShift = event.shiftKey;
		});
		btn.addEventListener('click', (event) => {
			event.preventDefault();
			// `detail > 0` 为兜底：键盘合成的 click 恒为 0（同 §三.② 备选判据）。
			const shiftKey = pressedShift && event.detail > 0;
			pressedShift = false;
			options.onClick({ shiftKey });
		});
		return btn;
	}

	/**
	 * 搜索条图标按钮（照 `createToolbarButton` 裁剪的纯图标版）：
	 * 可见内容为图标，`label` 只进 `aria-label` / `title`（[[Plan-20261006-161121]] §2.3b）。
	 */
	private createSearchButton(
		parentEl: HTMLElement,
		options: {
			icon: string;
			label: string;
			action: string;
			onClick: () => void;
		},
	): HTMLButtonElement {
		const btn = parentEl.createEl('button', {
			cls: 'ioto-task-view__search-btn',
			attr: {
				type: 'button',
				'aria-label': options.label,
				title: options.label,
				'data-action': options.action,
			},
		});
		setIcon(btn, options.icon);
		btn.addEventListener('click', (event) => {
			event.preventDefault();
			options.onClick();
		});
		return btn;
	}

	/**
	 * 按 `this.filters` 刷新栏态：两个 toggle 的 `aria-pressed`；只读态隐藏「添加任务」。
	 * `aria-pressed` 以**属性真源**为准（`renderNote` 每次刷新），不缓存按钮内部状态。
	 */
	private refreshToolbarState(): void {
		this.toggleTaskBlocksEl?.setAttribute(
			'aria-pressed',
			this.filters.onlyTaskBlocks ? 'true' : 'false',
		);
		this.togglePendingEl?.setAttribute(
			'aria-pressed',
			this.filters.onlyPending ? 'true' : 'false',
		);
		this.toggleRecentEl?.setAttribute(
			'aria-pressed',
			this.filters.recentOnly ? 'true' : 'false',
		);
		// 阈值随设置变化：每次刷新重取 provider 更新 tooltip，避免只取一次导致滞后。
		this.toggleRecentEl?.setAttribute('title', this.recentTaskTitle());
		// 只读态隐藏「添加任务」：插入后进不了编辑只会剩 Notice（§5.4）。
		this.addTaskEl?.toggleClass('is-hidden', !this.supportsInlineEdit());
		// 模板 hint 随「可用模板」显隐（每次刷新重取，避免设置改完 tooltip 滞后）。
		this.addTaskEl?.setAttribute('title', this.addTaskTooltip());
		// 兜底重算删除按钮显隐（建栏 / clear / 设置热切换等整栏刷新点，§4.4 落点 A）。
		this.refreshDeleteButtonVisibility();
	}

	/**
	 * 刷新工具栏「删除」按钮的显隐与 pending 态（[[Plan-20261007-194826]] §4.3）。
	 *
	 * 判据全真才显示：
	 *  - 未在**放大**态（`zoomLine`）：方案 A 下放大 ≡ 单卡编辑面，删除入口整体停用，
	 *    删除须先「缩小」退出放大（[[Discuss-20261008-173935]] Q3）；
	 *  - 未在**标题**编辑（`editingLine`）：`beginEdit` 结尾会 `applySelection`，编辑态
	 *    `selectedLine` 仍指向该行，只判 `selectedLine` 会在编辑时冒出删除按钮；
	 *  - 未在**续行**编辑（`continuationLine`）：续行编辑不置 `editingLine`，同理会误显示；
	 *  - 有可命中的选中卡（复用 `canToggleSelectedFromScope()` 口径）：否则选中行已被
	 *    过滤 / 折叠时按钮还在、点了静默失败；
	 *  - 且 `Platform.isMobile` **或** 桌面端设置已开启（含平板，勿用 CSS `.is-phone`）。
	 *
	 * pending 期间加 `is-pending` + `aria-pressed`，向用户传达「再点即删」。
	 */
	private refreshDeleteButtonVisibility(): void {
		const hasSelectedCard =
			this.selectedLine !== null && this.queryCard(this.selectedLine) !== null;
		const show =
			this.zoomLine === null &&
			this.editingLine === null &&
			this.continuationLine === null &&
			hasSelectedCard &&
			(Platform.isMobile || this.deleteButtonOnDesktopProvider());
		this.deleteTaskEl?.toggleClass('is-hidden', !show);

		const pending = this.pendingDeleteLine !== null;
		this.deleteTaskEl?.toggleClass('is-pending', pending);
		this.deleteTaskEl?.setAttribute('aria-pressed', pending ? 'true' : 'false');
	}

	/** 设置热切换：只重算删除按钮显隐，不整栏重刷、不重绘（[[Plan-20261007-194826]] §4.7）。 */
	applyDeleteButtonSetting(): void {
		this.refreshDeleteButtonVisibility();
	}

	/**
	 * 工具栏「删除」入口：把当前选中行交给既有二次确认链（[[Discuss-20261007-193721]] §三.1）。
	 *
	 * 判据保证按钮仅在「有可命中选中卡」时可见，故空选中为不可达的防御出口：
	 * 静默 return 即可（`enterPendingDelete` 内部还会再用 `queryCard` 兜一次）。
	 */
	private requestDeleteSelected(): void {
		const line = this.selectedLine;
		if (line === null) {
			return;
		}
		this.requestDelete(line);
	}

	/** ③ 按钮 tooltip：内插当前阈值（设置变更后由 `refreshToolbarState` 重取）。 */
	private recentTaskTitle(): string {
		return t('view.iotoTaskView.toolbar.toggleRecentTooltip', [
			String(this.recentTaskCountProvider()),
		]);
	}

	/**
	 * 「添加」按钮 tooltip：只在**当前笔记有可用条目模板**时才拼上 Shift+点击的提示
	 * （[[Discuss-20261007-062838]] §三.①）——没说出来 ≈ 不存在；没模板时不教这个手势，
	 * 免得用户按了 Shift 只看到一条「未配置模板」的 Notice 以为是没按到。
	 */
	private addTaskTooltip(): string {
		const base = t('view.iotoTaskView.toolbar.addTaskTooltip');
		if (!this.hasAvailableEntryTemplate()) {
			return base;
		}
		return `${base}${t('view.iotoTaskView.toolbar.addTaskTemplateHint')}`;
	}

	/** 当前笔记是否有可用条目模板：与 `insertEntryTemplate()` 的项目过滤同口径。 */
	private hasAvailableEntryTemplate(): boolean {
		const config = this.entryTemplateProvider();
		if (!config.enabled || config.templates.length === 0) {
			return false;
		}
		const currentProject = this.resolveCurrentProjectNames()[0] ?? '';
		return config.templates.some((template) =>
			isTemplateAvailableForProject(template, currentProject),
		);
	}

	/* ------------------------------------------------------------------ *
	 * 关键词搜索条（[[Plan-20261006-161121]] §2.3）
	 * ------------------------------------------------------------------ */

	/** Mod+F / 命令入口：显示搜索条并聚焦输入框（Q6 移动端复用它）。 */
	revealSearch(): void {
		if (!this.searchBarEl?.isConnected) {
			this.buildToolbar();
		}
		this.searchBarEl?.removeClass('is-hidden');
		const input = this.searchInputEl;
		if (!input) {
			return;
		}
		const focus = (): void => {
			input.focus();
			input.select();
		};
		if (typeof window !== 'undefined' && window.requestAnimationFrame) {
			window.requestAnimationFrame(focus);
		} else {
			focus();
		}
	}

	private onSearchInput(): void {
		const value = this.searchInputEl?.value ?? '';
		if (this.searchDebounce !== null) {
			window.clearTimeout(this.searchDebounce);
		}
		this.searchDebounce = window.setTimeout(() => {
			this.searchDebounce = null;
			void this.applySearchQuery(value);
		}, SEARCH_DEBOUNCE_MS);
	}

	/**
	 * 实时生效：改关键词 → 先 commit 正在编辑的卡（照 `toggleFilter` 口径）→ 重绘归顶。
	 * 边界：与当前关键词相同则跳过（避免无意义的整树重建）。
	 */
	private async applySearchQuery(value: string): Promise<void> {
		if (value === this.searchQuery) {
			return;
		}
		// 🔴 重绘会销毁编辑器：先让编辑态落盘退出（真正的保护，非 isCardVisible 的兜底）。
		await this.commitEdit();
		await this.commitContinuationEdit();
		this.searchQuery = value;
		this.renderNote(this.data, { resetScroll: true });
	}

	/** 关闭 + 清空（`关闭` 按钮与 `Esc` 共用）。 */
	private closeSearch(): void {
		if (this.searchDebounce !== null) {
			window.clearTimeout(this.searchDebounce);
			this.searchDebounce = null;
		}
		this.searchBarEl?.addClass('is-hidden');
		if (this.searchQuery !== '' || (this.searchInputEl?.value ?? '') !== '') {
			this.searchQuery = '';
			if (this.searchInputEl) {
				this.searchInputEl.value = '';
			}
			this.renderNote(this.data, { resetScroll: true });
		}
		// 焦点归还：优先选中卡，否则视图容器
		const card =
			this.selectedLine !== null
				? this.queryCard(this.selectedLine)
				: null;
		if (card) {
			card.focus({ preventScroll: true });
		} else {
			this.contentEl.focus?.();
		}
	}

	/** `上一个`/`下一个`：在**可见卡**（= 命中卡）间定位，环绕，焦点留在搜索框。 */
	private stepMatch(delta: 1 | -1): void {
		const lines = collectCardLines(this.contentEl);
		if (lines.length === 0) {
			return;
		}
		const current =
			this.selectedLine !== null && lines.includes(this.selectedLine)
				? this.selectedLine
				: null;
		let target: number | null;
		if (current === null) {
			target =
				delta === 1
					? (lines[0] ?? null)
					: (lines[lines.length - 1] ?? null);
		} else {
			target =
				pickAdjacentLine(lines, current, delta) ??
				(delta === 1
					? (lines[0] ?? null)
					: (lines[lines.length - 1] ?? null)); // 环绕
		}
		if (target === null) {
			return;
		}
		this.highlightMatch(target);
	}

	/**
	 * 定位到某张卡：**加选中类 + 滚动入视口，但不抢焦点**（保持搜索框焦点）。
	 * 与 `applySelection` 的区别就在这里——后者会 `cardEl.focus()`，会跳出搜索框。
	 */
	private highlightMatch(line: number): void {
		// 方案 A：放大态 = 单卡编辑面，搜索定位不改选中态（避免破坏「放大 ≡ 编辑」）
		if (this.zoomLine !== null) {
			return;
		}
		this.cancelPendingDelete(false);
		const prev = this.selectedLine;
		if (prev !== null && prev !== line) {
			this.queryCard(prev)?.removeClass('is-selected');
		}
		this.selectedLine = line;
		const cardEl = this.queryCard(line);
		if (!cardEl) {
			this.selectedLine = null;
			this.refreshDeleteButtonVisibility();
			return;
		}
		cardEl.addClass('is-selected');
		this.scrollCardIntoView(cardEl);
		this.refreshDeleteButtonVisibility();
		// 🔴 不 cardEl.focus()：Obsidian 查找条语义是焦点留在查找框
	}

	/** 无命中时禁用两个定位按钮。 */
	private refreshSearchNavState(): void {
		const has = collectCardLines(this.contentEl).length > 0;
		this.searchPrevEl?.toggleAttribute('disabled', !has);
		this.searchNextEl?.toggleAttribute('disabled', !has);
	}

	/**
	 * 释放搜索瞬态：清 debounce 计时器、归零关键词、清输入框、收起搜索条。
	 * **不重绘**（调用方按需决定）；用于销毁 / 清空视图（[[Plan-20261006-161121]] §2.3f）。
	 */
	private resetSearchState(): void {
		if (this.searchDebounce !== null) {
			window.clearTimeout(this.searchDebounce);
			this.searchDebounce = null;
		}
		this.searchQuery = '';
		if (this.searchInputEl) {
			this.searchInputEl.value = '';
		}
		this.searchBarEl?.addClass('is-hidden');
	}

	/** 从 `this.data`（frontmatter）重读过滤开关；缺失 = 关。 */
	private reloadFilters(): void {
		this.filters = {
			onlyTaskBlocks: readBooleanProperty(
				this.data,
				PROPERTY_ONLY_TASK_BLOCKS,
			),
			onlyPending: readBooleanProperty(
				this.data,
				PROPERTY_ONLY_PENDING,
			),
			recentOnly: readBooleanProperty(
				this.data,
				PROPERTY_RECENT_ONLY,
			),
		};
	}

	/**
	 * 切换 ① / ②：先 `commitEdit`（避免与落盘交错），一次补齐两个属性键，写盘后
	 * 按 frontmatter 行数变化平移 `selectedLine` / `collapsedSections`，再整树重绘。
	 */
	private async toggleFilter(
		kind: keyof TaskNoteFilters,
	): Promise<void> {
		const file = this.file;
		if (!file) {
			return;
		}

		// 竞态：点开关注定先 blur → 异步 commitEdit；必须先落盘再写属性。
		await this.commitEdit();

		const oldContent = this.data;
		const nextValue = !this.filters[kind];

		const properties: Record<string, string> = {
			[FILTER_PROPERTY_NAMES[kind]]: nextValue ? 'true' : 'false',
		};
		// 首次 toggle 时一次补齐其余两个 key（把「行号平移」压成一次性事件）。
		for (const key of Object.keys(
			FILTER_PROPERTY_NAMES,
		) as (keyof TaskNoteFilters)[]) {
			if (key === kind) {
				continue;
			}
			const name = FILTER_PROPERTY_NAMES[key];
			if (readScalarProperty(oldContent, name) === null) {
				properties[name] = this.filters[key] ? 'true' : 'false';
			}
		}

		const newContent = await writeScalarProperties(
			this.app,
			file,
			properties,
		);
		const delta =
			newContent.split('\n').length - oldContent.split('\n').length;
		if (delta !== 0) {
			this.shiftTrackedLines(delta, oldContent, newContent);
		}

		// 🔴 红线：data / lastLoadedText 同步，避免 TextFileView 回写旧字节。
		this.data = newContent;
		this.lastLoadedText = newContent;
		this.renderNote(this.data, {
			skipAnchorRestore: kind === 'onlyTaskBlocks' && nextValue === false,
		});
	}

	/**
	 * frontmatter 增行导致正文行号整体 ±Δ 后，把以行号为基准的跟踪态一起平移
	 * （[[Plan-20261004-110845]] §5.1）。插入点恒在 frontmatter，故正文整体平移。
	 */
	private shiftTrackedLines(
		delta: number,
		oldContent: string,
		newContent: string,
	): void {
		const newLines = newContent.split('\n');

		if (this.selectedLine !== null) {
			const target = this.selectedLine + delta;
			const oldLine = this.lineAt(this.selectedLine);
			if (target >= 0 && newLines[target] === oldLine) {
				this.selectedLine = target;
			} else {
				this.selectedLine = null;
			}
		}

		const shifted = new Set<string>();
		for (const key of this.collapsedSections) {
			// key = `level:startLine:title`（只 split 前两个 `:`，标题可能含 `:`）
			const firstColon = key.indexOf(':');
			const secondColon = key.indexOf(':', firstColon + 1);
			if (firstColon < 0 || secondColon < 0) {
				continue;
			}
			const level = key.slice(0, firstColon);
			const startLine = Number.parseInt(
				key.slice(firstColon + 1, secondColon),
				10,
			);
			if (Number.isNaN(startLine)) {
				continue;
			}
			const title = key.slice(secondColon + 1);
			shifted.add(`${level}:${startLine + delta}:${title}`);
		}
		this.collapsedSections = shifted;
	}

	/**
	 * 按设置切换 IOTOTask 视图外观：玻璃（`.is-glass`）/ 现代（`.is-modern`）/ 简洁（`.is-simple`）/ 莫兰迪（`.is-morandi`）/ 经典卡片。
	 * `card` 为基线，不挂任何风格类；四个风格类互斥（一次只挂一个）。
	 * 设置变更时由 `main.ts` 的 `applySettingsToOpenViews` 调此方法来即时回退 / 切换，
	 * 无需整树重建（`contentEl` 的类在 `renderNote` 的 `empty()` 后仍然保留）。
	 * 见 [[Plan-20261003-215547]] §7.1、[[Plan-20261005-200436]]、[[Plan-20261005-230336]]、[[Plan-20261007-063658]]。
	 */
	applyAppearanceStyle(): void {
		const style = this.appearanceStyleProvider();
		this.contentEl.toggleClass('is-glass', style === 'glass');
		this.contentEl.toggleClass('is-modern', style === 'modern');
		this.contentEl.toggleClass('is-simple', style === 'simple');
		this.contentEl.toggleClass('is-morandi', style === 'morandi');
	}

	/**
	 * 阈值（`recentTaskCount`）设置变更后由 `main.ts` 调用：
	 * 刷新按钮 tooltip；仅当「显示最近任务」开启时重绘（阈值变化需重算分组），
	 * 其余情况不动 DOM（[[Plan-20261005-101007]] §2.6）。
	 */
	applyRecentTaskCount(): void {
		this.refreshToolbarState();
		if (this.filters.recentOnly) {
			this.renderNote(this.data);
		}
	}

	/**
	 * 条目模板设置变更后由 `main.ts` 调用：重刷工具栏，只为更新「添加」按钮 tooltip 里的
	 * 模板 hint（[[Discuss-20261007-062838]] §三.①）。不改 DOM 结构、不重绘列表。
	 */
	applyEntryTemplate(): void {
		this.refreshToolbarState();
	}

	private async reloadFromVault(): Promise<void> {
		const file = this.file;
		if (!file) {
			return;
		}

		// 编辑期间忽略外部写入，避免编辑器被重绘冲掉（只挡重绘，不挡写盘）。
		if (this.editingLine !== null || this.continuationLine !== null) {
			return;
		}

		const content = await this.app.vault.cachedRead(file);
		if (content === this.lastLoadedText) {
			return;
		}

		this.data = content;
		this.lastLoadedText = content;
		this.renderNote(content);
	}

	private renderNote(
		data: string,
		options?: {
			skipAnchorRestore?: boolean;
			animateRecentSwap?: boolean;
			/** 搜索结果集与滚动锚点无关：置顶（跳过「捕获-恢复」） */
			resetScroll?: boolean;
		},
	): void {
		if (this.isRendering) {
			return;
		}

		this.isRendering = true;
		// 新一次渲染立即作废上一场进出场动画（避免叠影）：`bodyEl.empty()` 会顺带
		// 销毁旧浮层，但异步 rAF 回调仍需令牌作废（[[Plan-20261005-150106]] §2.4）。
		this.cancelListTransition();
		try {
			// 整树重建会连遮罩一起清掉：先置空 pending 状态，避免旧行号悬空误删
			//（[[Plan-20261005-141853]] 坑 B）。幂等，无 pending 时为 no-op。
			this.cancelPendingDelete(false);
			// 兼容「setViewData 先于 onOpen」/ 外壳被清空的时序：缺失时补建。
			if (!this.bodyEl?.isConnected) {
				this.buildToolbar();
			}

			// 过滤开关以 frontmatter 为唯一真源：每次重绘都重读（多视图 / 外部改动自动对齐）。
			this.reloadFilters();
			this.refreshToolbarState();

			// 重绘会新建滚动容器（render-note.ts:60），scrollTop 会归零；
			// 先捕获、render 之后恢复，保证结构性变更（回车新建 / 折叠 Section / 冲突回滚）
			// 不把用户看到的视口位置丢掉（[[Plan-20261003-094145]] §5.2）。
			const snapshot = options?.resetScroll
				? null
				: captureIotoTaskScroll(this.contentEl);

			// 进出场动效门控：只对「①③ 单任务增删」放行（residual 重建保持即时）。
			// 必须在 `empty()` 前采旧集——旧卡节点会被 empty() 摘除，但引用仍在内存。
			const animate =
				options?.animateRecentSwap === true &&
				this.filters.recentOnly &&
				!this.prefersReducedMotion();
			const scrollElBefore =
				this.bodyEl?.querySelector<HTMLElement>(
					IOTO_TASK_SCROLL_SELECTOR,
				) ?? null;
			const oldSnapshots =
				animate && scrollElBefore
					? captureCardSnapshots(scrollElBefore, IOTO_TASK_CARD_SELECTOR)
					: [];

			// 只重建列表容器，控制栏外壳常驻（批次 A）。
			this.bodyEl?.empty();
			renderTaskNote({
				app: this.app,
				containerEl: this.bodyEl ?? this.contentEl,
				content: data,
				sourcePath: this.file?.path ?? '',
				component: this,
				collapsedSections: this.collapsedSections,
				onToggleSection: (key) => {
					if (this.collapsedSections.has(key)) {
						this.collapsedSections.delete(key);
					} else {
						this.collapsedSections.add(key);
					}
					this.renderNote(this.data);
				},
				editing: this.buildEditingController(),
				links: this.buildLinkController(),
				filters: this.filters,
				recentTaskCount: this.recentTaskCountProvider(),
				searchQuery: this.searchQuery,
			});
			if (snapshot) {
				restoreIotoTaskScroll(this.contentEl, snapshot, {
					skipAnchor: options?.skipAnchorRestore ?? false,
				});
			} else {
				// 搜索应用 / 清空：结果集与锚点无关，直接归顶。
				const scrollEl = this.bodyEl?.querySelector<HTMLElement>(
					IOTO_TASK_SCROLL_SELECTOR,
				);
				if (scrollEl) {
					scrollEl.scrollTop = 0;
				}
			}
			// 回填选中类：整树重建后 `selectedLine` 仍在，但不 `focus()`——
			// `renderNote` 也会被后台 `reloadFromVault` 触发，抢焦点会打断用户输入
			// （[[Plan-20261003-194909]] §5.1f）。
			this.syncSelectionClass();
			// 放大态跨重绘回填（[[Discuss-20261008-171512]] 方案 A 步骤 1/2）：
			// `zoomLine` 是内存真源，整树重建后须与选中态同口径回填，否则放大视觉丢失、
			// 与 `zoomLine` 错位（图标说放大、界面没放大）。
			this.restoreZoom();
			// 整树重建后重算删除按钮显隐（落点 A 在 `bodyEl.empty()` 之前、DOM 还是旧的，§4.4 坑 B）。
			this.refreshDeleteButtonVisibility();
			// 结果集变化后同步定位按钮可用态（无命中 → 两个按钮 disabled）。
			this.refreshSearchNavState();

			// 选中态稳定后启动动画（[[Plan-20261005-150106]] 坑 7）。
			// [[Plan-20261005-152203]] §3.2：改为「同步 prepare + 双 rAF play」——
			// prepare 在 renderNote 返回前定格起点态，浏览器绘制新列表的第一帧即起点态，
			// 不再先闪最终态再跳回起点；play 延到双 rAF（等布局 + 异步落字稳定）后起播。
			if (animate && oldSnapshots.length > 0) {
				const scrollEl = this.bodyEl?.querySelector<HTMLElement>(
					IOTO_TASK_SCROLL_SELECTOR,
				);
				if (scrollEl) {
					const plan = prepareSwapTransition({
						scrollEl,
						oldSnapshots,
						newSnapshots: captureCardSnapshots(
							scrollEl,
							IOTO_TASK_CARD_SELECTOR,
						),
						reducedMotion: false,
					});
					if (plan) {
						const token = ++this.listTransitionToken;
						this.listTransitionCleanup = () => plan.cancel();
						this.scheduleListPlay(() => {
							if (
								token !== this.listTransitionToken ||
								!scrollEl.isConnected
							) {
								plan.cancel();
								return;
							}
							plan.play();
						});
					}
				}
			}
		} finally {
			this.isRendering = false;
		}

		// 命令就绪补偿：本次渲染若因 ioto-settings 命令尚未注册而漏建卡片动作按钮，
		// 挂一趟短轮询，命令出现后补建；命令已齐则幂等 no-op（[[Research-20261008-122828]] 方案 A）。
		this.awaitCommandReadiness();
	}

	/**
	 * 双 `requestAnimationFrame` 后执行 `callback`（等布局 + 异步
	 * `MarkdownRenderer` 落字稳定再起播）。起点态已由 `prepareSwapTransition`
	 * 同步定格，因此等待期间用户看到的是「起点态」而非最终态。
	 */
	private scheduleListPlay(callback: () => void): void {
		const raf = (cb: FrameRequestCallback): number =>
			window.requestAnimationFrame(cb);
		raf(() => raf(callback));
	}

	/** 立即作废并收尾上一场进出场动画（幂等；无动画时为 no-op）。 */
	private cancelListTransition(): void {
		this.listTransitionToken += 1;
		this.listTransitionCleanup?.();
		this.listTransitionCleanup = null;
	}

	/** 系统「减弱动态效果」偏好：JS 侧预判（CSS 侧另有兜底）。 */
	private prefersReducedMotion(): boolean {
		return (
			window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ===
			true
		);
	}

	/**
	 * 只按 `selectedLine` 回填 `.is-selected`，不抢焦点。
	 * 过滤 / 折叠后选中卡可能已不在 DOM（[[Plan-20261004-110845]] §5.5）：
	 * 退化为「第一张可见卡」或 `null`，避免悬空选中。
	 *
	 * 方案 A（[[Discuss-20261008-173935]]）：放大态恒为单卡编辑面，`zoomLine` 非空时
	 * 整体跳过——内部 `selectedLine` 仍保留（AI 条目来源需要），但不再回填可见选中类。
	 */
	private syncSelectionClass(): void {
		const line = this.selectedLine;
		if (line === null) {
			return;
		}
		if (this.zoomLine !== null) {
			return;
		}

		const cardEl = this.queryCard(line);
		if (cardEl) {
			cardEl.addClass('is-selected');
			return;
		}

		const fallback = pickEdgeLine(
			collectCardLines(this.contentEl),
			'first',
		);
		this.selectedLine = fallback;
		if (fallback !== null) {
			this.queryCard(fallback)?.addClass('is-selected');
		}
	}

	/* ------------------------------------------------------------------ *
	 * 编辑：对外接口（渲染层通过回调调用）
	 * ------------------------------------------------------------------ */

	private buildEditingController(): TaskNoteEditing {
		// 箭头函数读实时值，供下面的 getter 转发（不写 `const self = this`）
		const readSelected = (): number | null => this.selectedLine;
		const readDeletePending = (): boolean => this.pendingDeleteLine !== null;
		// 🔴 对象字面量里的 `this` 指向对象本身，故必须走箭头读取器。
		const readEditingLine = (): number | null => this.editingLine;
		const readZoomLine = (): number | null => this.zoomLine;
		// 卡片动作区按钮：仅在「支持内联编辑」且「目标命令已注册」时才注入，
		// 缺省即渲染层隐藏按钮（Q5：只读 / ioto-settings 未启用 → 隐藏）。
		const inlineEdit = this.supportsInlineEdit();
		const canInsertLink = this.canDispatch(INSERT_OUTGOING_LINK_COMMAND_ID);
		const canEditControls = this.canDispatch(EDIT_ITEM_CONTROLS_COMMAND_ID);
		return {
			enabled: inlineEdit,
			// 🔴 必须是 getter：渲染层在 click / keydown 闭包里读实时值，
			// 建成普通属性会捕获构建那一刻的旧值，「第二次点击进编辑」就判不出来了。
			get selectedLine() {
				return readSelected();
			},
			select: (line) => {
				this.select(line);
			},
			// 选择态删除入口改语义分派：首按进确认态，同一行再次触发才真删
			//（[[Plan-20261005-141853]] 步骤 2）。确认按钮 / 二次 Delete 都走这里。
			delete: (line) => {
				this.requestDelete(line);
			},
			// 取消按钮 / Esc 调用；无 pending 时幂等 no-op。
			cancelDelete: () => {
				this.cancelPendingDelete();
			},
			// 🔴 必须是 getter：渲染层在 keydown 闭包里读实时值（同 selectedLine）。
			get deletePending() {
				return readDeletePending();
			},
			// 🔴 必须是 getter：关键词过滤读实时值，供「编辑中的卡无条件保留」兜底。
			get editingLine() {
				return readEditingLine();
			},
			get zoomLine() {
				return readZoomLine();
			},
			beginEdit: (line) => {
				void this.beginEdit(line);
			},
			beginContinuationEdit: (line) => {
				void this.beginContinuationEdit(line);
			},
			insertSibling: (line) => {
				void this.insertSibling(line);
			},
			indent: (line, delta) => {
				void this.indentSelected(line, delta);
			},
			toggleTask: (line, cardEl) => {
				void this.toggleTask(line, cardEl);
			},
			// 🔴 派发前**不** commitEdit：两个命令都依赖「命令同步段仍处编辑态」
			// （出链读 activeEditor?.editor，条目控制走 item-control-bridge 的
			// getItemControlHost，要求 editingLine / editingHandle 存活）。
			// 按钮已由 embedded-editor 捕获阶段保焦，命令可直接派发。
			...(inlineEdit && canInsertLink
				? {
						insertOutgoingLink: () =>
							this.dispatchCommand(
								INSERT_OUTGOING_LINK_COMMAND_ID,
							),
					}
				: {}),
			...(inlineEdit && canEditControls
				? {
						editItemControls: () =>
							this.dispatchCommand(
								EDIT_ITEM_CONTROLS_COMMAND_ID,
							),
					}
				: {}),
			...(inlineEdit
				? {
						toggleZoom: (line: number) => {
							this.toggleZoomCard(line);
						},
						focusZoomEditor: (line: number) => {
							this.focusZoomEditor(line);
						},
					}
				: {}),
		};
	}

	/* ------------------------------------------------------------------ *
	 * 聚焦放大：瞬态 DOM 开关（不重绘，保住编辑器光标）
	 * ------------------------------------------------------------------ */

	private toggleZoomCard(line: number): void {
		if (this.zoomLine === line) {
			this.exitZoom();
		} else {
			void this.enterZoom(line);
		}
	}

	/**
	 * 放大（[[Discuss-20261008-173935]] 方案 A）：**放大 ≡ 常驻编辑态**——
	 * 先把编辑器确保挂到该卡上，再套放大类；放大卡恒为「单卡编辑面」，不再有选中态。
	 * 编辑器挂不上（不支持内联编辑 / 目标卡缺失 / 挂载降级）则放弃放大，不留半程状态。
	 */
	private async enterZoom(line: number): Promise<void> {
		if (!this.supportsInlineEdit() || !this.queryCard(line)) {
			return;
		}
		// 先置真源：`applySelection` 读到 `zoomLine` 才不会给放大卡补 `.is-selected`
		this.zoomLine = line;
		if (this.editingLine !== line || !this.editingHandle) {
			await this.beginEdit(line);
		}
		if (this.editingLine !== line) {
			// 编辑器挂不上（降级）：宁可退出，也不留「放大但只读」
			this.zoomLine = null;
			return;
		}
		this.applyZoomDom(line);
	}

	/**
	 * 放大态纯 DOM：隐藏其余 Section / 分组 / 卡片，抬高当前卡（不重建、不抢焦点）。
	 * 单独抽出，供 `enterZoom`（先确保编辑）与重绘回填复用。
	 */
	private applyZoomDom(line: number): void {
		const cardEl = this.queryCard(line);
		const sectionEl =
			cardEl?.closest<HTMLElement>('.ioto-task-view__section') ?? null;
		const groupListEl = cardEl?.parentElement ?? null;
		if (!cardEl || !sectionEl) {
			return;
		}

		// 方案 A：放大期间不出现选中态（清掉可能残留的 `.is-selected`）
		cardEl.removeClass('is-selected');

		// ① 其他顶层 Section 整体隐藏
		this.bodyEl
			?.querySelectorAll<HTMLElement>('.ioto-task-view__section')
			.forEach((sec) => {
				if (sec !== sectionEl) {
					sec.addClass('is-zoom-hidden');
				}
			});

		// ② 本 Section：只留放大卡所在的清单分组；其余分组 / 非任务正文块一并隐藏（Q1）。
		//    标题栏不在 section-body 内，天然保留（Q2）。
		sectionEl
			.querySelector('.ioto-task-view__section-body')
			?.querySelectorAll<HTMLElement>(':scope > *')
			.forEach((child) => {
				if (child !== groupListEl) {
					child.addClass('is-zoom-hidden');
				}
			});

		// ③ 同分组内其他卡隐藏
		groupListEl
			?.querySelectorAll<HTMLElement>(':scope > .ioto-task-view__card')
			.forEach((card) => {
				if (card !== cardEl) {
					card.addClass('is-zoom-hidden');
				}
			});

		// ④ 抬高输入区（数值由 CSS 决定，见 6.6）
		cardEl.addClass('is-zoomed');

		// ⑤ 按钮就地翻面（点击不重建动作区，见 Discuss-20261008-111641 §2.3-4）
		this.syncZoomButton(cardEl);
	}

	/**
	 * 缩小：删净放大类，与 `enterZoom` 对称；幂等。
	 * 方案 A（Q5）：退出放大**不动编辑态**——编辑器仍在、卡片保持 `.is-editing`，
	 * 此后再点空白才走常规「失焦提交 → 回落选中」（回到两段式状态机）。
	 */
	private exitZoom(): void {
		this.zoomLine = null;
		// 先记住放大卡（清类后 `is-zoomed` 即消失），供按钮翻面还原用。
		const zoomedCard =
			this.bodyEl?.querySelector<HTMLElement>(
				'.ioto-task-view__card.is-zoomed',
			) ?? null;
		this.bodyEl
			?.querySelectorAll<HTMLElement>('.is-zoom-hidden, .is-zoomed')
			.forEach((el) => {
				el.removeClass('is-zoom-hidden');
				el.removeClass('is-zoomed');
			});
		this.syncZoomButton(zoomedCard);
	}

	/**
	 * 整树重建后回填放大态（[[Discuss-20261008-171512]] 方案 A 步骤 1）。
	 *
	 * 方案 A（[[Discuss-20261008-173935]]）叠加：放大 **≡** 编辑。`bodyEl.empty()` 已把
	 * 编辑器 DOM 摘除（`editingHandle` 悬空），故这里先有序回收悬空句柄、再由 `enterZoom`
	 * 重挂编辑器——否则会出现「`.is-editing` 在、编辑器没了」的空壳。目标卡不存在则
	 * 兜底退出并一并收口编辑态。
	 */
	private restoreZoom(): void {
		const line = this.zoomLine;
		if (line === null) {
			return;
		}
		if (!this.queryCard(line)) {
			// 卡片被删 / 行漂移落空 / 被折叠：宁可不放大，也不放大错卡（Q3）
			this.zoomLine = null;
			this.destroyActiveEditor();
			this.editingLine = null;
			this.editingOriginalLine = '';
			return;
		}
		// 重绘必然摘除编辑器 DOM：句柄悬空即回收，交由 enterZoom 重挂（保持「放大 ≡ 编辑」）
		if (this.editingHandle) {
			this.destroyActiveEditor();
			this.editingLine = null;
			this.editingOriginalLine = '';
		}
		void this.enterZoom(line);
	}

	/**
	 * 就地同步放大按钮的图标与文案：点击切换是纯 DOM 开关，不会重建动作区，
	 * 故须手动翻面（否则点了放大图标仍停在「放大」）。
	 */
	private syncZoomButton(cardEl: HTMLElement | null): void {
		if (!cardEl) {
			return;
		}
		const btn = cardEl.querySelector<HTMLElement>(
			'.ioto-task-view__card-action-btn[data-action="toggle-zoom"]',
		);
		if (!btn) {
			return;
		}
		const zoomed = this.zoomLine !== null;
		const label = t(
			zoomed
				? 'view.iotoTaskView.cardActions.zoomOut'
				: 'view.iotoTaskView.cardActions.zoomIn',
		);
		setIcon(btn, zoomed ? 'minimize-2' : 'maximize-2');
		btn.setAttribute('aria-label', label);
		btn.setAttribute('title', label);
	}

	/**
	 * 目标命令当前是否可派发：`app.commands` 已注册该 id 且具备 `executeCommandById`。
	 * 照 `runTask()` 的判据抽成方法，供编辑控制器按可用性隐藏按钮
	 * （[[Plan-20261005-111411]] §三 步骤 4）。
	 */
	private canDispatch(commandId: string): boolean {
		const registry = (this.app as App & { commands?: CommandRegistryLike })
			.commands;
		return Boolean(
			registry?.commands &&
				commandId in registry.commands &&
				registry.executeCommandById,
		);
	}

	/**
	 * 派发 ioto-settings 命令（照 `runTask()` 口径）。正常情况下按钮已按可用性
	 * 隐藏，走到这里说明存在竞态（命令刚被注销），给 `Notice` 兜底不静默。
	 */
	private dispatchCommand(commandId: string): void {
		const registry = (this.app as App & { commands?: CommandRegistryLike })
			.commands;
		if (!this.canDispatch(commandId)) {
			new Notice(t('notice.iotoTaskView.runTaskUnavailable'));
			return;
		}
		void Promise.resolve(registry?.executeCommandById?.(commandId));
	}

	/* ------------------------------------------------------------------ *
	 * 命令就绪补偿（[[Research-20261008-122828]] 方案 A）
	 * ------------------------------------------------------------------ */

	/**
	 * 卡片动作区两条 ioto-settings 命令是否均已注册（补偿判据）。
	 * 与 `buildEditingController` 里决定是否注入两个回调的口径完全一致。
	 */
	private areCardActionCommandsReady(): boolean {
		return (
			this.canDispatch(INSERT_OUTGOING_LINK_COMMAND_ID) &&
			this.canDispatch(EDIT_ITEM_CONTROLS_COMMAND_ID)
		);
	}

	/** 取消在途的命令就绪补偿轮询（幂等；命令已齐 / 视图卸载时收口）。 */
	private clearCommandReadinessTimer(): void {
		if (this.commandReadinessTimer !== null) {
			window.clearTimeout(this.commandReadinessTimer);
			this.commandReadinessTimer = null;
		}
	}

	/**
	 * 命令就绪补偿：渲染后若目标命令缺位，挂一趟轻量短轮询，命令一旦出现即对
	 * **全部卡就地重建动作区**并自停；超时则保持隐藏。
	 *
	 * 前两个按钮（出链 / 条目控制）是「渲染那一刻」按 `app.commands.commands` 里
	 * 命令是否已注册来**有条件创建**的，而 ioto-settings 延迟 1s 才注册命令 →
	 * 视图落在窗口内渲染就会漏建。这里把「一次性判定」改成「等到就绪或超时」。
	 *
	 * 幂等：命令已齐或已有在途轮询时直接返回，连续重绘共用一趟，避免叠加轮询。
	 * 补建走 `refreshCardActions`（只重建动作区），**不整树重绘**、不打断内联编辑。
	 */
	private awaitCommandReadiness(): void {
		if (this.areCardActionCommandsReady()) {
			this.clearCommandReadinessTimer();
			return;
		}
		if (this.commandReadinessTimer !== null) {
			return;
		}
		const deadline = Date.now() + COMMAND_READINESS_TIMEOUT_MS;
		const tick = (): void => {
			this.commandReadinessTimer = null;
			if (this.areCardActionCommandsReady()) {
				for (const line of collectCardLines(this.contentEl)) {
					this.refreshCardActions(line);
				}
				return;
			}
			if (Date.now() < deadline) {
				this.commandReadinessTimer = window.setTimeout(
					tick,
					COMMAND_READINESS_POLL_MS,
				);
			}
		};
		this.commandReadinessTimer = window.setTimeout(
			tick,
			COMMAND_READINESS_POLL_MS,
		);
	}

	/* ------------------------------------------------------------------ *
	 * 双链：点击打开 + hover 预览（[[Plan-20261004-004408]] §3.2 ④）
	 * ------------------------------------------------------------------ */

	/**
	 * 卡片正文 / Section markdown 里双链的接管方。
	 *
	 * 渲染层只产 HTML，点击与 hover 是视图自己的职责
	 * （[[Research-20261004-001616]] §四）。
	 */
	private buildLinkController(): TaskNoteLinks {
		return {
			open: (linktext, newLeaf) => {
				const sourcePath = this.file?.path ?? '';
				void (async () => {
					// 编辑态点**别的卡片**的链接：mousedown 的 blur 已提交过一次，
					// 这里是幂等兜底；成功后只 `refreshCard`，不整树重建，
					// 被点的 `<a>` 仍在 DOM 上，本次点击照常派发。
					await this.commitEdit();
					await this.app.workspace.openLinkText(
						linktext,
						sourcePath,
						// 核心同款叶子类型：'tab' / 'split' / 'window'，或 false = 当前叶子
						newLeaf,
					);
				})();
			},
			hover: (event, linktext, targetEl) => {
				this.app.workspace.trigger('hover-link', {
					event,
					source: IOTO_TASK_VIEW_HOVER_SOURCE_ID,
					hoverParent: this.hoverPreviewParent,
					targetEl,
					linktext,
					sourcePath: this.file?.path ?? '',
				} satisfies TaskHoverPreviewPayload);
			},
		};
	}

	/* ------------------------------------------------------------------ *
	 * 选择态：选中 / 移动 / 删除（[[Plan-20261003-194909]] §5.1b、§5.1e）
	 * ------------------------------------------------------------------ */

	/**
	 * 选中一张卡片（`idle|selected|editing → selected`）。
	 *
	 * 正编辑**其它**卡片时先提交（mousedown 的 blur 已经先跑过一次，这里是兜底，
	 * 例如方向键移动或 `Option+I` 面板关闭后重新选中）。已在本卡编辑态则忽略。
	 */
	private select(line: number): void {
		// 换选中即离开 pending 语境：先撤遮罩（幂等，焦点交给随后的 applySelection）
		this.cancelPendingDelete(false);
		if (this.editingLine !== null && this.editingLine !== line) {
			void this.commitEdit().then(() => this.applySelection(line));
			return;
		}
		if (this.editingLine === line) {
			return;
		}
		this.applySelection(line);
	}

	/**
	 * 增量切选中：**绝不整树重绘**——重绘会让 `scrollTop` 归零，还会吞掉连续按键
	 * （[[Research-20261003-091331]] §3.1、[[Plan-20261003-094145]] §5.3）。
	 *
	 * 方案 A（[[Discuss-20261008-173935]]）：当 `line === zoomLine` 时只更新内部
	 * `selectedLine`、**不加** `.is-selected`（放大卡恒编辑，选中语义整体停用）。
	 */
	private applySelection(line: number): void {
		// 任何改选中的入口都先撤遮罩（坑 C / Q2）；焦点交给下面的 cardEl.focus
		this.cancelPendingDelete(false);
		const prev = this.selectedLine;
		if (prev !== null && prev !== line) {
			this.queryCard(prev)?.removeClass('is-selected');
		}
		this.selectedLine = line;

		const cardEl = this.queryCard(line);
		if (!cardEl) {
			// 行号已漂移 / 卡片被折叠：交由后续整树渲染兜底
			this.selectedLine = null;
			this.refreshDeleteButtonVisibility();
			return;
		}

		// 方案 A：放大态恒编辑、不出现选中态——内部 `selectedLine` 保留，但跳过加类
		if (this.zoomLine !== line) {
			cardEl.addClass('is-selected');
		}
		cardEl.focus({ preventScroll: true });
		this.scrollCardIntoView(cardEl);
		this.refreshDeleteButtonVisibility();
	}

	/**
	 * blur 提交后的「焦点还原」：与 Esc 出口（onEditorEscape）对称
	 * （[[Discuss-20261005-175835]] §四·A，[[Plan-20261005-180341]]）。
	 *
	 * 只在「焦点落空」时拉回，避免和用户主动跳走（点另一张卡 / 点工具栏 /
	 * 切侧栏 / 打开链接）打架：
	 *  - 选中没在途中被挪走（`selectedLine` 仍是本行）——防与点另一张卡的竞态；
	 *  - 卡片仍在（未被折叠 / 重绘挪走）；
	 *  - `activeElement` 既不在任何卡片内，也**确实掉空**（body / documentElement / null）。
	 *
	 * 用 `applySelection` 而不是手写 addClass+focus，是为了顺带清掉上一张卡的
	 * 残留选中类，并与 Esc 路径共用同一套语义。
	 */
	private restoreSelectionFocusAfterBlurCommit(line: number): void {
		if (this.selectedLine !== line) {
			return;
		}
		if (!this.queryCard(line)) {
			return;
		}

		const doc = activeDocument;
		const activeEl = doc.activeElement;
		const orphaned =
			activeEl === null ||
			activeEl === doc.body ||
			activeEl === doc.documentElement;
		if (!orphaned) {
			return;
		}

		this.applySelection(line);
	}

	/**
	 * 选择态下 `Delete` / `Backspace`：删当前行**及其下连续续行**（`Shift+Enter` 正文，
	 * 卡片里显示几行就删几行），**不级联嵌套子行**；
	 * 选择落到「原位置的下一张，否则上一张」。
	 */
	private async deleteSelected(line: number): Promise<void> {
		const file = this.file;
		if (!file) {
			return;
		}

		// 删除前先取 DOM 顺序：删除会让后续卡片的 data-line 整体前移
		const order = collectCardLines(this.contentEl);
		const removedCount = 1 + this.countContinuationLines(line); // 任务行 + 续行
		const nextLine = pickLineAfterDelete(order, line, removedCount);

		const outcome = await commitTaskLineAction(this.app, file, {
			line,
			originalLine: this.lineAt(line),
			transform: () => '',
			swallowContinuations: true, // 与渲染层同口径
		});
		// 🔴 红线：data / lastLoadedText 必须同步
		this.applyOutcome(outcome);

		if (outcome.status === 'conflict') {
			// 罕见路径，允许整树重建
			this.selectedLine = line;
			await this.reloadFromVault();
			this.renderNote(this.data);
			return;
		}
		if (outcome.status !== 'ok') {
			// unchanged：没删掉任何行，选择不动
			return;
		}

		// 结构性变更 → 整树重建（不跳顶由 ioto-task-scroll.ts 兜底）。
		// 单任务删除：开启「只显示最近任务」时补进出场动画（[[Plan-20261005-150106]] §2.5.2）。
		this.selectedLine = nextLine;
		this.renderNote(this.data, { animateRecentSwap: true });
		if (nextLine !== null) {
			this.queryCard(nextLine)?.focus({ preventScroll: true });
		}
	}

	/**
	 * 选择态 `Tab` / `Shift+Tab`：对选中行做 ±1 级缩进，写回后**保持选中**。
	 *
	 * 与 `deleteSelected` 同构（同一 `commitTaskLineAction` + 整树重建 + 回填焦点），
	 * 差别只在：缩进**不改行数**，故行号不漂移，重建后仍聚焦同一行；`setTaskIndent`
	 * 负责 clamp 到 `[0, 8]` 并规整为「每级 2 空格」。到边界时 transform 返回同一行，
	 * `commitTaskLineAction` 记为 `unchanged`，无写入、无重绘（幂等）。
	 */
	private async indentSelected(line: number, delta: number): Promise<void> {
		const file = this.file;
		if (!file) {
			return;
		}

		const outcome = await commitTaskLineAction(this.app, file, {
			line,
			originalLine: this.lineAt(line),
			transform: (raw) => setTaskIndent(raw, delta),
		});
		// 🔴 红线：data / lastLoadedText 必须同步
		this.applyOutcome(outcome);

		if (outcome.status === 'conflict') {
			// 罕见路径，允许整树重建
			this.selectedLine = line;
			await this.reloadFromVault();
			this.renderNote(this.data);
			return;
		}
		if (outcome.status !== 'ok') {
			// unchanged：已到缩进边界（0 级 / 8 级），选中不动
			return;
		}

		// 缩进改变卡片 `data-indent`，需重建 DOM 才能刷新 `margin-inline-start`
		// （styles.css 的 [data-indent] 规则）；行数不变 → 行号不漂移，就地回填选中。
		this.renderNote(this.data);
		this.queryCard(line)?.focus({ preventScroll: true });
	}

	/* ------------------------------------------------------------------ *
	 * 选择态 → 待删除确认瞬态（[[Plan-20261005-141853]] §三/§四）
	 * ------------------------------------------------------------------ */

	/**
	 * 选择态删除入口：无 pending → 进确认态；同一行再次触发 → 确认删除。
	 *
	 * 「确认按钮」与「二次 `Delete`」都走 `delete(line)` 经此分派，渲染层无需维护
	 * 两套语义。非同一行（理论上不会发生）视为一次新的确认请求。
	 */
	private requestDelete(line: number): void {
		if (this.pendingDeleteLine === line) {
			this.confirmPendingDelete();
			return;
		}
		this.enterPendingDelete(line);
	}

	/**
	 * 在当前卡片上盖一层遮罩 + 居中的确认/取消按钮。
	 *
	 * 焦点**不移动**（仍留在 `cardEl`）：键盘全部走既有卡片 `keydown`，避免在视图里
	 * 重写一套 `collectCardLines`/`pickAdjacentLine` 导航（[[Plan-20261005-141853]] 步骤 5）。
	 */
	private enterPendingDelete(line: number): void {
		const cardEl = this.queryCard(line);
		if (!cardEl) {
			// 行已漂移：静默放弃，不进 pending
			return;
		}
		this.cancelPendingDelete(false); // 保证单例

		const overlay = cardEl.createDiv({
			cls: 'ioto-task-view__delete-confirm',
		});
		overlay.setAttr('role', 'alertdialog');
		overlay.setAttr(
			'aria-label',
			t('view.iotoTaskView.deleteConfirm.aria'),
		);

		const actions = overlay.createDiv({
			cls: 'ioto-task-view__delete-confirm-actions',
		});
		const ok = actions.createEl('button', {
			cls: 'ioto-task-view__delete-confirm-btn is-confirm',
			text: t('view.iotoTaskView.deleteConfirm.confirm'),
			attr: { type: 'button' },
		});
		const cancel = actions.createEl('button', {
			cls: 'ioto-task-view__delete-confirm-btn',
			text: t('view.iotoTaskView.deleteConfirm.cancel'),
			attr: { type: 'button' },
		});

		// 两个按钮都 stopPropagation：否则冒泡到卡片 click 会因卡已 is-selected 而误进编辑态
		ok.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.confirmPendingDelete();
		});
		cancel.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.cancelPendingDelete();
		});

		// Q8 防误触：点遮罩空白不取消，也不让焦点离开卡片
		overlay.addEventListener('mousedown', (event) => {
			event.preventDefault();
		});
		overlay.addEventListener('click', (event) => {
			event.stopPropagation();
		});

		this.pendingDeleteLine = line;
		this.pendingDeleteEl = overlay;
		cardEl.addClass('is-pending-delete');
		cardEl.focus({ preventScroll: true });
		// 同步工具栏删除按钮的 pending 视觉态（§4.5）。
		this.refreshDeleteButtonVisibility();
	}

	/**
	 * 撤下遮罩并清空 pending 状态（幂等）。
	 *
	 * 只移除遮罩类与 DOM，**不动 `selectedLine`**：取消后卡片仍保持 `.is-selected`。
	 */
	private cancelPendingDelete(refocus = true): void {
		this.pendingDeleteEl?.remove();
		this.pendingDeleteEl = null;
		const line = this.pendingDeleteLine;
		this.pendingDeleteLine = null;
		// 同步工具栏删除按钮的 pending 视觉态（§4.5）；确认成功后由 `confirmPendingDelete`
		// 先经此回到非 pending，再走 `deleteSelected`。
		this.refreshDeleteButtonVisibility();
		if (line !== null) {
			const cardEl = this.queryCard(line);
			cardEl?.removeClass('is-pending-delete');
			if (refocus) {
				cardEl?.focus({ preventScroll: true });
			}
		}
	}

	/**
	 * 确认删除：先清遮罩/置空 pending，再走既有 `deleteSelected()`。
	 *
	 * **不另写行号计算**——`nextLine`、conflict/unchanged、整树重建、选择回填全部沿用
	 * 既有链路（坑 G）。
	 */
	private confirmPendingDelete(): void {
		const line = this.pendingDeleteLine;
		if (line === null) {
			return;
		}
		this.cancelPendingDelete(false);
		void this.deleteSelected(line);
	}

	/**
	 * 选择态 `Shift+Enter`：在选中卡片**下方**插入一张同级空卡片
	 * （同 indent / 同列表符号 / 未勾选 / 不继承控制项），随后自动进入其编辑态。
	 *
	 * 复用 `runLineAction`：写盘 → 同步 `data`/`lastLoadedText` → 整树重建（带滚动
	 * 快照）→ `beginEdit(line + 1)`，冲突处理与选中回填全部沿用既有链路。
	 * 原行不变，故新行恒为 `line + 1`。
	 */
	private async insertSibling(line: number): Promise<void> {
		const originalLine = this.lineAt(line);
		await this.runLineAction(
			line,
			originalLine,
			(raw) => {
				const sibling = buildSiblingTaskLine(raw, '');
				return sibling === null ? null : [raw, sibling];
			},
			// 新空卡落到「任务行 + 其下连续续行」之后，避免抢走原任务的续行
			line + 1 + this.countContinuationLines(line),
			{ insertAfterContinuations: true, animateRecentSwap: true },
		);
	}

	/**
	 * 编辑态 `Shift+Enter`：进入该卡续写区——
	 * 已有续行 → 编辑它（`beginContinuationEdit`）；无续行 → 起一个空草稿
	 * （`beginNewContinuationEdit`）。与 Markdown View「`Enter` 新起一条 /
	 * `Shift+Enter` 软换行续写」的手感一致。
	 *
	 * 注：选择态 `Shift+Enter` 仍是 `insertSibling`（新建同级任务），本条只服务编辑态；
	 * 两态语义不同是 Johnny 拍板保留的（[[Plan-20261004-222507]] §七）。
	 */
	private async beginContinuationOrNew(line: number): Promise<void> {
		if (!this.supportsInlineEdit() || !this.file) {
			return; // 只读降级：静默（同「添加任务」口径）
		}
		if (this.continuationLine === line && this.continuationHandle) {
			return; // 同一张卡重复按 = no-op（对齐 beginContinuationEdit 的短路）
		}
		if (this.countContinuationLines(line) > 0) {
			await this.beginContinuationEdit(line);
			return;
		}
		await this.beginNewContinuationEdit(line);
	}

	/**
	 * 视口兜底：结构性变更（回车新建末行 / 删除）后目标卡可能在视口外，
	 * `block:'nearest'` 只在确实出视口时才滚动（[[Plan-20261003-094145]] §5.4）。
	 * `select` 与 `beginEdit` 共用。
	 */
	private scrollCardIntoView(cardEl: HTMLElement): void {
		const rect = cardEl.getBoundingClientRect();
		const scrollEl = this.contentEl.querySelector<HTMLElement>(
			'.ioto-task-view__scroll',
		);
		const view = scrollEl?.getBoundingClientRect();
		if (view && (rect.top < view.top || rect.bottom > view.bottom)) {
			cardEl.scrollIntoView({ block: 'nearest' });
		}
	}

	/**
	 * 「条目控制」桥接宿主：仅在内联编辑态返回；其余情况返回 `null`（命令原样透传）。
	 * 见 item-control-bridge.ts 与 [[Plan-20261003-105625]] §5.5。
	 */
	getItemControlHost(): ItemControlBridgeHost | null {
		const line = this.editingLine;
		const file = this.file;
		const handle = this.editingHandle;
		if (line === null || !file || !handle) {
			return null;
		}

		const originalLine = this.lineAt(line);
		const diskLines = this.data.split('\n');

		return {
			file,
			line,
			originalLine,
			readBridgeLine: () =>
				replaceTaskBody(originalLine, handle.getValue()) ??
				originalLine,
			readDiskLine: (index) => diskLines[index] ?? '',
			commitBridgeLine: (nextLine) =>
				this.commitFromItemControl(line, originalLine, nextLine),
			getLineCoords: (targetLine) => {
				const rect = this.queryCard(targetLine)?.getBoundingClientRect();
				return rect
					? {
							top: rect.top,
							left: rect.left,
							bottom: rect.bottom,
							right: rect.right,
						}
					: { top: 0, left: 0, bottom: 0, right: 0 };
			},
			getScrollWidth: () =>
				this.contentEl
					.querySelector('.ioto-task-view__scroll')
					?.getBoundingClientRect().width ?? 0,
		};
	}

	/**
	 * quickPanel 开放宿主契约（ioto-settings）：声明本视图可承载快捷面板。
	 *
	 * 鸭子类型实现——不 import `ioto-settings`；面板的挂载 / 清理 / 定位全部
	 * 由对端 `PanelService` 管理（见 [[Plan-20261005-070644]] §五）。
	 */
	getQuickPanelHost(): HTMLElement | null {
		return this.contentEl ?? null;
	}

	/**
	 * AI 条目来源开放契约（ioto-settings）：声明「当前选中卡片 = AI 条目来源」。
	 *
	 * 鸭子类型实现——不 import `ioto-settings`；只服务移动端 API 通道的
	 * 「任务条目模式」（桌面走 CLI，不进此路径）。`selectedLine` 是 0-based
	 * 文件行号，与对端 `resolveCursorItem` 同口径；`this.data` 是 TextFileView
	 * 内存整篇正文（派发前已 flush，与磁盘一致）。
	 * 见 [[Plan-20261007-161702]] §五。
	 */
	getAITaskItemSource(): { file: TFile; line: number; text: string } | null {
		if (!this.file || this.selectedLine === null) return null;
		return { file: this.file, line: this.selectedLine, text: this.data };
	}

	/**
	 * 面板确认后的整行写回：复用 `commitTaskLineAction`（原子 + 冲突定位），
	 * 成功后走 `applyOutcome` 红线同步 `data` / `lastLoadedText`，并同步
	 * `editingOriginalLine`，避免随后的 blur 提交误判冲突。
	 */
	private async commitFromItemControl(
		line: number,
		originalLine: string,
		nextLine: string,
	): Promise<CommitOutcome> {
		const file = this.file;
		if (!file) {
			return { status: 'unchanged' };
		}

		const outcome = await commitTaskLineAction(this.app, file, {
			line,
			originalLine,
			transform: () => nextLine,
		});
		this.applyOutcome(outcome);
		if (outcome.status === 'ok') {
			this.editingOriginalLine = nextLine;
			// 🔴 面板写回后必须把内联编辑器同步到新正文，否则下一次 blur 提交
			// 会用旧正文覆盖整行，把 depends：/ [model::] 等控制项抹掉。
			const body = taskBodyForEditor(nextLine);
			if (typeof body === 'string') {
				this.editingHandle?.setValue(body);
			}
			// 写回只同步了内存与编辑器；动作区徽章需就地重建，
			// 否则要整页刷新才显示（[[Plan-20261003-174312]] §3.3）。
			this.refreshCardActions(line);
		}
		return outcome;
	}

	private lineAt(index: number): string {
		return this.data.split('\n')[index] ?? '';
	}

	/** 统计从 `line + 1` 起的连续续行行数（与渲染层 isTaskContinuationLine 同口径）。 */
	private countContinuationLines(line: number): number {
		const lines = this.data.split('\n');
		const parent = parentIndentLevelOfTaskLine(lines[line] ?? '');
		let count = 0;
		for (let i = line + 1; i < lines.length; i += 1) {
			if (!isTaskContinuationLine(lines[i] ?? '', parent)) {
				break;
			}
			count += 1;
		}
		return count;
	}

	private queryCard(line: number): HTMLElement | null {
		return this.contentEl.querySelector<HTMLElement>(
			`.ioto-task-view__card[data-line="${line}"]`,
		);
	}

	private destroyActiveEditor(): void {
		// 编辑器没了，待写的那次也就没意义了（blur 提交会写最终值）
		this.autosave.cancel();
		const handle = this.editingHandle;
		// 先置空，保证随后触发的 blur 走到 commitEdit 时直接短路，不会递归。
		this.editingHandle = null;
		if (handle) {
			try {
				handle.destroy();
			} catch {
				/* ignore */
			}
		}
	}

	private async beginEdit(
		line: number,
		caretOffset?: number | null,
	): Promise<void> {
		if (!this.supportsInlineEdit() || !this.file) {
			new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
			return;
		}

		if (this.editingLine === line && this.editingHandle) {
			return;
		}

		// 方案 A：放大态只服务放大那张卡。要编辑别的卡（添加任务 / 插入模板 / 拆行等
		// 会 beginEdit 新行）先退出放大，回到常规两段式状态机，避免「放大错卡」错位。
		if (this.zoomLine !== null && this.zoomLine !== line) {
			this.exitZoom();
		}

		// 切换卡片：先提交上一个（标题编辑器 + 续行编辑器互相排斥）
		await this.commitEdit();
		await this.commitContinuationEdit();

		const file = this.file;
		if (!file) {
			return;
		}

		let cardEl = this.queryCard(line);
		if (!cardEl) {
			// 目标卡不在 DOM：多半是其 Section 处于折叠态（`renderSection` 折叠时直接
			// return，卡片根本不生成）。先展开目标 Section 再重绘一次，否则「添加了却
			// 看不到 / 进不了编辑」（[[Discuss-20261008-164745]] §四·2 / Q3）。
			if (this.expandSectionContaining(line)) {
				this.renderNote(this.data);
				cardEl = this.queryCard(line);
			}
		}
		if (!cardEl) {
			return;
		}

		const item = parseChecklistItems(this.data, {
			includeEmpty: true,
		}).find((entry) => entry.line === line);
		if (!item) {
			return;
		}

		const textEl = cardEl.querySelector<HTMLElement>(
			'.ioto-task-view__card-text',
		);
		if (!textEl) {
			return;
		}

		const hostEl = textEl.createDiv({
			cls: 'ioto-task-view__card-editor',
		});
		const originalLine = this.lineAt(line);

		const handle = await mountEmbeddedEditor({
			app: this.app,
			hostEl,
			component: this,
			file,
			initialValue: item.text,
			handlers: {
				onEnter: (cm, shiftKey) => this.onEditorEnter(cm, shiftKey),
				onSoftBreak: (cm) => this.onEditorSoftBreak(cm),
				onDeleteEmpty: () => this.onEditorDeleteEmpty(),
				onIndent: (delta) => this.onEditorIndent(delta),
				onEscape: () => this.onEditorEscape(),
				shouldDeferBlur: () => this.externalWritebackActive,
				onBlurDeferred: () => {
					this.externalWritebackBlurred = true;
				},
				onBlur: () => {
					// 兜底：窗口内即便被直接调用也不提交（主短路在 embedded-editor）。
					if (this.externalWritebackActive) {
						this.externalWritebackBlurred = true;
						return;
					}
					// blur 提交会写同一行的最终值，先撤掉待写的那次（内容相同，属无效写）
					this.autosave.cancel();
					// 方案 A：放大卡失焦**只落盘、不退出编辑态**（否则回落选中态）。
					// 编辑器不销毁、`.is-editing` 保留；焦点由随后的点击处理器交还编辑器。
					if (this.zoomLine === line) {
						void this.flushZoomEdit();
						return;
					}
					void this.commitEdit().then(() => {
						// 提交完成后按需把焦点还原到卡片（点空白的修复路径）
						this.restoreSelectionFocusAfterBlurCommit(line);
					});
				},
				onChange: () => {
					if (this.externalWritebackActive) {
						this.externalWritebackDirty = true;
						return;
					}
					this.autosave.schedule();
				},
			},
		});

		if (!handle) {
			hostEl.remove();
			new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
			return;
		}

		this.editingLine = line;
		this.editingOriginalLine = originalLine;
		this.editingHandle = handle;
		cardEl.addClass('is-editing');
		// `selected` 是 `editing` 的前置态：进编辑必先选中。走 `applySelection`
		// 而不是直接 addClass，是为了顺带清掉上一张卡的残留选中类
		//（`runLineAction` 新建兄弟行后直接编辑的路径上，旧行仍在 DOM 里）。
		this.applySelection(line);
		// 焦点给编辑器（`applySelection` 刚把焦点放在卡片上）
		handle.focus();
		// 模板 `%%Cursor%%`：挂载后默认落末尾，这里覆盖到指定偏移（clamp 在 handle 内）。
		if (typeof caretOffset === 'number') {
			handle.setCursor(caretOffset);
		}

		// 方案 A1（[[Discuss-20261008-164745]] §三）：把「滚入目标卡」推迟到下一帧。
		// `renderNote` 里 `restoreIotoTaskScroll` 会**排一个 rAF**（ioto-task-scroll.ts:133-141），
		// 下一帧把 `scrollTop` 写回重建前的位置；`applySelection` 的同步滚入会被它覆盖，
		// 导致新增任务虽获得焦点却重新掉出视口（列表越长越明显）。rAF 回调按注册顺序 FIFO，
		// 这里注册更晚 → 后跑 → 成为最后一个写 `scrollTop` 的人。`nearest` 只在必要时滚，
		// 已在视口内的卡零跳动。落在 `beginEdit` 这条共用链上，「添加任务」/`Enter` 拆行/
		// 条目模板插入三条路径一并修复。`cardEl` 可能因上面的展开重绘而失效，故重新取卡。
		if (typeof window !== 'undefined' && window.requestAnimationFrame) {
			window.requestAnimationFrame(() => {
				const target = this.queryCard(line);
				if (target) {
					this.scrollCardIntoView(target);
				}
			});
		}
	}

	/**
	 * 目标行所在的 Section 若处于折叠态，就地展开它；返回是否发生了展开。
	 *
	 * 只有**顶层 Section** 会进 `collapsedSections`（`renderTaskNote` 只对 roots 调
	 * `renderSection`），所以按「命中 key 在集合内」判定即可，无需再算顶层结构。
	 * 展开后调用方需重绘一次才能取到卡片（[[Discuss-20261008-164745]] §四·2 / Q3）。
	 */
	private expandSectionContaining(line: number): boolean {
		for (const section of parseSections(this.data)) {
			const key = getSectionStateKey(section);
			if (!this.collapsedSections.has(key)) {
				continue;
			}
			if (line >= section.startLine && line <= section.endLine) {
				this.collapsedSections.delete(key);
				return true;
			}
		}
		return false;
	}

	private async commitEdit(): Promise<void> {
		if (this.pendingCommit) {
			await this.pendingCommit;
			return;
		}

		if (
			this.editingHandle === null ||
			this.editingLine === null ||
			!this.file
		) {
			return;
		}

		this.pendingCommit = this.doCommitEdit();
		try {
			await this.pendingCommit;
		} finally {
			this.pendingCommit = null;
		}
	}

	private async doCommitEdit(): Promise<void> {
		const handle = this.editingHandle;
		const line = this.editingLine;
		const originalLine = this.editingOriginalLine;
		const file = this.file;
		if (!handle || line === null || !file) {
			return;
		}

		const nextBody = handle.getValue();
		this.destroyActiveEditor();

		if (nextBody.includes('\n')) {
			new Notice(t('notice.iotoTaskView.bodyMultilineRejected'));
			this.editingLine = null;
			await this.reloadFromVault();
			this.renderNote(this.data);
			return;
		}

		const outcome = await commitTaskText(this.app, file, {
			line,
			originalLine,
			nextBody,
		});
		this.editingLine = null;
		this.applyOutcome(outcome);

		if (outcome.status === 'conflict') {
			// 外部已改，拉权威内容；冲突是罕见路径，允许整树重建。
			await this.reloadFromVault();
			this.renderNote(this.data);
			return;
		}

		// ② 开启且该行现已完成：编辑期间这张卡由「编辑中兜底」保持可见，退出编辑
		// 边界要整树重绘才能真正收走（refreshCard 不重算可见性）（[[Report-20261007-092357]] §5.3）。
		const committed = splitTaskLine(this.lineAt(line));
		if (this.filters.onlyPending && committed?.checked.toLowerCase() === 'x') {
			this.renderNote(this.data);
			return;
		}

		// 纯文本提交「行数 / 缩进 / 其它卡片」全都没变，就地刷新单卡即可：
		// 既不会跳顶，也不会因整树重建吞掉正在进行的第二次点击（[[Plan-20261003-094145]] §5.3）。
		this.refreshCard(line);
	}

	/**
	 * 放大态失焦 / `Esc` 的落盘（[[Discuss-20261008-173935]] 方案 A Q1/Q4）：
	 * **只写盘、不退出编辑态**——复用 `autosaveEdit`（不 `destroy`、不 `clear editingLine`、
	 * 不 `refreshCard`），卡片保持 `.is-editing`，不会回落选中态。幂等：无变更 / 无编辑器时短路。
	 */
	private async flushZoomEdit(): Promise<void> {
		if (this.zoomLine === null) {
			return;
		}
		await this.autosaveEdit();
	}

	/**
	 * 放大态点击卡片：把焦点交还内嵌编辑器（方案 A）。
	 * 编辑器已在则仅 `focus()`；若因整树重绘瞬时缺位，则幂等重挂（`enterZoom`）。
	 */
	private focusZoomEditor(line: number): void {
		if (this.zoomLine !== line) {
			return;
		}
		if (this.editingLine === line && this.editingHandle) {
			this.editingHandle.focus();
			return;
		}
		void this.enterZoom(line);
	}

	/* ------------------------------------------------------------------ *
	 * 续行编辑器（[[Plan-20261004-212439]] §4.6）：点续行块就地多行编辑
	 * ------------------------------------------------------------------ */

	/**
	 * 点续行块进入就地多行编辑。
	 *
	 * - 与标题编辑器互斥：进入前先提交标题 / 其它续行编辑器；
	 * - 块范围 = `line + 1` 起连续 `isTaskContinuationLine`；编辑器持有 dedent 后文本；
	 * - 提交 / 失焦走 `commitContinuationEdit`，整树重建（续行行数会变，后续卡会漂）。
	 */
	private async beginContinuationEdit(line: number): Promise<void> {
		if (!this.supportsInlineEdit() || !this.file) {
			new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
			return;
		}
		if (this.continuationLine === line && this.continuationHandle) {
			return;
		}

		// 切换：先提交另一个编辑器（标题 / 另一条续行），互斥
		await this.commitEdit();
		await this.commitContinuationEdit();

		const file = this.file;
		if (!file) {
			return;
		}

		// 块范围：line + 1 起连续 isTaskContinuationLine（父缩进 = 任务行缩进）
		const lines = this.data.split('\n');
		const parent = parentIndentLevelOfTaskLine(lines[line] ?? '');
		let end = line + 1;
		while (
			end < lines.length &&
			isTaskContinuationLine(lines[end] ?? '', parent)
		) {
			end += 1;
		}
		if (end === line + 1) {
			return; // 无续行（DOM 与 data 不一致的兜底）
		}
		const originalLines = lines.slice(line + 1, end);

		const cardEl = this.queryCard(line);
		const contEl = cardEl?.querySelector<HTMLElement>(
			'.ioto-task-view__card-continuation',
		);
		if (!contEl) {
			return;
		}

		contEl.addClass('is-editing');
		// 防御：同一个 .card-continuation 只允许存在一个续行宿主（历史空壳先清掉）
		contEl
			.querySelectorAll(':scope > .ioto-task-view__continuation-editor')
			.forEach((el) => el.remove());
		const hostEl = contEl.createDiv({
			cls: 'ioto-task-view__continuation-editor',
		});
		this.continuationHostEl = hostEl;

		const handle = await mountEmbeddedEditor({
			app: this.app,
			hostEl,
			component: this,
			file,
			initialValue: dedentLines(originalLines.join('\n')), // 去公共前缀后再编辑
			handlers: {
				// Enter / Shift+Enter 都换行（忽略 shiftKey）
				onEnter: (cm) => this.onContinuationEnter(cm),
				onDeleteEmpty: () => this.onContinuationDeleteEmpty(),
				onIndent: () => false, // Tab 放行给核心（插入缩进），本期不接管
				onEscape: () => this.onContinuationEscape(),
				shouldDeferBlur: () => this.externalWritebackActive,
				onBlurDeferred: () => {
					this.externalWritebackBlurred = true;
				},
				onBlur: () => {
					if (this.externalWritebackActive) {
						this.externalWritebackBlurred = true;
						return;
					}
					void this.commitContinuationEdit();
				},
				onChange: () => {
					if (this.externalWritebackActive) {
						this.externalWritebackDirty = true;
						return;
					}
					this.autosave.schedule();
				},
			},
		});
		if (!handle) {
			contEl.removeClass('is-editing');
			hostEl.remove();
			this.continuationHostEl = null;
			new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
			return;
		}

		this.continuationLine = line;
		this.continuationStartLine = line + 1;
		this.continuationEndLine = end - 1;
		this.continuationOriginalLines = originalLines;
		this.continuationHandle = handle;
		this.applySelection(line); // 卡片高亮 + 清掉旧选中
		handle.focus();
	}

	/**
	 * 起一个**空草稿**续行编辑器（磁盘上尚无可编辑的续行块）。
	 *
	 * 与 `beginContinuationEdit` 同构，差别只在：空种子 / 磁盘上无块（不读块范围）/
	 * 卡片底部无 `.card-continuation` 时临时建一个（`continuationDraftContainerEl`）。
	 * **有内容才落盘**（空草稿在磁盘上不可表示，`isTaskContinuationLine('')` 恒 `false`）；
	 * 提交统一走 `commitContinuationEdit` 的「任务行展开」分支。
	 */
	private async beginNewContinuationEdit(line: number): Promise<void> {
		if (!this.supportsInlineEdit() || !this.file) {
			new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
			return;
		}
		if (this.continuationLine === line && this.continuationHandle) {
			return;
		}

		// 切换：先提交另一个编辑器（标题 / 另一条续行），互斥
		await this.commitEdit();
		await this.commitContinuationEdit();

		const file = this.file;
		if (!file) {
			return;
		}
		const cardEl = this.queryCard(line);
		if (!cardEl) {
			return;
		}
		if (continuationIndentForTaskLine(this.lineAt(line)) === null) {
			return; // 非任务行（DOM 与 data 不一致的兜底）
		}

		// 卡片底部：无续行容器则临时建一个（草稿专用）
		let contEl = cardEl.querySelector<HTMLElement>(
			'.ioto-task-view__card-continuation',
		);
		let createdContainer = false;
		if (!contEl) {
			contEl = cardEl.createDiv({
				cls: 'ioto-task-view__card-continuation',
				attr: { 'data-line': String(line) },
			});
			createdContainer = true;
		}
		contEl.addClass('is-editing');
		// 防御：同一容器只允许一个编辑器宿主（历史空壳先清掉）
		contEl
			.querySelectorAll(':scope > .ioto-task-view__continuation-editor')
			.forEach((el) => el.remove());
		const hostEl = contEl.createDiv({
			cls: 'ioto-task-view__continuation-editor',
		});
		this.continuationHostEl = hostEl;
		this.continuationDraftContainerEl = createdContainer ? contEl : null;

		const handle = await mountEmbeddedEditor({
			app: this.app,
			hostEl,
			component: this,
			file,
			initialValue: '', // 空种子：有内容才落盘
			handlers: {
				onEnter: (cm) => this.onContinuationEnter(cm),
				onDeleteEmpty: () => this.onContinuationDeleteEmpty(),
				onIndent: () => false,
				onEscape: () => this.onContinuationEscape(),
				shouldDeferBlur: () => this.externalWritebackActive,
				onBlurDeferred: () => {
					this.externalWritebackBlurred = true;
				},
				onBlur: () => {
					if (this.externalWritebackActive) {
						this.externalWritebackBlurred = true;
						return;
					}
					void this.commitContinuationEdit();
				},
				onChange: () => {
					if (this.externalWritebackActive) {
						this.externalWritebackDirty = true;
						return;
					}
					this.autosave.schedule();
				},
			},
		});
		if (!handle) {
			contEl.removeClass('is-editing');
			hostEl.remove();
			if (createdContainer) {
				contEl.remove();
			}
			this.continuationHostEl = null;
			this.continuationDraftContainerEl = null;
			new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
			return;
		}

		this.continuationLine = line;
		this.continuationStartLine = line + 1; // 草稿期占位，提交时不用
		this.continuationEndLine = line; // 空区间（start > end）
		this.continuationOriginalLines = [];
		this.continuationIsNew = true;
		this.continuationHandle = handle;
		this.applySelection(line);
		handle.focus();
	}

	/** 续行编辑器：`Enter` / `Shift+Enter` 都在光标处换行，不新建任务。 */
	private onContinuationEnter(cm: EditorView): boolean {
		const sel = cm.state.selection.main;
		cm.dispatch({
			changes: { from: sel.from, to: sel.to, insert: '\n' },
			selection: { anchor: sel.from + 1 },
			scrollIntoView: true,
		});
		return true;
	}

	/** 空内容 `Backspace`：删除整段续行并退出编辑。 */
	private onContinuationDeleteEmpty(): boolean {
		window.setTimeout(() => void this.commitContinuationEdit(true), 0);
		return true;
	}

	/** `Esc`：先提交、再落回本卡选择态（与标题编辑器同构）。 */
	private onContinuationEscape(): void {
		const line = this.continuationLine;
		if (line === null || this.continuationHandle === null) {
			return;
		}
		this.selectedLine = line;
		window.setTimeout(() => {
			void this.commitContinuationEdit().then(() => {
				const cardEl = this.queryCard(line);
				if (!cardEl) {
					this.renderNote(this.data);
					this.syncSelectionClass();
					return;
				}
				this.applySelection(line);
			});
		}, 0);
	}

	/**
	 * 提交 / 删段：读编辑器正文（去末尾空行）→ 按原公共前缀重新缩进写回。
	 *
	 * - **新建草稿**（`continuationIsNew`）：走「任务行展开」`commitTaskLineAction`，
	 *   缩进从任务行推导；空草稿不落盘（磁盘上不可表示空续行）；
	 * - **既有块**：`commitTaskContinuation` 整段替换（`''` → 删段，语义不变）；
	 * - `forceEmpty`（空内容 `Backspace`）直接视为删段；
	 * - 续行行数会变、后续卡 `data-line` 会漂 → `ok` 后整树重建；
	 * - `conflict` 拉权威内容重绘；`unchanged` 不写盘、不重绘。
	 */
	private async commitContinuationEdit(forceEmpty = false): Promise<void> {
		const handle = this.continuationHandle;
		if (!handle || this.continuationLine === null || !this.file) {
			return;
		}

		const rawText = handle.getValue();
		// 去掉末尾空行（编辑器习惯）；forceEmpty（空内容 Backspace）直接视为删段
		let nextText = rawText.replace(/\n+$/u, '');
		if (forceEmpty || rawText.trim().length === 0) {
			nextText = '';
		}

		const line = this.continuationLine;
		const startLine = this.continuationStartLine;
		const endLine = this.continuationEndLine;
		const originalLines = this.continuationOriginalLines;
		const isNew = this.continuationIsNew;
		const file = this.file;
		this.destroyContinuationEditor();

		// ① 新草稿 + 空内容：磁盘上不可表示空续行 → 不落盘、不重绘
		if (isNew && nextText.length === 0) {
			this.continuationLine = null;
			this.continuationOriginalLines = [];
			return;
		}

		let outcome: CommitOutcome;
		if (isNew) {
			// ② 新建块：任务行展开成 `[任务行, ...新续行]`，缩进从任务行推导
			//（空块的 `commonIndentPrefix([])` 恒为 `''`，不能沿用）。
			const indent = continuationIndentForTaskLine(this.lineAt(line));
			if (indent === null) {
				this.continuationLine = null;
				this.continuationOriginalLines = [];
				return;
			}
			outcome = await commitTaskLineAction(this.app, file, {
				line,
				originalLine: this.lineAt(line),
				transform: (raw) => [
					raw,
					...indentContinuationLines(nextText, indent),
				],
				insertAfterContinuations: true, // 与既有续行（若竞态中出现）不抢位
			});
		} else {
			outcome = await commitTaskContinuation(this.app, file, {
				startLine,
				endLine,
				originalLines,
				nextText,
			});
		}
		this.continuationLine = null;
		this.continuationOriginalLines = [];
		this.applyOutcome(outcome);

		if (outcome.status === 'conflict') {
			await this.reloadFromVault();
			this.renderNote(this.data);
			return;
		}
		if (outcome.status !== 'ok') {
			return; // unchanged：无写入，无需重绘
		}

		// 续行行数可能变化 → 整树重建（带滚动快照）；选中回填到该卡
		this.selectedLine = line;
		this.renderNote(this.data);
	}

	/** 销毁续行编辑器：去 DOM 编辑态 + 卸载 handle + 置空（比对 `destroyActiveEditor`）。 */
	private destroyContinuationEditor(): void {
		this.autosave.cancel();
		const handle = this.continuationHandle;
		// 先置空，保证随后触发的 blur 走到 commitContinuationEdit 时直接短路。
		this.continuationHandle = null;
		if (handle) {
			try {
				handle.destroy();
			} catch {
				/* ignore */
			}
		}
		// destroy() 只 empty 了子节点，宿主 div 仍在 → 显式移除并置空
		this.continuationHostEl?.remove();
		this.continuationHostEl = null;
		const line = this.continuationLine;
		if (line !== null) {
			this.queryCard(line)
				?.querySelector('.ioto-task-view__card-continuation')
				?.removeClass('is-editing');
		}
		// 新建草稿时临时建的空续行容器：一并回收，绝不留空壳
		if (this.continuationDraftContainerEl) {
			const el = this.continuationDraftContainerEl;
			this.continuationDraftContainerEl = null;
			el.remove();
		}
		this.continuationIsNew = false;
	}

	/**
	 * 编辑态自动落盘：**只写盘，不退出编辑态**（与 `commitEdit()` 并列，不复用）。
	 *
	 * 与 `doCommitEdit()` 的三点区别：
	 * 1. 不调 `destroyActiveEditor()` —— 编辑器、光标、滚动位置、选中态全部保留；
	 * 2. 不 `refreshCard` / `renderNote` —— 纯正文变更不改变行数 / 缩进 / 其它卡片；
	 * 3. conflict 静默跳过（不 Notice、不重建），交给最终 blur 提交统一处理。
	 *
	 * 🔴 红线：成功后必须刷新 `editingOriginalLine`，否则下一次落盘的
	 * `lines[index] === originalLine` 校验失配 → 判 conflict → 整树重建冲掉编辑态。
	 */
	private async autosaveEdit(): Promise<void> {
		// 续行编辑态：只写盘、不退出编辑（与标题自动落盘同构）
		if (this.continuationHandle && this.continuationLine !== null) {
			await this.autosaveContinuation();
			return;
		}

		const handle = this.editingHandle;
		const line = this.editingLine;
		const file = this.file;
		if (!handle || line === null || !file) {
			return;
		}
		// 与 blur 提交 / 上一次落盘互斥
		if (this.pendingCommit !== null || this.autosaveRunning) {
			return;
		}

		const nextBody = handle.getValue();
		// 与 `doCommitEdit` 同一守卫：换行会破坏任务行结构，交给最终提交去弹提示
		if (nextBody.includes('\n')) {
			return;
		}

		this.autosaveRunning = true;
		try {
			const outcome = await commitTaskText(this.app, file, {
				line,
				originalLine: this.editingOriginalLine,
				nextBody,
			});

			// 落盘期间已退出编辑（blur / 卸载 / `clear()`）：磁盘与内存都以随后那次
			// 提交的 outcome 为准，这里不再改内存，也不再动 `editingOriginalLine`
			//（它可能已被重置或指向另一行）。
			if (this.editingHandle !== handle || this.editingLine !== line) {
				return;
			}
			this.syncCommittedContent(outcome);
			if (outcome.status === 'ok') {
				this.editingOriginalLine = this.lineAt(line);
			}
		} finally {
			this.autosaveRunning = false;
		}
	}

	/**
	 * 续行编辑态自动落盘：**只写盘，不退出编辑态**。
	 *
	 * 不 destroy、不 `renderNote`（避免编辑被打断）；成功后刷新续行块快照
	 * （起止行号 + 原文），否则下一次落盘用旧序列判 `conflict`。
	 */
	private async autosaveContinuation(): Promise<void> {
		if (this.continuationIsNew) {
			return; // 草稿不自动落盘：首次写入统一由 blur / Esc 的 commitContinuationEdit 完成
		}
		const handle = this.continuationHandle;
		const line = this.continuationLine;
		const file = this.file;
		if (!handle || line === null || !file) {
			return;
		}
		if (this.autosaveRunning) {
			return;
		}

		const nextText = handle.getValue().replace(/\n+$/u, '');

		this.autosaveRunning = true;
		try {
			const outcome = await commitTaskContinuation(this.app, file, {
				startLine: this.continuationStartLine,
				endLine: this.continuationEndLine,
				originalLines: this.continuationOriginalLines,
				nextText,
			});

			// 落盘期间已退出编辑：以随后那次提交为准，不再改内存 / 快照
			if (this.continuationHandle !== handle || this.continuationLine !== line) {
				return;
			}
			this.syncCommittedContent(outcome);
			if (outcome.status === 'ok') {
				// 行数可能变化 → 按最新 data 重算块范围（父缩进 = 任务行缩进）
				const lines = this.data.split('\n');
				const parent = parentIndentLevelOfTaskLine(lines[line] ?? '');
				let end = line + 1;
				while (
					end < lines.length &&
					isTaskContinuationLine(lines[end] ?? '', parent)
				) {
					end += 1;
				}
				this.continuationStartLine = line + 1;
				this.continuationEndLine = end - 1;
				this.continuationOriginalLines = lines.slice(line + 1, end);
			}
		} finally {
			this.autosaveRunning = false;
		}
	}

	/**
	 * 就地重建该卡片的动作区徽章（入口：条目控制面板写回后 / 单卡刷新）。
	 * 只读 `this.data`（此时已是最新），复用渲染层 `renderCardActions`；
	 * 不重建卡片、不碰正文区与内联编辑器，因此不丢编辑态、不影响滚动位置。
	 * `queryCard` 未命中（行漂移 / 卡片被折叠）时静默跳过，交后续整树渲染兜底。
	 */
	private refreshCardActions(line: number): void {
		const cardEl = this.queryCard(line);
		if (!cardEl) {
			return;
		}
		const item = parseChecklistItems(this.data, {
			includeEmpty: true,
		}).find((entry) => entry.line === line);
		renderCardActions(cardEl, item?.controls ?? [], {
			line,
			editing: this.buildEditingController(),
		});
	}

	/**
	 * 只刷新单张卡片：去掉编辑态、卸掉空编辑器容器、按最新 `data` 重渲染正文。
	 *
	 * 前提：调用方只改了该行**正文**（`replaceTaskBody` 保留 checked / indent / controls）。
	 * 若将来提交语义扩展到改 `data-task` / `data-indent` 等属性，这里会漏更新，需改回整树重建。
	 */
	private refreshCard(line: number): void {
		const cardEl = this.queryCard(line);
		if (!cardEl) {
			// 行号漂移 / 卡片被折叠：退回整树重建。
			this.renderNote(this.data);
			return;
		}

		cardEl.removeClass('is-editing');
		const textEl = cardEl.querySelector<HTMLElement>(
			'.ioto-task-view__card-text',
		);
		if (!textEl) {
			return;
		}

		const item = parseChecklistItems(this.data, {
			includeEmpty: true,
		}).find((entry) => entry.line === line);

		// 顺带移除 `.card-editor` 空壳（destroyActiveEditor 只清空了它的子节点）。
		textEl.empty();
		// 与标题路径对称：顺带清掉续行容器的历史空壳
		cardEl
			.querySelector('.ioto-task-view__card-continuation')
			?.querySelectorAll(':scope > .ioto-task-view__continuation-editor')
			.forEach((el) => el.remove());
		if (item) {
			void MarkdownRenderer.render(
				this.app,
				item.text,
				textEl,
				this.file?.path ?? '',
				this,
			);
			// 就地重绘只重建标题（不动续行容器），续行里的高亮自然保留，只需对标题复跑。
			// `applySearchHighlight` 自带 unwrap，重复调用安全（[[Discuss-20261006-183552]] §4.3）。
			applySearchHighlight(textEl, normalizeQuery(this.searchQuery));
		}
		// 动作区也按最新 `data` 重建（幂等），覆盖 blur 提交等所有「就地刷单卡」路径。
		this.refreshCardActions(line);
		// 标题纯文本提交（`doCommitEdit` 已清 `editingLine`）不走 renderNote，
		// 必须在此重算删除按钮显隐，否则退出编辑后按钮不回来（§4.4 落点 D / 坑 6）。
		this.refreshDeleteButtonVisibility();
	}

	/**
	 * `Esc`：**先提交、再落回本卡选择态**（[[Discuss-20261003-194148]] §七.1 已确认）。
	 *
	 * 与旧路径的区别：**不再丢弃未提交内容**、**不再无选中地整树重绘**——
	 * 提交走 `commitEdit`，无冲突时就地刷单卡（`refreshCard` 去 `is-editing`、
	 * 保留 `.is-selected`），因此既不跳顶也不丢数据。
	 */
	private onEditorEscape(): void {
		const line = this.editingLine;
		if (line === null || this.editingHandle === null) {
			return;
		}

		// 方案 A（[[Discuss-20261008-173935]] Q4）：放大态 Esc = **提交文本 + 保持编辑态**，
		// 不再回落选中态。延后一拍：避免在核心编辑器自己的 keydown 回调里同步动作。
		if (this.zoomLine === line) {
			window.setTimeout(() => {
				void this.flushZoomEdit();
			}, 0);
			return;
		}

		// 先落状态：提交途中若发生冲突重绘，选中也能被回填
		this.selectedLine = line;
		// 延后一拍：避免在核心编辑器自己的 keydown 回调里同步卸载它
		window.setTimeout(() => {
			void this.commitEdit().then(() => {
				const cardEl = this.queryCard(line);
				if (!cardEl) {
					// 冲突重绘把卡挪没/折叠了：重建后回填
					this.renderNote(this.data);
					this.syncSelectionClass();
					return;
				}
				// 走 `applySelection`：它会先清掉上一张卡的残留选中类
				//（旧路径只 addClass，实测会留下 2 张 `.is-selected`）。
				this.applySelection(line);
			});
		}, 0);
	}

	/**
	 * 标题编辑器：`Mod+Enter` 在光标 / 选区处插入 `<br>`（标题行内换行）。
	 *
	 * 只插字面 `<br>`、全程无 `\n` → `replaceTaskBody` / `autosaveEdit` 的换行守卫
	 * 不会被触发；dispatch 触发 `onChange → autosave`，`<br>` 在**不退出编辑态**的情况
	 * 下自动落盘，Live Preview 立即渲染为折行。续写区不注册 `onSoftBreak`，语义不受影响。
	 */
	private onEditorSoftBreak(cm: EditorView): boolean {
		if (!this.editingHandle || this.editingLine === null) {
			return false;
		}
		const sel = cm.state.selection.main;
		const { cursor } = insertSoftBreak(
			cm.state.doc.toString(),
			sel.from,
			sel.to,
		);
		cm.dispatch({
			changes: { from: sel.from, to: sel.to, insert: SOFT_BREAK },
			selection: { anchor: cursor },
		});
		return true;
	}

	private onEditorEnter(cm: EditorView, shiftKey: boolean): boolean {
		const handle = this.editingHandle;
		const line = this.editingLine;
		if (!handle || line === null) {
			return false;
		}

		const text = handle.getValue();
		const originalLine = this.editingOriginalLine;
		// 新行落点 = 「任务行 + 其下连续续行」之后
		const nextEditLine = line + 1 + this.countContinuationLines(line);

		// Shift+Enter：进入 / 新增续写区（标题正文的落盘交给 beginContinuationOrNew
		// 内部的 commitEdit）——与 Markdown View 的「Shift+Enter 软换行续写」手感一致。
		// 选择态 Shift+Enter 仍是新建同级任务（insertSibling），此处只改编辑态。
		if (shiftKey) {
			// 延后一拍执行，避免在核心编辑器自己的 keymap 回调里同步卸载它。
			window.setTimeout(() => {
				void this.beginContinuationOrNew(line);
			}, 0);
			return true;
		}

		// Enter：光标处拆分（语义不变），拆出的兄弟同样落到整块之后
		const selection = cm.state.selection.main;
		const head = Math.min(Math.max(selection.head, 0), text.length);
		const before = text.slice(0, head);
		const after = text.slice(head);

		// 延后一拍执行，避免在核心编辑器自己的 keymap 回调里同步卸载它。
		window.setTimeout(() => {
			void this.runLineAction(
				line,
				originalLine,
				(raw) => {
					const first = replaceTaskBody(raw, before);
					const sibling = buildSiblingTaskLine(raw, after);
					if (first === null || sibling === null) {
						return null;
					}
					return [first, sibling];
				},
				nextEditLine,
				{ insertAfterContinuations: true, animateRecentSwap: true },
			);
		}, 0);
		return true;
	}

	private onEditorDeleteEmpty(): boolean {
		const line = this.editingLine;
		if (line === null) {
			return false;
		}
		const originalLine = this.editingOriginalLine;
		window.setTimeout(() => {
			void this.runLineAction(
				line,
				originalLine,
				() => '',
				line > 0 ? line - 1 : null,
				{ swallowContinuations: true, animateRecentSwap: true },
			);
		}, 0);
		return true;
	}

	private onEditorIndent(delta: number): boolean {
		const line = this.editingLine;
		if (line === null) {
			return false;
		}
		const originalLine = this.editingOriginalLine;
		window.setTimeout(() => {
			void this.runLineAction(
				line,
				originalLine,
				(raw) => setTaskIndent(raw, delta),
				line,
			);
		}, 0);
		return true;
	}

	private async runLineAction(
		line: number,
		originalLine: string,
		transform: TaskLineTransform,
		nextEditLine: number | null,
		options?: {
			swallowContinuations?: boolean;
			insertAfterContinuations?: boolean;
			/** 单任务新增/删除：开启「只显示最近任务」时补进出场动画（§2.5.1）。 */
			animateRecentSwap?: boolean;
			/** 插入后进入编辑态时的光标偏移（模板 `%%Cursor%%`；相对行 body）。 */
			caretOffset?: number | null;
		},
	): Promise<void> {
		const file = this.file;
		if (!file) {
			return;
		}

		this.destroyActiveEditor();
		this.destroyContinuationEditor();
		const outcome = await commitTaskLineAction(this.app, file, {
			line,
			originalLine,
			transform,
			swallowContinuations: options?.swallowContinuations,
			insertAfterContinuations: options?.insertAfterContinuations,
		});
		this.editingLine = null;
		this.continuationLine = null;
		this.applyOutcome(outcome);
		await this.reloadFromVault();
		this.renderNote(this.data, {
			animateRecentSwap: options?.animateRecentSwap === true,
		});

		if (outcome.status !== 'conflict' && nextEditLine !== null) {
			// beginEdit 内会把 selectedLine 落到新行上
			await this.beginEdit(nextEditLine, options?.caretOffset ?? null);
			return;
		}

		// 没有后继编辑目标（删空首行 / 冲突回滚）：原卡已不存在，清掉选中避免悬空态
		this.selectedLine = null;
		this.refreshDeleteButtonVisibility();
	}

	private applyOutcome(outcome: CommitOutcome): void {
		if (outcome.status === 'conflict') {
			new Notice(t('notice.iotoTaskView.commitConflict'));
		}
		this.syncCommittedContent(outcome);
	}

	/** 🔴 红线：写盘成功后 `data` 与 `lastLoadedText` 必须一起更新，
	 * 否则 `getViewData()` 会返回过期字节、被 TextFileView 写回去。 */
	private syncCommittedContent(outcome: CommitOutcome): void {
		if (outcome.status === 'ok') {
			this.data = outcome.content;
			this.lastLoadedText = outcome.content;
		}
	}

	private async toggleTask(line: number, cardEl: HTMLElement): Promise<void> {
		const file = this.file;
		if (!file) {
			return;
		}

		const currentMarker = cardEl.getAttribute('data-task') ?? ' ';
		const nextMarker: ' ' | 'x' =
			currentMarker.toLowerCase() === 'x' ? ' ' : 'x';

		// 乐观更新：先改 DOM，不等 vault.process 返回，保证点击手感。
		cardEl.setAttribute('data-task', nextMarker);
		const checkboxEl = cardEl.querySelector<HTMLElement>(
			'.ioto-task-view__card-checkbox',
		);
		if (checkboxEl) {
			setIcon(
				checkboxEl,
				nextMarker === 'x' ? 'check' : '',
			);
			checkboxEl.setAttribute(
				'aria-pressed',
				nextMarker === 'x' ? 'true' : 'false',
			);
		}

		// 编辑态内勾选：blur 提交若在途，先等它落定再定位，避免两次写盘对同一行
		// 互相错位（[[Report-20261007-092357]] §5.5）。正常操作下恒为 null，无副作用。
		if (this.pendingCommit) {
			await this.pendingCommit;
		}

		const originalLine = this.lineAt(line);
		const outcome = await commitTaskLineAction(this.app, file, {
			line,
			originalLine,
			transform: toggleTaskMarker,
		});

		if (outcome.status === 'ok') {
			this.data = outcome.content;
			this.lastLoadedText = outcome.content;

			// 编辑态内勾选：写盘后同步快照，等价于 autosaveEdit 的收尾，否则随后的
			// blur / autosave 提交会拿旧 originalLine 判 conflict → 整树重建冲掉编辑态
			// （[[Report-20261007-092357]] §2.3-1）。
			if (this.editingLine === line) {
				this.editingOriginalLine = this.lineAt(line);
			}

			// ② 开启时把新完成的任务「就地移除」（不整树重建，避免跳顶）。
			// 编辑态例外：该卡由「编辑中兜底」保持可见，就地移除等于把编辑器连根拔掉；
			// 退出编辑时改走 `doCommitEdit` 末尾的 `renderNote` 收尾（§5.3）。
			if (
				this.filters.onlyPending &&
				nextMarker === 'x' &&
				this.editingLine !== line
			) {
				// ⚠️ 落点必须用 pickAdjacentLine 取**真实**相邻行号：② 只动 DOM、
				// 不动文件行，行号不漂移；`pickLineAfterDelete` 的 −1 假设会让选中
				// 指向一张不存在的卡（[[Plan-20261004-110845]] §5.2）。
				const order = collectCardLines(this.contentEl);
				const next =
					pickAdjacentLine(order, line, 1) ??
					pickAdjacentLine(order, line, -1);

				// 就地移除这一条（不走 renderNote）同样补进出场
				// （[[Plan-20261005-150106]] §2.5.3 / Q2）：被勾掉的卡淡出、
				// 其余卡 FLIP 上移。快照必须在 remove() 之前采集。
				// [[Plan-20261005-152203]] §3.4：改为「同步 prepare + 双 rAF play」——
				// 其余卡不再先跳到新位再退回，被删卡不再有 2 帧空窗。
				this.cancelListTransition();
				const scrollEl =
					cardEl.closest<HTMLElement>(IOTO_TASK_SCROLL_SELECTOR);
				const oldSnapshots =
					scrollEl && !this.prefersReducedMotion()
						? captureCardSnapshots(
								scrollEl,
								IOTO_TASK_CARD_SELECTOR,
							)
						: [];
				cardEl.remove();
				if (scrollEl && oldSnapshots.length > 0) {
					const plan = prepareSwapTransition({
						scrollEl,
						oldSnapshots,
						newSnapshots: captureCardSnapshots(
							scrollEl,
							IOTO_TASK_CARD_SELECTOR,
						),
						reducedMotion: false,
					});
					if (plan) {
						const token = this.listTransitionToken;
						this.listTransitionCleanup = () => plan.cancel();
						this.scheduleListPlay(() => {
							if (
								token !== this.listTransitionToken ||
								!scrollEl.isConnected
							) {
								plan.cancel();
								return;
							}
							plan.play();
						});
					}
				}

				if (next !== null) {
					this.applySelection(next);
				} else {
					this.selectedLine = null;
					this.refreshDeleteButtonVisibility();
				}
			}
		} else if (outcome.status === 'conflict') {
			new Notice(t('notice.iotoTaskView.commitConflict'));
			await this.reloadFromVault();
			this.renderNote(this.data);
		}
	}

	/* ------------------------------------------------------------------ *
	 * 选中态 Mod+Enter：走 Obsidian Scope（见 select-mode-scope.ts 顶部注释）
	 * ------------------------------------------------------------------ */

	/** 暴露给 select-mode scope 的宿主；由 `resolveModEnterHost` 按 active leaf 取用。 */
	modEnterHost(): ModEnterHost {
		return {
			canToggleSelected: () => this.canToggleSelectedFromScope(),
			toggleSelected: () => this.toggleSelectedFromScope(),
		};
	}

	/**
	 * 能否由 scope 接管 Mod+Enter：非编辑态 + 有选中卡 + 卡片仍在 DOM 里。
	 *
	 * 🔴 编辑态必须放行（返回 `undefined` 交给核心）：内联编辑器里可能有未提交
	 * 正文，此时改标志位会让随后的 blur 提交判成冲突并丢字 —— 与原先
	 * `render-note.ts` Enter 分支的那条红线一致。
	 */
	private canToggleSelectedFromScope(): boolean {
		if (this.editingLine !== null) {
			return false;
		}
		// pending 期间屏蔽 Cmd/Ctrl+Enter 完成态切换：否则会经 Scope 改勾选态、刷单卡，
		// 遮罩语境失效（[[Plan-20261005-141853]] 步骤 1.4 / 坑 D）。
		if (this.pendingDeleteLine !== null) {
			return false;
		}
		if (this.selectedLine === null) {
			return false;
		}
		return this.queryCard(this.selectedLine) !== null;
	}

	/** scope 命中后的执行：复用点 checkbox 的同一条链路（乐观更新 + 原子写回）。 */
	private toggleSelectedFromScope(): void {
		const line = this.selectedLine;
		if (line === null) {
			return;
		}
		const cardEl = this.queryCard(line);
		if (!cardEl) {
			return;
		}
		void this.toggleTask(line, cardEl);
	}

	/**
	 * 命令面板 / 快捷键入口：仅转发到 `addTask`，不复制逻辑。
	 * 工具栏 Shift+点击转调 `insertEntryTemplate()`
	 * （[[Discuss-20261007-062838]] §六：`context` 缺省即普通添加）。
	 */
	triggerAddTask(context?: ToolbarButtonClickContext): void {
		if (context?.shiftKey) {
			void this.insertEntryTemplate();
			return;
		}
		void this.addTask();
	}

	/* ------------------------------------------------------------------ *
	 * Ctrl/Cmd+F 搜索：走 Obsidian Scope（见 search-scope.ts 顶部注释）
	 * ------------------------------------------------------------------ */

	/** 暴露给 search scope 的宿主（照 `modEnterHost` 范式）。 */
	searchHost(): SearchHost {
		return {
			canRevealSearch: () => this.canRevealSearchFromScope(),
			revealSearch: () => this.revealSearch(),
		};
	}

	/**
	 * 能否由 scope 接管 Mod+F：非编辑态（保留内嵌编辑器的 Cmd+F 查找）。
	 * 非 active 视图由 `resolveSearchHost` 先挡掉（返回 `null` → 放行）。
	 */
	private canRevealSearchFromScope(): boolean {
		return this.editingLine === null && this.continuationLine === null;
	}

	/** 供 main.ts 的 checkCallback 判定命令是否可用：与按钮只读态隐藏同口径。 */
	canAddTask(): boolean {
		return this.file !== null && this.supportsInlineEdit();
	}

	/** 供 main.ts 的 checkCallback 判定「插入条目模板」命令是否可用（同 canAddTask 口径）。 */
	canInsertEntryTemplate(): boolean {
		return this.file !== null && this.supportsInlineEdit();
	}

	/**
	 * 当前笔记 frontmatter 的 `Project` 值（取第一个为当前项目名）。
	 * `this.data` 在 `setViewData` 之前仍是 `null`，而 `onOpen` 建工具栏时就会经
	 * `hasAvailableEntryTemplate()` 走到这里 —— 若直接解引用会抛错、把 `buildToolbar()`
	 * 打断在「添加」按钮之前，待 `setViewData` 再建一次就成了「两排 toolbar」
	 * （[[Report-20261007-070144]]）。故先兜底成空串。
	 */
	private resolveCurrentProjectNames(): string[] {
		return extractListPropertyValuesFromContent(this.data ?? '', 'Project');
	}

	private resolveCurrentSubject(): string {
		return (
			extractListPropertyValuesFromContent(this.data ?? '', 'Subject')[0] ??
			''
		);
	}

	/**
	 * 「插入条目模板…」主入口（[[Plan-20261006-225329]] §5.4）：
	 * 门禁 → 项目过滤 → 选模板 → 收变量 → 求值/重定位 → 走 `runLineAction` 插入。
	 */
	async insertEntryTemplate(): Promise<void> {
		if (!this.file || !this.supportsInlineEdit()) {
			return; // 只读降级：静默（同「添加任务」口径 1605-1607）
		}

		const config = this.entryTemplateProvider();
		if (!config.enabled || config.templates.length === 0) {
			new Notice(t('notice.entryTemplate.notConfigured'));
			return;
		}

		const projectNames = this.resolveCurrentProjectNames();
		const currentProject = projectNames[0] ?? '';
		const available = config.templates.filter((template) =>
			isTemplateAvailableForProject(template, currentProject),
		);
		if (available.length === 0) {
			new Notice(t('notice.entryTemplate.noTemplateForProject'));
			return;
		}

		// 锚点在提交前快照：`commitEdit` 会清掉 `editingLine`。
		const anchorLine = this.selectedLine ?? this.editingLine;
		await this.commitEdit();

		const onlyTemplate = available[0];
		const template =
			available.length === 1
				? onlyTemplate
				: await new EntryTemplateSelectModal(
						this.app,
						available,
						currentProject,
					).openAndGetValue();
		if (!template) {
			return;
		}

		const variables = extractEntryTemplateVariables(template.content);
		let values: Record<string, string> = {};
		if (variables.length > 0) {
			const collected = await new EntryTemplateVariablesModal(
				this.app,
				variables,
			).openAndGetValue();
			if (!collected) {
				return;
			}
			values = collected;
		}

		const rendered = renderEntryTemplate(template.content, values, {
			now: new Date(),
			project: currentProject,
			subject: this.resolveCurrentSubject(),
		});

		if (anchorLine !== null) {
			const raw = this.lineAt(anchorLine);
			const parts = splitTaskLine(raw);
			const built = buildEntryTemplateLines(rendered, {
				line: raw,
				indentLevel: parts ? indentLevelOf(parts.indent) : 0,
				listMarker: parts?.listMarker ?? '- ',
			});
			if (built.lines.length === 0) {
				return;
			}
			const nextEditLine =
				anchorLine + 1 + this.countContinuationLines(anchorLine);
			await this.runLineAction(
				anchorLine,
				raw,
				(line) => [line, ...built.lines],
				nextEditLine,
				{
					insertAfterContinuations: true,
					animateRecentSwap: true,
					caretOffset: built.firstLineCursorOffset,
				},
			);
			return;
		}

		// 无锚点（极少）：退化为「追加到末条任务之后」的顶层落点，与 addTask 同口径。
		const built = buildEntryTemplateLines(rendered, {
			line: '- ',
			indentLevel: 0,
			listMarker: '- ',
		});
		if (built.lines.length === 0) {
			return;
		}
		await this.appendTaskBlock(() => built.lines, {
			caretOffset: built.firstLineCursorOffset,
		});
	}

	/* ------------------------------------------------------------------ *
	 * 批次 D — ④「添加任务」：三段式落点（文件末条 → 任务 Section 段首 → 文末建段）
	 * ------------------------------------------------------------------ */

	private async addTask(): Promise<void> {
		await this.appendTaskBlock((referenceLine) => [
			buildTopLevelTaskLine(referenceLine, ''),
		]);
	}

	/**
	 * 「添加任务」与「无锚点插入条目模板」共用的三段式落点：
	 * 文件末条之后 → `任务` Section 段首 → 文末新建 `# 任务` 段。
	 *
	 * `buildNewLines(referenceLine)` 返回要追加的行（不含定位行本身）：既有的
	 * 「添加任务」传「一条顶层空任务」，条目模板传模板展开后的多行。
	 * 逐字保持原 `addTask` 的行为（[[Plan-20261006-225329]] §5.1）。
	 */
	private async appendTaskBlock(
		buildNewLines: (referenceLine: string) => string[],
		options?: { caretOffset?: number | null },
	): Promise<void> {
		const file = this.file;
		if (!file || !this.supportsInlineEdit()) {
			return;
		}

		// 先落盘未提交正文，否则 runLineAction 里的 destroyActiveEditor 会丢弃它。
		await this.commitEdit();

		const items = parseChecklistItems(this.data, { includeEmpty: true });
		const last = items.length > 0 ? items[items.length - 1] : undefined;

		if (last) {
			// 文件级末条任务之后追加**顶层 0 级**任务。
			// 落点跨过末条任务的续行，避免新任务插到续行之前（同 insertSibling）。
			await this.runLineAction(
				last.line,
				this.lineAt(last.line),
				(raw) => [raw, ...buildNewLines(raw)],
				last.line + 1 + this.countContinuationLines(last.line),
				{
					insertAfterContinuations: true,
					animateRecentSwap: true,
					caretOffset: options?.caretOffset,
				},
			);
			return;
		}

		const section = this.findTasksSection();
		if (section) {
			// 无任务 → 在 `任务`/`Tasks` Section **段首**（标题行下一行）插入。
			await this.runLineAction(
				section.startLine,
				this.lineAt(section.startLine),
				(heading) => [heading, ...buildNewLines('- ')],
				section.startLine + 1,
				{
					animateRecentSwap: true,
					caretOffset: options?.caretOffset,
				},
			);
			return;
		}

		// 无 Section → 文末新建 `# 任务`（en `# Tasks`）再建任务。
		// 裸标题只用于 findTasksSection 的精确匹配（见 :1471），写进笔记时必须补 `# `，
		// 否则建出的是普通段落而非标题块。
		const sectionTitle = buildTasksSectionHeading(
			t('view.iotoTaskView.tasksSectionTitle'),
		);
		const lines = this.data.split('\n');
		const lastIndex = lines.length - 1;
		const lastLine = lines[lastIndex] ?? '';

		if (this.data.length === 0) {
			await this.runLineAction(
				0,
				'',
				() => [sectionTitle, ...buildNewLines('- ')],
				1,
				{
					animateRecentSwap: true,
					caretOffset: options?.caretOffset,
				},
			);
			return;
		}

		if (lastLine.trim() === '') {
			// 末行已是空行：直接复用为分隔，避免双空行。
			await this.runLineAction(
				lastIndex,
				lastLine,
				() => ['', sectionTitle, ...buildNewLines('- ')],
				lastIndex + 2,
				{
					animateRecentSwap: true,
					caretOffset: options?.caretOffset,
				},
			);
			return;
		}

		await this.runLineAction(
			lastIndex,
			lastLine,
			(raw) => [raw, '', sectionTitle, ...buildNewLines('- ')],
			lastIndex + 3,
			{
				animateRecentSwap: true,
				caretOffset: options?.caretOffset,
			},
		);
	}

	/** 按当前语言标题（去空白精确相等、多命中取最靠前）找 `任务`/`Tasks` Section。 */
	private findTasksSection(): ReturnType<typeof findSectionByTitle> {
		return findSectionByTitle(
			this.data,
			t('view.iotoTaskView.tasksSectionTitle'),
		);
	}

	/* ------------------------------------------------------------------ *
	 * 批次 E — ③「执行任务」：派发 ioto-settings 命令（粒度交给对方）
	 * ------------------------------------------------------------------ */

	/**
	 * 视图级「编辑落盘」原语：把**标题**与**续写**两个编辑器都提交到磁盘。
	 *
	 * 供「执行任务」命令族在派发**前**调用（`item-control-bridge` 拦截层），
	 * 因为 `ioto-settings` 的 `saveActiveNote` 只认 `MarkdownView`、会跳过
	 * IOTOTask（`TextFileView`），若不落盘，Agent 的 `vault.read` 读到的是旧正文
	 * （[[Discuss-20261006-150839]] §一）。
	 *
	 * 两个 `commit*` 在无编辑态时各自短路（幂等），故可无条件调用：
	 * 无待写内容 → 不写盘、不加延迟（§四 Q3 默认「直通」）。
	 */
	async flushInlineEdits(): Promise<void> {
		await this.commitEdit();
		await this.commitContinuationEdit();
	}

	/**
	 * 桥接层调用：开启「外部写回窗口」（[[Research-20261008-105532]] 方案 A）。
	 * 未处于任一编辑态（标题 / 续行）→ 返回 false，桥接层原样透传。
	 */
	beginExternalEditorWriteback(): boolean {
		if (this.editingLine === null && this.continuationLine === null) {
			return false;
		}
		this.externalWritebackActive = true;
		this.externalWritebackBlurred = false;
		this.externalWritebackDirty = false;
		// 窗口内不自动落盘：写回与退出统一由 endExternalEditorWriteback 收口，
		// 避免模板中途写盘先销毁编辑器（方案 A 的反向风险）。
		this.autosave.cancel();
		return true;
	}

	/**
	 * 桥接层调用：命令结束（无论成败）关闭窗口。
	 * 期间发生过 blur（换视图）或内容变更（模板写回）→ 补一次提交：
	 * 把含回填链接的最新正文写盘 + 退出编辑态 + 刷新卡片（复用既有提交原语）。
	 */
	endExternalEditorWriteback(): void {
		if (!this.externalWritebackActive) {
			return;
		}
		const shouldCommit =
			this.externalWritebackBlurred || this.externalWritebackDirty;
		this.externalWritebackActive = false;
		this.externalWritebackBlurred = false;
		this.externalWritebackDirty = false;
		if (!shouldCommit) {
			return;
		}
		// 标题 / 续行互斥，各自幂等短路；commit 内部已 destroyActiveEditor + 写盘 + 刷新。
		void this.commitEdit().then(() => this.commitContinuationEdit());
	}

	private async runTask(): Promise<void> {
		// 先落盘（标题 + 续写），再派发：`executeCommandById` 内部走被包装的
		// `executeCommand`，对方 `resolveRunGate` 会立刻读盘。
		await this.flushInlineEdits();

		const registry = (this.app as App & { commands?: CommandRegistryLike })
			.commands;
		if (
			!registry?.commands ||
			!(RUN_TASK_COMMAND_ID in registry.commands) ||
			!registry.executeCommandById
		) {
			new Notice(t('notice.iotoTaskView.runTaskUnavailable'));
			return;
		}

		await Promise.resolve(registry.executeCommandById(RUN_TASK_COMMAND_ID));
	}

	/* ------------------------------------------------------------------ *
	 * 导出为图片（[[Plan-20261006-102142]]，路线依据 [[Discuss-20261006-101334]]）
	 * ------------------------------------------------------------------ */

	/** 命令 / 工具栏入口：把当前所见导出为 PNG 附件（按内容全高的长图，写库内附件目录）。 */
	async exportAsImage(): Promise<void> {
		const captured = await this.captureForExport();
		if (!captured) {
			return;
		}

		try {
			const path = await saveCanvasToVault(
				this.app,
				captured.canvas,
				buildExportFileName(captured.baseName, new Date()),
				{ sourcePath: this.file?.path },
			);
			new Notice(t('notice.exportTaskViewImage.saved', [path]));
		} catch (error) {
			console.error('[ioto-tasks-center] save exported image failed', error);
			new Notice(t('notice.exportTaskViewImage.failed'));
		}
	}

	/** 命令入口：把当前所见复制到系统剪贴板（恒 PNG）。桌面失败回退 Electron 原生剪贴板。 */
	async copyImageToClipboard(): Promise<void> {
		const captured = await this.captureForExport();
		if (!captured) {
			return;
		}

		try {
			await copyCanvasToClipboard(captured.canvas);
			new Notice(t('notice.exportTaskViewImage.copied'));
			return;
		} catch {
			// 落到 Electron 回退（桌面）；移动端 / 无权限下同样会失败，最终给 Notice（不静默）。
		}

		if (await this.copyCanvasViaElectron(captured.canvas)) {
			new Notice(t('notice.exportTaskViewImage.copied'));
			return;
		}
		new Notice(t('notice.exportTaskViewImage.copyFailed'));
	}

	/**
	 * 导出共用链：重入锁 → 生成中 Notice → 解析宽度 / 背景 / 倍率 → 光栅化。
	 *
	 * **完全不改实时 DOM**（含滚动位置、选中态、卡片类）：`captureTaskViewCanvas` 拍的是
	 * 重建后的离屏克隆，瞬时态（选中 / 待删除确认）在克隆上摘除（[[Plan-20261006-102142]] §三.7）。
	 */
	private async captureForExport(): Promise<{
		canvas: HTMLCanvasElement;
		baseName: string;
	} | null> {
		if (this.isExporting) {
			return null;
		}

		const scrollEl = this.contentEl.querySelector<HTMLElement>(
			IOTO_TASK_SCROLL_SELECTOR,
		);
		if (!scrollEl || scrollEl.scrollHeight <= 0) {
			new Notice(t('notice.exportTaskViewImage.failed'));
			return null;
		}

		this.isExporting = true;
		new Notice(t('notice.exportTaskViewImage.generating'));
		try {
			const options = this.exportOptionsProvider();
			const width =
				options.widthMode === 'fixed'
					? options.fixedWidth
					: scrollEl.clientWidth;
			const backgroundColor = resolveExportBackground(this.contentEl);
			const desiredScale = clampExportScale(options.scale);

			const result = await captureTaskViewCanvas(scrollEl, {
				width,
				desiredScale,
				backgroundColor,
			});

			const baseName =
				this.app.workspace.getActiveFile()?.basename ??
				this.file?.basename ??
				this.getDisplayText();
			let canvas = options.withHeader
				? composeExportHeader(result.canvas, {
						title: baseName,
						at: new Date(),
						backgroundColor,
						textColor: readableTextColor(backgroundColor),
						scale: result.scale,
					})
				: result.canvas;
			// 先页眉、后页尾，各自只在一端追加，互不干扰（[[Discuss-20261008-091032]] §2.4）。
			if (options.withFooter) {
				canvas = composeExportFooter(canvas, {
					backgroundColor,
					textColor: readableTextColor(backgroundColor),
					scale: result.scale,
				});
			}

			// 逐条如实提示：降倍率 / 封顶 / 拍不到内容 / 玻璃主题降级（[[Plan-20261006-102142]] §三.5）。
			if (result.scale < desiredScale) {
				new Notice(
					t('notice.exportTaskViewImage.scaleReduced', [
						String(result.scale),
					]),
				);
			}
			if (result.heightCapped) {
				new Notice(t('notice.exportTaskViewImage.heightCapped'));
			}
			if (result.partial) {
				new Notice(t('notice.exportTaskViewImage.partial'));
			}
			if (this.appearanceStyleProvider() === 'glass') {
				new Notice(t('notice.exportTaskViewImage.glassDegraded'));
			}

			return { canvas, baseName };
		} catch (error) {
			console.error('[ioto-tasks-center] capture task view failed', error);
			new Notice(t('notice.exportTaskViewImage.failed'));
			return null;
		} finally {
			this.isExporting = false;
		}
	}

	/** 桌面回退：`navigator.clipboard` 不可用时走 Electron 原生剪贴板；失败返回 false（由调用方提示）。 */
	private async copyCanvasViaElectron(
		canvas: HTMLCanvasElement,
	): Promise<boolean> {
		try {
			const blob = await canvasToBlob(canvas, 'image/png');
			const buffer = await blob.arrayBuffer();
			// 渲染进程 `require('electron')` 可用（nodeIntegration 开启，见 [[reference_obsidian_renderer_electron_access]]）；
			// 移动端没有 `require`，故整段包在 try 里。`require` / `Buffer` 由 nodeIntegration 提供，
			// 不是浏览器全局（本插件 eslint globals 为 browser），这里就地声明。
			/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
			const electron = require('electron') as {
				clipboard: { writeImage: (image: unknown) => void };
				nativeImage: { createFromBuffer: (data: Buffer) => unknown };
			};
			electron.clipboard.writeImage(
				electron.nativeImage.createFromBuffer(Buffer.from(buffer)),
			);
			/* eslint-enable no-undef, @typescript-eslint/no-require-imports */
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * 解析「当前 active 的 IOTOTask 视图」的 Mod+Enter 宿主；active view 不是本类型时
 * 返回 `null`（scope 据此放行给核心）。
 *
 * 供 `main.ts` 注册的 select-mode scope 每次按键调用：多个 IOTOTask leaf 同时打开
 * 时，只有 active 的那个会接管，避免误改另一个 leaf 里选中的卡片。
 */
export function resolveModEnterHost(app: App): ModEnterHost | null {
	const view = app.workspace.getActiveViewOfType(IOTOTaskView);
	return view ? view.modEnterHost() : null;
}

/**
 * 解析「当前 active 的 IOTOTask 视图」的 Ctrl/Cmd+F 搜索宿主；active view 不是本类型
 * 时返回 `null`（scope 据此放行给核心，避免吞掉别的视图的 `Cmd+F`）。
 */
export function resolveSearchHost(app: App): SearchHost | null {
	const view = app.workspace.getActiveViewOfType(IOTOTaskView);
	return view ? view.searchHost() : null;
}
