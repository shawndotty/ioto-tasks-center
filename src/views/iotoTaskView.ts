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
	MarkdownRenderer,
	Notice,
	Platform,
	setIcon,
	TextFileView,
	type App,
	type HoverPopover,
	type TFile,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import { t } from '../lang/helpter';
import type { TaskViewAppearanceStyle } from '../settings';
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
	isTaskContinuationLine,
	parseChecklistItems,
	replaceTaskBody,
	setTaskIndent,
	taskBodyForEditor,
	toggleTaskMarker,
} from '../tasks-center/note-structure';
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
} from './ioto-task/ioto-task-scroll';
import {
	renderCardActions,
	renderTaskNote,
	type TaskNoteEditing,
	type TaskNoteFilters,
	type TaskNoteLinks,
} from './ioto-task/render-note';
import type { ModEnterHost } from './ioto-task/select-mode-scope';
import {
	IOTO_TASK_VIEW_HOVER_SOURCE_ID,
	type TaskHoverPreviewPayload,
} from './task-hover-preview';
import { IOTO_TASK_VIEW_TYPE } from './ioto-task/item-control-bridge';

export { IOTO_TASK_VIEW_TYPE };

/** 自动落盘窗口：与核心 2000ms 对齐；移动端 I/O 与电量敏感，放宽一档。 */
const AUTOSAVE_INTERVAL_MS = Platform.isMobile ? 4000 : 2000;

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

