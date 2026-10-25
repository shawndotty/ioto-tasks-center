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
 *
 * 拆分（[[Plan-20261003-073911]] Phase 7）：本文件只保留生命周期 + 状态字段 +
 * 薄代理方法；具体逻辑分布在 `./ioto-task/task-view-*.ts` 16 个聚焦模块里。
 * 跨模块调用一律经 `view.xxx()`（薄代理），避免循环 import。
 */

import {
	Scope,
	TextFileView,
	type HoverPopover,
	type TFile,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import { t } from '../lang/helpter';
import type {
	TaskFileLinkViewMode,
	TaskViewAppearanceStyle,
	TaskViewExportOptions,
} from '../settings';
import {
	type EntryTemplateConfig,
} from '../tasks-center/task-entry-template';
import {
	createAutosaveScheduler,
	type AutosaveScheduler,
} from './ioto-task/edit-autosave';
import type { EmbeddedEditorHandle } from './ioto-task/embedded-editor';
import {
	resetEditingLines,
	resolveEditingKind,
	type EditingKind,
} from './ioto-task/task-view-editing-state';
import type {
	TaskContinuationFold,
	TaskNoteEditing,
	TaskNoteFilters,
	TaskNoteLinks,
} from './ioto-task/render-note-types';
import {
	registerModEnterHandler,
	type ModEnterHost,
} from './ioto-task/select-mode-scope';
import {
	registerSearchHandler,
	type SearchHost,
} from './ioto-task/search-scope';
import { IOTO_TASK_VIEW_TYPE } from './ioto-task/item-control-bridge';
import {
	AUTOSAVE_INTERVAL_MS,
	type ItemControlBridgeHost,
	type ToolbarButtonClickContext,
} from './ioto-task/task-view-constants';
import {
	lineAt,
	countContinuationLines,
	queryCard,
} from './ioto-task/task-view-helpers';
import {
	applyAppearanceStyle,
	applyDeleteButtonSetting,
	applyEntryTemplate,
	applyMobileSectionActions,
	applyRecentTaskCount,
	buildToolbar,
	refreshDeleteButtonVisibility,
	refreshToolbarState,
} from './ioto-task/task-view-toolbar';
import {
	closeSearch,
	highlightMatch,
	isSearchOpen,
	onSearchInput,
	refreshSearchNavState,
	refreshSearchToggleState,
	resetSearchState,
	revealSearch,
	searchHost,
	stepMatch,
	toggleSearch,
} from './ioto-task/task-view-search';
import {
	reloadFilters,
	shiftTrackedLines,
	toggleFilter,
} from './ioto-task/task-view-filters';
import {
	buildEditingController,
	buildLinkController,
	cancelListTransition,
	prefersReducedMotion,
	reloadFromVault,
	renderNote,
	scheduleListPlay,
	syncSelectionClass,
} from './ioto-task/task-view-render';
import {
	buildContinuationFoldController,
	hasContinuationFolds,
	hydrateContinuationFolds,
	toggleAllContinuationFolds as toggleAllContinuationFoldsFn,
} from './ioto-task/task-view-continuation-fold';
import {
	hasSectionFolds,
	hydrateSectionFolds,
	toggleAllSectionFolds as toggleAllSectionFoldsFn,
} from './ioto-task/task-view-section-fold';
import {
	applyZoomDom,
	enterZoom,
	exitZoom,
	flushZoomEdit,
	focusZoomEditor,
	restoreZoom,
	syncZoomButton,
	toggleZoomCard,
} from './ioto-task/task-view-zoom';
import {
	enterSectionZoom,
	exitSectionZoom,
	resetSectionZoomState,
	restoreSectionZoom,
	toggleSectionZoom,
} from './ioto-task/task-view-section-zoom';
import {
	areCardActionCommandsReady,
	awaitCommandReadiness,
	canDispatch,
	clearCommandReadinessTimer,
	dispatchCommand,
} from './ioto-task/task-view-command-readiness';
import {
	applySelection,
	beginContinuationOrNew,
	cancelPendingDelete,
	canToggleSelectedFromScope,
	confirmPendingDelete,
	deleteSelected,
	enterPendingDelete,
	indentSelected,
	insertSibling,
	modEnterHost,
	requestDelete,
	restoreSelectionFocusAfterBlurCommit,
	scrollCardIntoView,
	select,
	toggleSelectedFromScope,
} from './ioto-task/task-view-selection';
import {
	autosaveEdit,
	beginEdit,
	commitEdit,
	destroyActiveEditor,
	doCommitEdit,
	expandSectionContaining,
	refreshCard,
	refreshCardActions,
} from './ioto-task/task-view-inline-edit';
import {
	autosaveContinuation,
	beginContinuationEdit,
	beginNewContinuationEdit,
	commitContinuationEdit,
	destroyContinuationEditor,
	onContinuationDeleteEmpty,
	onContinuationEnter,
	onContinuationEscape,
} from './ioto-task/task-view-continuation-edit';
import {
	autosaveSection,
	beginSectionEdit,
	commitSectionEdit,
	destroySectionEditor,
} from './ioto-task/task-view-section-edit';
import {
	beginSectionTitleEdit,
	commitSectionTitleEdit,
	destroySectionTitleEditor,
	type SectionTitleEditorHandle,
} from './ioto-task/task-view-section-title-edit';
import { deleteSection } from './ioto-task/task-view-section-delete';
import {
	applyOutcome,
	onEditorDeleteEmpty,
	onEditorEnter,
	onEditorEscape,
	onEditorIndent,
	onEditorSoftBreak,
	runLineAction,
	syncCommittedContent,
	toggleTask,
} from './ioto-task/task-view-editor-handlers';
import type { CommitOutcome, TaskLineTransform } from './ioto-task/commit-task-line';
import {
	commitFromItemControl,
	getAITaskItemSource,
	getItemControlHost,
	getQuickPanelHost,
} from './ioto-task/task-view-item-control-host';
import {
	addTask,
	appendTaskBlock,
	canAddTask,
	canDuplicateTask,
	canInsertEntryTemplate,
	canMarkAllTasksDone,
	canSwapSelectedTask,
	canTogglePrimarySection,
	canToggleSelectedTaskPin,
	duplicateSelectedTask,
	duplicateTask,
	findTasksSection,
	insertEntryTemplate,
	markAllTasksDone,
	resolveCurrentProjectNames,
	resolveCurrentSubject,
	runTask,
	swapSelectedTask,
	toggleCurrentPrimarySection,
	togglePrimarySection,
	toggleSelectedTaskPin,
	toggleTaskPin,
	toggleTaskRepeat,
	triggerAddTask,
} from './ioto-task/task-view-task-commands';
import { addSection } from './ioto-task/task-view-add-section';
import {
	beginExternalEditorWriteback,
	endExternalEditorWriteback,
	flushInlineEdits,
} from './ioto-task/task-view-external-writeback';
import {
	captureForExport,
	copyCanvasViaElectron,
	copyImageToClipboard,
	exportAsImage,
} from './ioto-task/task-view-export-image';

export { IOTO_TASK_VIEW_TYPE };
// `ItemControlBridgeHost` 原本定义在本文件，Phase 7 迁到 `task-view-constants.ts`；
// 此处保留导出路径不变，外部 import 仍从本文件取（item-control-bridge / fit-anchored-popup）。
export type { ItemControlBridgeHost } from './ioto-task/task-view-constants';

/** `getState` 导出的折叠键数组 → 只留 string（老 `workspace.json` 可能脏）。 */
function toKeyList(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((key): key is string => typeof key === 'string');
}

export class IOTOTaskView extends TextFileView {
	collapsedSections = new Set<string>();
	/**
	 * 续写区折叠态（键 = 续写正文哈希，[[Plan-20261022-232148]] S2）。
	 * **内存真源**；每次装载由 `hydrateContinuationFolds` 按笔记路径从 store 灌回
	 * （`task-view-fold-store.ts`，[[Plan-20261023-001403]] S3）。`clear()` 仍负责把
	 * 叶子态归零，「同一叶子换文件」的串态由 hydrate 的按路径取数挡住。
	 */
	continuationCollapsed = new Set<string>();
	/**
	 * `state` 里带来的叶子级折叠键，等 hydrate 认领（一次性迁移用）。
	 * 🔴 不能直接写进 `continuationCollapsed` / `collapsedSections`：`setState` 早于
	 * `loadFile`，随后的 `setViewData(clear=true)` → `clear()` 会把刚写进去的键擦掉。
	 * `continuations` / `sections` 分别由两个 hydrate 认领
	 * （[[Plan-20261023-062616]] S5）。
	 */
	pendingLeafFolds: {
		path: string;
		continuations: string[];
		sections: string[];
	} | null = null;
	lastLoadedText = '';
	isRendering = false;
	/** 见 `TaskViewHost.cancelActiveDrag`：结构化实现接口，需显式声明。 */
	cancelActiveDrag?: () => void;
	/**
	 * 命令就绪补偿计时器句柄（[[Research-20261008-122828]] 方案 A）：`null` = 无在途
	 * 轮询。渲染时若 ioto-settings 两条命令尚未注册，则挂一趟短轮询，命令一旦出现就
	 * 对全部卡补建动作按钮；命令齐 / 超时即自停，连续重绘共用同一趟、不叠加。
	 */
	commandReadinessTimer: number | null = null;
	editingLine: number | null = null;
	/**
	 * Section 编辑态的 `startLine`（= 被编辑 Section 的 `startLine`）；非编辑态 `null`。
	 * `resolveEditingKind` 见到即返回 `'section'`。
	 */
	sectionEditLine: number | null = null;
	/** Section 编辑块首行（快照，0 基，含）。 */
	sectionEditStartLine = 0;
	/** Section 编辑块末行（快照，0 基，含）。 */
	sectionEditEndLine = 0;
	/** Section 编辑块各行原文（快照，行漂移后二次定位用）。 */
	sectionEditOriginalLines: string[] = [];
	/** Section 编辑器句柄（`null` = 未挂载）。 */
	sectionEditHandle: EmbeddedEditorHandle | null = null;
	/** Section 编辑器宿主 div（`destroy()` 只 empty 不 remove，需显式回收）。 */
	sectionEditHostEl: HTMLElement | null = null;
	/** Section 标题编辑态：被改名 Section 的 `startLine`；非编辑态 `null`。 */
	sectionTitleEditLine: number | null = null;
	/** 标题行原文快照（提交时做行漂移复核）。 */
	sectionTitleEditOriginalLine = '';
	/** 标题输入框句柄（`null` = 未挂载）。 */
	sectionTitleEditHandle: SectionTitleEditorHandle | null = null;
	/** 带 `.is-title-editing` 的 `<section>`。 */
	sectionTitleEditSectionEl: HTMLElement | null = null;
	/**
	 * 派生真源：**由四个行号推导**（`resolveEditingKind`），绝不手工同步第二份状态。
	 * 13 处「有没有编辑器 / 是不是卡片级编辑」的判据全部只问它。
	 */
	get editingKind(): EditingKind {
		return resolveEditingKind(this);
	}
	/**
	 * 聚焦放大态的文件行号（0 基）；非放大 `null`。**瞬态**：不进 `getState`，
	 * 且在退出编辑 / 换文件 / 清空时解除（[[Discuss-20261008-111641]] §2.5）。
	 */
	zoomLine: number | null = null;
	/**
	 * 「只看本节」聚焦的 Section `startLine`；未聚焦 `null`。**瞬态**：不落盘、不进
	 * `getState`，换文件 / 清空时与 `zoomLine` 一同清零
	 * （[[Research-20261019-131228]] §4.1）。
	 */
	sectionZoomLine: number | null = null;
	/**
	 * 主任务区命中的顶层 Section `startLine`；未标记 / 属性失效 → `null`。
	 * 每次重绘由 `reloadFilters()` 从 `data` 重算（外部改属性自动生效）。
	 */
	primarySectionLine: number | null = null;
	/** 进入聚焦前的滚动位置（退出恢复）。 */
	sectionZoomScrollTop: number | null = null;
	/** 进入聚焦前选中的行（退出时尽力回填）。 */
	sectionZoomPrevSelectedLine: number | null = null;
	/**
	 * 选择态行号（[[Plan-20261003-194909]] §四）。
	 *
	 * `idle → selected → editing` 显式状态机的载体：**同一时刻只有一张卡片被选中**，
	 * 且 `selected` 是 `editing` 的前置态。按拍板结论**不持久化**（不进 `getState`），
	 * 但必须**可重建**——任何整树重建（折叠 / 删除 / 外部写入）后由 `syncSelectionClass` 回填。
	 */
	selectedLine: number | null = null;
	/**
	 * 待删除确认中的文件行号（0 基）；非 pending 为 `null`。选择态**瞬态子状态**，
	 * 不持久化，也不引入第四个大状态（[[Plan-20261005-141853]] §三）。
	 *
	 * 它是唯一真源；同一时刻最多一个遮罩，`pendingDeleteEl` 只是它的 DOM 影子。
	 */
	pendingDeleteLine: number | null = null;
	/** 当前遮罩元素（回收用）；与 `pendingDeleteLine` 同生共死。 */
	pendingDeleteEl: HTMLElement | null = null;
	/**
	 * 进出场动画自增令牌：新一次渲染 / 收尾立即作废上一场的异步 rAF 回调
	 * （[[Plan-20261005-150106]] 坑 6，避免连续增删叠影）。
	 */
	listTransitionToken = 0;
	/** 上一场动画的收尾函数（移除浮层、清临时类与 inline transform）。 */
	listTransitionCleanup: (() => void) | null = null;
	editingOriginalLine = '';
	editingHandle: EmbeddedEditorHandle | null = null;
	/**
	 * 续行编辑态：拥有该续行的任务行（0 基文件行号）；非编辑态为 `null`。
	 * 与 `editingLine`（标题编辑器）互斥，进入任一方前先提交另一方。
	 */
	continuationLine: number | null = null;
	continuationStartLine = 0;
	continuationEndLine = 0;
	continuationOriginalLines: string[] = [];
	continuationHandle: EmbeddedEditorHandle | null = null;
	/** 当前续行编辑器的宿主 div（`destroy()` 只 empty 不 remove，需在此显式回收） */
	continuationHostEl: HTMLElement | null = null;
	/** 本次续行编辑器是否为「新建草稿」（磁盘上尚无该续行块）：空草稿不落盘、不走自动落盘。 */
	continuationIsNew = false;
	/** 新建草稿时临时创建的 `.card-continuation` 容器（回收用；复用既有容器时为 `null`）。 */
	continuationDraftContainerEl: HTMLElement | null = null;
	pendingCommit: Promise<void> | null = null;
	/** 自动落盘节流器（视图级单例，编辑期间复用） */
	readonly autosave: AutosaveScheduler = createAutosaveScheduler(
		() => {
			void this.autosaveEdit();
		},
		AUTOSAVE_INTERVAL_MS,
	);
	/** 自动落盘进行中：与 `pendingCommit`（blur 提交）互斥，避免并发写同一行 */
	autosaveRunning = false;
	/**
	 * 外部写回窗口（[[Research-20261008-105532]] 方案 A）：Templater 等命令运行期
	 * 挂起 blur 销毁，使事后的 `replaceSelection` 落在活编辑器上。
	 */
	externalWritebackActive = false;
	/** 窗口内是否发生过 blur（换视图等）→ 结束后据此补一次提交退出编辑态。 */
	externalWritebackBlurred = false;
	/** 窗口内文档是否变更（模板写回）→ 结束后据此补一次提交（无 blur 也要落盘）。 */
	externalWritebackDirty = false;
	readonly supportsInlineEdit: () => boolean;
	readonly appearanceStyleProvider: () => TaskViewAppearanceStyle;
	readonly recentTaskCountProvider: () => number;
	readonly exportOptionsProvider: () => TaskViewExportOptions;
	/** 条目模板配置（只读快照，触发时取一次）。 */
	readonly entryTemplateProvider: () => EntryTemplateConfig;
	/** 桌面端是否显示工具栏「删除」按钮（移动端恒显示，见 `refreshDeleteButtonVisibility`）。 */
	readonly deleteButtonOnDesktopProvider: () => boolean;
	/** 手机端是否显示 Section 标题栏图标（[[Plan-20261019-202817]] §3.5）。 */
	readonly mobileSectionActionsVisibleProvider: () => boolean;
	/** 视图内链接打开方式 + 任务根目录（[[Plan-20261025-103944]] §3.4）。 */
	readonly taskFileLinkPolicyProvider: () => {
		mode: TaskFileLinkViewMode;
		tasksRootPath: string;
	};
	/**
	 * 导出重入锁（[[Plan-20261006-102142]] §三.6）：克隆几百张卡 + 内联样式可能耗时数秒，
	 * 期间禁止重复触发（工具栏连点 / 命令面板重入）。
	 */
	isExporting = false;
	/**
	 * 视图级稳定对象：否则弹窗无法复用 / 关闭
	 * （与 `iotoTasksCenterView` 同一口径，[[Plan-20261004-004408]] §3.2 ④）。
	 */
	readonly hoverPreviewParent: { hoverPopover: HoverPopover | null } =
		{
			hoverPopover: null,
		};
	/**
	 * 顶部固定控制栏（[[Plan-20261004-110845]] 批次 A）：`__toolbar` + `__body` 是
	 * 常驻外壳，`renderNote` 只重建 `__body` 内容，栏不随列表滚动、重绘不闪。
	 */
	toolbarEl: HTMLElement | null = null;
	bodyEl: HTMLElement | null = null;
	toggleTaskBlocksEl: HTMLButtonElement | null = null;
	togglePendingEl: HTMLButtonElement | null = null;
	toggleRecentEl: HTMLButtonElement | null = null;
	/** 工具栏「搜索任务」开关按钮：按下态 = 搜索条已展开。 */
	searchToggleEl: HTMLButtonElement | null = null;
	runTaskEl: HTMLButtonElement | null = null;
	addTaskEl: HTMLButtonElement | null = null;
	/** 工具栏「删除」入口（[[Plan-20261007-194826]]）：仅在有选中卡且未编辑时可见。 */
	deleteTaskEl: HTMLButtonElement | null = null;
	/**
	 * 搜索关键词：**瞬态**，不进 `getState` / 不写 frontmatter / 关闭即归零
	 * （[[Plan-20261006-161121]] §2.3a、§三.3）。
	 */
	searchQuery = '';
	searchBarEl: HTMLElement | null = null;
	searchInputEl: HTMLInputElement | null = null;
	searchPrevEl: HTMLButtonElement | null = null;
	searchNextEl: HTMLButtonElement | null = null;
	searchDebounce: number | null = null;
	/** 过滤开关运行态：**每次 renderNote 从 `this.data`（frontmatter）重读**，不持久化。 */
	filters: TaskNoteFilters = {
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
		mobileSectionActionsVisibleProvider: () => boolean,
		taskFileLinkPolicyProvider: () => {
			mode: TaskFileLinkViewMode;
			tasksRootPath: string;
		},
	) {
		super(leaf);
		this.allowNoFile = false;
		this.supportsInlineEdit = supportsInlineEdit;
		this.appearanceStyleProvider = appearanceStyleProvider;
		this.recentTaskCountProvider = recentTaskCountProvider;
		this.exportOptionsProvider = exportOptionsProvider;
		this.entryTemplateProvider = entryTemplateProvider;
		this.deleteButtonOnDesktopProvider = deleteButtonOnDesktopProvider;
		this.mobileSectionActionsVisibleProvider =
			mobileSectionActionsVisibleProvider;
		this.taskFileLinkPolicyProvider = taskFileLinkPolicyProvider;

		// 视图级热键：Mod+F（任务搜索）/ Mod+Enter（切换选中卡完成态）。
		//
		// 核心 Workspace 的 scope 是 DeferredScope —— 每次 keydown 现取
		// `activeLeaf.view.scope`（没有才回落 root），因此挂在这里的键天然只在
		// 「本视图是 activeLeaf」时参与分发，笔记里照常走核心 `editor:open-search`。
		//
		// 🔴 绝不能改回 `app.keymap.pushScope(...)` 常驻：那会把 DeferredScope
		// 埋进 prevScopes，并让 `Scope.handleKey` 对「命中具体键位但回调 return
		// undefined」直接返回，导致核心热键被静默吞掉（[[Research-20261024-181347]] §2.2 / §2.3）。
		const scope = new Scope(this.app.scope);
		registerSearchHandler(scope, () => this.searchHost());
		registerModEnterHandler(scope, () => this.modEnterHost());
		this.scope = scope;
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
		// 换文件 / 重载不带旧的「只看本节」状态（与 `zoomLine` 同口径）。
		resetSectionZoomState(this);
		// 主任务区行号随后由 `renderNote → reloadFilters` 按新 `data` 重算，先归零防串态。
		this.primarySectionLine = null;
		if (clear) {
			// `clear()` 已把叶子态归零；此处按笔记路径从 store 灌回
			// （[[Plan-20261023-001403]] §0.2：必须在唯一一次 `renderNote` 之前完成，
			// 卡片构建期同步读 `isCollapsed`，不需要第二次渲染）。
			// pending 取一次两处共用（`takePendingLeafFolds()` 取走即清空）。
			const pending = this.takePendingLeafFolds();
			hydrateContinuationFolds(this, pending);
			hydrateSectionFolds(this, pending);
		}
		this.renderNote(data);
	}

	clear(): void {
		// 同步插件关笔记 / 换文件会走这里（bodyEl.empty() 同理会摘掉正在拖的手柄）。
		this.cancelActiveDrag?.();
		this.destroyActiveEditor();
		this.destroyContinuationEditor();
		this.destroySectionEditor();
		this.destroySectionTitleEditor();
		// 行号字段整体归零（含 sectionEditLine / sectionTitleEditLine）：destroy 在前、清字段在后。
		resetEditingLines(this);
		this.zoomLine = null;
		resetSectionZoomState(this);
		this.primarySectionLine = null;
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
		this.continuationCollapsed.clear();
	}

	onunload(): void {
		this.destroyActiveEditor();
		this.destroyContinuationEditor();
		this.destroySectionEditor();
		this.destroySectionTitleEditor();
		resetEditingLines(this);
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
			continuationCollapsed: [...this.continuationCollapsed],
		};
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === 'object') {
			const file = (state as { file?: unknown }).file;
			const path = typeof file === 'string' ? file : '';
			// 两组叶子级折叠键**都只收不发**（直接写集合会被随后的 `clear()` 擦掉），
			// 暂存后由两个 hydrate 在装载时认领（[[Plan-20261023-001403]] S2 /
			// [[Plan-20261023-062616]] S5）。
			// 🔴 `collapsedSections` 是**迁移源**：store 里没有记录时，hydrate 会把这些
			// legacy 行号键按标题认领成新键（只认领一次）；store 有记录时它们被忽略。
			const collapsed = (state as { collapsedSections?: unknown })
				.collapsedSections;
			const contCollapsed = (state as { continuationCollapsed?: unknown })
				.continuationCollapsed;
			if (Array.isArray(collapsed) || Array.isArray(contCollapsed)) {
				this.pendingLeafFolds = {
					path,
					continuations: toKeyList(contCollapsed),
					sections: toKeyList(collapsed),
				};
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
		// 紧随外观：类挂在 contentEl，首次 renderNote 之前就位，不会闪一下
		// （[[Plan-20261019-202817]] §3.5）。
		this.applyMobileSectionActions();
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
	 * 薄代理方法：转发到 `./ioto-task/task-view-*.ts` 模块函数（Phase 7 拆分）。
	 * 跨模块调用经 `this.xxx()` 路由，避免循环 import；外部 main.ts 仍调本类方法。
	 * ------------------------------------------------------------------ */

	// ---- 顶部控制栏 ----
	buildToolbar(): void { buildToolbar(this); }
	refreshToolbarState(): void { refreshToolbarState(this); }
	refreshDeleteButtonVisibility(): void { refreshDeleteButtonVisibility(this); }
	applyDeleteButtonSetting(): void { applyDeleteButtonSetting(this); }
	applyAppearanceStyle(): void { applyAppearanceStyle(this); }
	applyMobileSectionActions(): void { applyMobileSectionActions(this); }
	applyRecentTaskCount(): void { applyRecentTaskCount(this); }
	applyEntryTemplate(): void { applyEntryTemplate(this); }

	// ---- 关键词搜索条 ----
	revealSearch(): void { revealSearch(this); }
	isSearchOpen(): boolean { return isSearchOpen(this); }
	toggleSearch(): void { toggleSearch(this); }
	refreshSearchToggleState(): void { refreshSearchToggleState(this); }
	onSearchInput(): void { onSearchInput(this); }
	async applySearchQuery(value: string): Promise<void> { await applySearchQueryFn(this, value); }
	closeSearch(): void { closeSearch(this); }
	stepMatch(delta: 1 | -1): void { stepMatch(this, delta); }
	highlightMatch(line: number): void { highlightMatch(this, line); }
	refreshSearchNavState(): void { refreshSearchNavState(this); }
	resetSearchState(): void { resetSearchState(this); }
	canRevealSearchFromScope(): boolean { return canRevealSearchFromScopeFn(this); }
	searchHost(): SearchHost { return searchHost(this); }

	// ---- 过滤开关 ----
	reloadFilters(): void { reloadFilters(this); }
	async toggleFilter(kind: keyof TaskNoteFilters): Promise<void> { await toggleFilter(this, kind); }
	shiftTrackedLines(delta: number, oldContent: string, newContent: string): void {
		shiftTrackedLines(this, delta, oldContent, newContent);
	}

	// ---- 渲染主入口 ----
	renderNote(
		data: string,
		options?: {
			skipAnchorRestore?: boolean;
			animateRecentSwap?: boolean;
			resetScroll?: boolean;
		},
	): void {
		renderNote(this, data, options);
	}
	scheduleListPlay(callback: () => void): void { scheduleListPlay(this, callback); }
	cancelListTransition(): void { cancelListTransition(this); }
	prefersReducedMotion(): boolean { return prefersReducedMotion(this); }
	syncSelectionClass(): void { syncSelectionClass(this); }
	async reloadFromVault(): Promise<void> { await reloadFromVault(this); }
	buildEditingController(): TaskNoteEditing { return buildEditingController(this); }
	getContinuationFold(): TaskContinuationFold {
		return buildContinuationFoldController(this);
	}
	/**
	 * 当前笔记是否有任何续写区（命令门禁用，纯 `data` 解析不扫 DOM）。
	 * 空集 → 命令从面板隐藏，而不是点了没反应（[[Plan-20261024-060243]] D7）。
	 */
	canToggleAllContinuationFolds(): boolean { return hasContinuationFolds(this); }
	/** 二态切换全文件全部续写区；`false` = 无续写区（正常路径下门禁已挡）。 */
	toggleAllContinuationFolds(): boolean { return toggleAllContinuationFoldsFn(this); }
	/** 当前笔记是否有任何可折叠 Section（命令门禁用）。空集 → 命令从面板隐藏。 */
	canToggleAllSectionFolds(): boolean { return hasSectionFolds(this); }
	/** 二态切换全文件全部 Section；`false` = 无 Section（正常路径下门禁已挡）。 */
	toggleAllSectionFolds(): Promise<boolean> {
		return toggleAllSectionFoldsFn(this);
	}
	/** 取走 `setState` 暂存的叶子级折叠键（一次性迁移；见 `pendingLeafFolds`）。 */
	takePendingLeafFolds(): {
		path: string;
		continuations: string[];
		sections: string[];
	} | null {
		const pending = this.pendingLeafFolds;
		this.pendingLeafFolds = null;
		return pending;
	}
	buildLinkController(): TaskNoteLinks { return buildLinkController(this); }

	// ---- 聚焦放大 ----
	toggleZoomCard(line: number): void { toggleZoomCard(this, line); }
	async enterZoom(line: number): Promise<void> { await enterZoom(this, line); }
	applyZoomDom(line: number): void { applyZoomDom(this, line); }
	exitZoom(): void { exitZoom(this); }
	restoreZoom(): void { restoreZoom(this); }
	syncZoomButton(cardEl: HTMLElement | null): void { syncZoomButton(this, cardEl); }
	async flushZoomEdit(): Promise<void> { await flushZoomEdit(this); }
	focusZoomEditor(line: number): void { focusZoomEditor(this, line); }

	// ---- 只看本节（Section 级布局聚焦）----
	toggleSectionZoom(startLine: number): void { toggleSectionZoom(this, startLine); }
	enterSectionZoom(startLine: number): void { enterSectionZoom(this, startLine); }
	exitSectionZoom(): void { exitSectionZoom(this); }
	restoreSectionZoom(): void { restoreSectionZoom(this); }

	// ---- 命令就绪补偿 ----
	canDispatch(commandId: string): boolean { return canDispatch(this, commandId); }
	dispatchCommand(commandId: string): void { dispatchCommand(this, commandId); }
	areCardActionCommandsReady(): boolean { return areCardActionCommandsReady(this); }
	clearCommandReadinessTimer(): void { clearCommandReadinessTimer(this); }
	awaitCommandReadiness(): void { awaitCommandReadiness(this); }

	// ---- 选择态 ----
	select(line: number): void { select(this, line); }
	applySelection(line: number): void { applySelection(this, line); }
	restoreSelectionFocusAfterBlurCommit(line: number): void {
		restoreSelectionFocusAfterBlurCommit(this, line);
	}
	async deleteSelected(line: number): Promise<void> { await deleteSelected(this, line); }
	async indentSelected(line: number, delta: number): Promise<void> {
		await indentSelected(this, line, delta);
	}
	async requestDelete(line: number): Promise<void> { await requestDelete(this, line); }
	enterPendingDelete(line: number): void { enterPendingDelete(this, line); }
	cancelPendingDelete(refocus = true): void { cancelPendingDelete(this, refocus); }
	confirmPendingDelete(): void { confirmPendingDelete(this); }
	async insertSibling(line: number): Promise<void> { await insertSibling(this, line); }
	scrollCardIntoView(cardEl: HTMLElement): void { scrollCardIntoView(this, cardEl); }
	canToggleSelectedFromScope(): boolean { return canToggleSelectedFromScope(this); }
	toggleSelectedFromScope(): void { toggleSelectedFromScope(this); }
	async beginContinuationOrNew(line: number): Promise<void> {
		await beginContinuationOrNew(this, line);
	}
	modEnterHost(): ModEnterHost { return modEnterHost(this); }

	// ---- 内联编辑（标题） ----
	async beginEdit(line: number, caretOffset?: number | null): Promise<void> {
		await beginEdit(this, line, caretOffset);
	}
	expandSectionContaining(line: number): boolean { return expandSectionContaining(this, line); }
	async commitEdit(): Promise<void> { await commitEdit(this); }
	async doCommitEdit(): Promise<void> { await doCommitEdit(this); }
	destroyActiveEditor(): void { destroyActiveEditor(this); }
	refreshCardActions(line: number): void { refreshCardActions(this, line); }
	refreshCard(line: number): void { refreshCard(this, line); }
	async autosaveEdit(): Promise<void> { await autosaveEdit(this); }

	// ---- 续行编辑 ----
	async beginContinuationEdit(line: number): Promise<void> {
		await beginContinuationEdit(this, line);
	}
	async beginNewContinuationEdit(line: number): Promise<void> {
		await beginNewContinuationEdit(this, line);
	}
	onContinuationEnter(cm: Parameters<typeof onContinuationEnter>[1]): boolean {
		return onContinuationEnter(this, cm);
	}
	onContinuationDeleteEmpty(): boolean { return onContinuationDeleteEmpty(this); }
	onContinuationEscape(): void { onContinuationEscape(this); }
	async commitContinuationEdit(forceEmpty = false): Promise<void> {
		await commitContinuationEdit(this, forceEmpty);
	}
	destroyContinuationEditor(): void { destroyContinuationEditor(this); }
	async autosaveContinuation(): Promise<void> { await autosaveContinuation(this); }

	// ---- Section 编辑 ----
	async beginSectionEdit(startLine: number): Promise<void> {
		await beginSectionEdit(this, startLine);
	}
	async commitSectionEdit(): Promise<void> { await commitSectionEdit(this); }
	destroySectionEditor(): void { destroySectionEditor(this); }
	async autosaveSection(): Promise<void> { await autosaveSection(this); }
	async deleteSection(startLine: number, title: string): Promise<void> {
		await deleteSection(this, startLine, title);
	}

	// ---- Section 标题就地编辑 ----
	async beginSectionTitleEdit(startLine: number): Promise<void> {
		await beginSectionTitleEdit(this, startLine);
	}
	async commitSectionTitleEdit(): Promise<void> {
		await commitSectionTitleEdit(this);
	}
	destroySectionTitleEditor(): void { destroySectionTitleEditor(this); }

	// ---- 编辑器事件处理 ----
	onEditorEscape(): void { onEditorEscape(this); }
	onEditorSoftBreak(cm: Parameters<typeof onEditorSoftBreak>[1]): boolean {
		return onEditorSoftBreak(this, cm);
	}
	onEditorEnter(
		cm: Parameters<typeof onEditorEnter>[1],
		shiftKey: boolean,
	): boolean {
		return onEditorEnter(this, cm, shiftKey);
	}
	onEditorDeleteEmpty(): boolean { return onEditorDeleteEmpty(this); }
	onEditorIndent(delta: number): boolean { return onEditorIndent(this, delta); }
	async runLineAction(
		line: number,
		originalLine: string,
		transform: TaskLineTransform,
		nextEditLine: number | null,
		options?: {
			swallowContinuations?: boolean;
			insertAfterContinuations?: boolean;
			animateRecentSwap?: boolean;
			caretOffset?: number | null;
		},
	): Promise<void> {
		await runLineAction(this, line, originalLine, transform, nextEditLine, options);
	}
	applyOutcome(outcome: Parameters<typeof applyOutcome>[1]): void {
		applyOutcome(this, outcome);
	}
	syncCommittedContent(outcome: Parameters<typeof syncCommittedContent>[1]): void {
		syncCommittedContent(this, outcome);
	}
	async toggleTask(line: number, cardEl: HTMLElement): Promise<void> {
		await toggleTask(this, line, cardEl);
	}

	// ---- 条目控制 / 快捷面板 / AI 条目来源 ----
	getItemControlHost(): ItemControlBridgeHost | null { return getItemControlHost(this); }
	getQuickPanelHost(): HTMLElement | null { return getQuickPanelHost(this); }
	getAITaskItemSource(): { file: TFile; line: number; text: string } | null {
		return getAITaskItemSource(this);
	}
	async commitFromItemControl(
		line: number,
		originalLine: string,
		nextLine: string,
	): Promise<CommitOutcome> {
		return commitFromItemControl(this, line, originalLine, nextLine);
	}

	// ---- 任务命令 ----
	triggerAddTask(context?: ToolbarButtonClickContext): void { triggerAddTask(this, context); }
	async addTask(): Promise<void> { await addTask(this); }
	async addSection(): Promise<void> { await addSection(this); }
	async appendTaskBlock(
		buildNewLines: Parameters<typeof appendTaskBlock>[1],
		options?: { caretOffset?: number | null },
	): Promise<void> { await appendTaskBlock(this, buildNewLines, options); }
	findTasksSection(): ReturnType<typeof findTasksSection> { return findTasksSection(this); }
	canAddTask(): boolean { return canAddTask(this); }
	canInsertEntryTemplate(): boolean { return canInsertEntryTemplate(this); }
	async insertEntryTemplate(): Promise<void> { await insertEntryTemplate(this); }
	resolveCurrentProjectNames(): string[] { return resolveCurrentProjectNames(this); }
	resolveCurrentSubject(): string { return resolveCurrentSubject(this); }
	async runTask(): Promise<void> { await runTask(this); }
	canMarkAllTasksDone(): boolean { return canMarkAllTasksDone(this); }
	async markAllTasksDone(): Promise<void> { await markAllTasksDone(this); }
	canSwapSelectedTask(direction: 'prev' | 'next'): boolean {
		return canSwapSelectedTask(this, direction);
	}
	async swapSelectedTask(direction: 'prev' | 'next'): Promise<void> {
		await swapSelectedTask(this, direction);
	}
	canToggleSelectedTaskPin(): boolean { return canToggleSelectedTaskPin(this); }
	async toggleSelectedTaskPin(): Promise<void> { await toggleSelectedTaskPin(this); }
	async toggleTaskPin(line: number): Promise<void> { await toggleTaskPin(this, line); }
	async toggleTaskRepeat(line: number): Promise<void> {
		await toggleTaskRepeat(this, line);
	}
	canDuplicateTask(): boolean { return canDuplicateTask(this); }
	async duplicateTask(line: number): Promise<void> { await duplicateTask(this, line); }
	async duplicateSelectedTask(): Promise<void> { await duplicateSelectedTask(this); }
	canTogglePrimarySection(): boolean { return canTogglePrimarySection(this); }
	async togglePrimarySection(startLine: number): Promise<void> {
		await togglePrimarySection(this, startLine);
	}
	async toggleCurrentPrimarySection(): Promise<void> {
		await toggleCurrentPrimarySection(this);
	}

	// ---- 外部写回窗口 ----
	async flushInlineEdits(): Promise<void> { await flushInlineEdits(this); }
	beginExternalEditorWriteback(): boolean { return beginExternalEditorWriteback(this); }
	endExternalEditorWriteback(): void { endExternalEditorWriteback(this); }

	// ---- 导出为图片 ----
	async exportAsImage(): Promise<void> { await exportAsImage(this); }
	async copyImageToClipboard(): Promise<void> { await copyImageToClipboard(this); }
	async captureForExport(): Promise<{
		canvas: HTMLCanvasElement;
		baseName: string;
	} | null> { return captureForExport(this); }
	async copyCanvasViaElectron(canvas: HTMLCanvasElement): Promise<boolean> {
		return copyCanvasViaElectron(this, canvas);
	}

	// ---- 共用小工具 ----
	lineAt(index: number): string { return lineAt(this, index); }
	countContinuationLines(line: number): number { return countContinuationLines(this, line); }
	queryCard(line: number): HTMLElement | null { return queryCard(this, line); }
}

// 顶部 import 区只引类型/函数一次；以下别名给同名代理方法用，避免循环 import 报错。
import {
	applySearchQuery as applySearchQueryFn,
	canRevealSearchFromScope as canRevealSearchFromScopeFn,
} from './ioto-task/task-view-search';