/** `app.commands` 的最小可判定形状（照抄 task-creation.ts 的 `CommandRegistryLike` 口径）。 */
interface CommandRegistryLike {
	executeCommandById?: (commandId: string) => unknown;
	commands?: Record<string, unknown>;
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
	private editingLine: number | null = null;
	/**
	 * 选择态行号（[[Plan-20261003-194909]] §四）。
	 *
	 * `idle → selected → editing` 显式状态机的载体：**同一时刻只有一张卡片被选中**，
	 * 且 `selected` 是 `editing` 的前置态。按拍板结论**不持久化**（不进 `getState`），
	 * 但必须**可重建**——任何整树重建（折叠 / 删除 / 外部写入）后由 `syncSelectionClass` 回填。
	 */
	private selectedLine: number | null = null;
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
	private readonly supportsInlineEdit: () => boolean;
	private readonly appearanceStyleProvider: () => TaskViewAppearanceStyle;
	private readonly recentTaskCountProvider: () => number;
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
	) {
		super(leaf);
		this.allowNoFile = false;
		this.supportsInlineEdit = supportsInlineEdit;
		this.appearanceStyleProvider = appearanceStyleProvider;
		this.recentTaskCountProvider = recentTaskCountProvider;
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
		this.renderNote(data);
	}

	clear(): void {
		this.destroyActiveEditor();
		this.destroyContinuationEditor();
		this.editingLine = null;
		this.continuationLine = null;
		this.continuationOriginalLines = [];
		this.selectedLine = null;
		this.editingOriginalLine = '';
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
		this.autosave.dispose();
		super.onunload();
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
		// 按设置挂 / 去 `.is-glass`（玻璃风格），保证打开即应用当前外观（[[Plan-20261003-215547]] §7.1）。
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
			title: t('view.iotoTaskView.toolbar.addTaskTooltip'),
			attr: { 'data-action': 'add-task' },
			onClick: () => {
				void this.addTask();
			},
		});

		this.bodyEl = this.contentEl.createDiv({ cls: 'ioto-task-view__body' });
		this.toolbarEl = toolbarEl;
		this.refreshToolbarState();
	}

	private createToolbarButton(
		parentEl: HTMLElement,
		options: {
			cls: string;
			icon: string;
			label: string;
			title: string;
			attr: Record<string, string>;
			onClick: () => void;
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
	}

	/** ③ 按钮 tooltip：内插当前阈值（设置变更后由 `refreshToolbarState` 重取）。 */
	private recentTaskTitle(): string {
		return t('view.iotoTaskView.toolbar.toggleRecentTooltip', [
			String(this.recentTaskCountProvider()),
		]);
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
	 * 按设置切换 IOTOTask 视图外观：玻璃（`.is-glass`）或经典卡片。
	 * 设置变更时由 `main.ts` 的 `applySettingsToOpenViews` 调此方法来即时回退 / 切换，
	 * 无需整树重建（`contentEl` 的类在 `renderNote` 的 `empty()` 后仍然保留）。
	 * 见 [[Plan-20261003-215547]] §7.1。
	 */
	applyAppearanceStyle(): void {
		if (this.appearanceStyleProvider() === 'glass') {
			this.contentEl.addClass('is-glass');
		} else {
			this.contentEl.removeClass('is-glass');
		}
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
		options?: { skipAnchorRestore?: boolean },
	): void {
		if (this.isRendering) {
			return;
		}

		this.isRendering = true;
		try {
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
			const snapshot = captureIotoTaskScroll(this.contentEl);
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
			});
			restoreIotoTaskScroll(this.contentEl, snapshot, {
				skipAnchor: options?.skipAnchorRestore ?? false,
			});
			// 回填选中类：整树重建后 `selectedLine` 仍在，但不 `focus()`——
			// `renderNote` 也会被后台 `reloadFromVault` 触发，抢焦点会打断用户输入
			// （[[Plan-20261003-194909]] §5.1f）。
			this.syncSelectionClass();
		} finally {
			this.isRendering = false;
		}
	}

	/**
	 * 只按 `selectedLine` 回填 `.is-selected`，不抢焦点。
	 * 过滤 / 折叠后选中卡可能已不在 DOM（[[Plan-20261004-110845]] §5.5）：
	 * 退化为「第一张可见卡」或 `null`，避免悬空选中。
	 */
	private syncSelectionClass(): void {
		const line = this.selectedLine;
		if (line === null) {
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
			delete: (line) => {
				void this.deleteSelected(line);
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
		};
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
			open: (linktext, newTab) => {
				const sourcePath = this.file?.path ?? '';
				void (async () => {
					// 编辑态点**别的卡片**的链接：mousedown 的 blur 已提交过一次，
					// 这里是幂等兜底；成功后只 `refreshCard`，不整树重建，
					// 被点的 `<a>` 仍在 DOM 上，本次点击照常派发。
					await this.commitEdit();
					await this.app.workspace.openLinkText(
						linktext,
						sourcePath,
						// false = 当前叶子（与阅读模式一致）；'tab' = 新标签页
						newTab ? 'tab' : false,
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
	 */
	private applySelection(line: number): void {
		const prev = this.selectedLine;
		if (prev !== null && prev !== line) {
			this.queryCard(prev)?.removeClass('is-selected');
		}
		this.selectedLine = line;

		const cardEl = this.queryCard(line);
		if (!cardEl) {
			// 行号已漂移 / 卡片被折叠：交由后续整树渲染兜底
			this.selectedLine = null;
			return;
		}

		cardEl.addClass('is-selected');
		cardEl.focus({ preventScroll: true });
		this.scrollCardIntoView(cardEl);
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

		// 结构性变更 → 整树重建（不跳顶由 ioto-task-scroll.ts 兜底）
		this.selectedLine = nextLine;
		this.renderNote(this.data);
		if (nextLine !== null) {
			this.queryCard(nextLine)?.focus({ preventScroll: true });
		}
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
			{ insertAfterContinuations: true },
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
		let count = 0;
		for (let i = line + 1; i < lines.length; i += 1) {
			if (!isTaskContinuationLine(lines[i] ?? '')) {
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

	private async beginEdit(line: number): Promise<void> {
		if (!this.supportsInlineEdit() || !this.file) {
			new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
			return;
		}

		if (this.editingLine === line && this.editingHandle) {
			return;
		}

		// 切换卡片：先提交上一个（标题编辑器 + 续行编辑器互相排斥）
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
				onDeleteEmpty: () => this.onEditorDeleteEmpty(),
				onIndent: (delta) => this.onEditorIndent(delta),
				onEscape: () => this.onEditorEscape(),
				onBlur: () => {
					// blur 提交会写同一行的最终值，先撤掉待写的那次（内容相同，属无效写）
					this.autosave.cancel();
					void this.commitEdit();
				},
				onChange: () => {
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

		// 纯文本提交「行数 / 缩进 / 其它卡片」全都没变，就地刷新单卡即可：
		// 既不会跳顶，也不会因整树重建吞掉正在进行的第二次点击（[[Plan-20261003-094145]] §5.3）。
		this.refreshCard(line);
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

		// 块范围：line + 1 起连续 isTaskContinuationLine
		const lines = this.data.split('\n');
		let end = line + 1;
		while (end < lines.length && isTaskContinuationLine(lines[end] ?? '')) {
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
				onBlur: () => void this.commitContinuationEdit(),
				onChange: () => this.autosave.schedule(),
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
				onBlur: () => void this.commitContinuationEdit(),
				onChange: () => this.autosave.schedule(),
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
				// 行数可能变化 → 按最新 data 重算块范围
				const lines = this.data.split('\n');
				let end = line + 1;
				while (end < lines.length && isTaskContinuationLine(lines[end] ?? '')) {
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
		}
		// 动作区也按最新 `data` 重建（幂等），覆盖 blur 提交等所有「就地刷单卡」路径。
		this.refreshCardActions(line);
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
				{ insertAfterContinuations: true },
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
				{ swallowContinuations: true },
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
		this.renderNote(this.data);

		if (outcome.status !== 'conflict' && nextEditLine !== null) {
			// beginEdit 内会把 selectedLine 落到新行上
			await this.beginEdit(nextEditLine);
			return;
		}

		// 没有后继编辑目标（删空首行 / 冲突回滚）：原卡已不存在，清掉选中避免悬空态
		this.selectedLine = null;
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

		const originalLine = this.lineAt(line);
		const outcome = await commitTaskLineAction(this.app, file, {
			line,
			originalLine,
			transform: toggleTaskMarker,
		});

		if (outcome.status === 'ok') {
			this.data = outcome.content;
			this.lastLoadedText = outcome.content;

			// ② 开启时把新完成的任务「就地移除」（不整树重建，避免跳顶）。
			if (this.filters.onlyPending && nextMarker === 'x') {
				// ⚠️ 落点必须用 pickAdjacentLine 取**真实**相邻行号：② 只动 DOM、
				// 不动文件行，行号不漂移；`pickLineAfterDelete` 的 −1 假设会让选中
				// 指向一张不存在的卡（[[Plan-20261004-110845]] §5.2）。
				const order = collectCardLines(this.contentEl);
				const next =
					pickAdjacentLine(order, line, 1) ??
					pickAdjacentLine(order, line, -1);
				cardEl.remove();
				if (next !== null) {
					this.applySelection(next);
				} else {
					this.selectedLine = null;
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

	/* ------------------------------------------------------------------ *
	 * 批次 D — ④「添加任务」：三段式落点（文件末条 → 任务 Section 段首 → 文末建段）
	 * ------------------------------------------------------------------ */

	private async addTask(): Promise<void> {
		const file = this.file;
		if (!file || !this.supportsInlineEdit()) {
			return;
		}

		// 先落盘未提交正文，否则 runLineAction 里的 destroyActiveEditor 会丢弃它。
		await this.commitEdit();

		const items = parseChecklistItems(this.data, { includeEmpty: true });
		const last = items.length > 0 ? items[items.length - 1] : undefined;

		if (last) {
			// 文件级末条任务之后追加一条**顶层 0 级**任务。
			// 落点跨过末条任务的续行，避免新任务插到续行之前（同 insertSibling）。
			await this.runLineAction(
				last.line,
				this.lineAt(last.line),
				(raw) => [raw, buildTopLevelTaskLine(raw, '')],
				last.line + 1 + this.countContinuationLines(last.line),
				{ insertAfterContinuations: true },
			);
			return;
		}

		const section = this.findTasksSection();
		if (section) {
			// 无任务 → 在 `任务`/`Tasks` Section **段首**（标题行下一行）插入。
			await this.runLineAction(
				section.startLine,
				this.lineAt(section.startLine),
				(heading) => [
					heading,
					buildTopLevelTaskLine('- ', ''),
				],
				section.startLine + 1,
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
		const nextTask = buildTopLevelTaskLine('- ', '');

		if (this.data.length === 0) {
			await this.runLineAction(
				0,
				'',
				() => [sectionTitle, nextTask],
				1,
			);
			return;
		}

		if (lastLine.trim() === '') {
			// 末行已是空行：直接复用为分隔，避免双空行。
			await this.runLineAction(
				lastIndex,
				lastLine,
				() => ['', sectionTitle, nextTask],
				lastIndex + 2,
			);
			return;
		}

		await this.runLineAction(
			lastIndex,
			lastLine,
			(raw) => [raw, '', sectionTitle, nextTask],
			lastIndex + 3,
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

	private async runTask(): Promise<void> {
		// executeCommandById 同步派发，对方 resolveRunGate 会立刻读盘 → 先落盘。
		await this.commitEdit();

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
