/**
 * `IOTOTaskView` → `./ioto-task/*` 子模块的**显式状态契约**。
 *
 * 目的（[[Plan-20261009-155708]] / [[Discuss-20261009-154708]] §五.B）：把 barrel 里
 * 「事实上公共」的状态面变成受编译器约束的契约，并允许子模块用 stub 单测。
 *
 * ⚠️ 禁止 import `IOTOTaskView`（会重新引入类型环）；只允许 obsidian 类型与叶子类型。
 * 范式同源：`ProjectCenterViewContext` / `SettingsUpdaterHost` / `ItemControlBridgeHost`。
 *
 * 读字段标 `readonly`（子模块不得写）；确实被子模块写的状态保持可变声明。
 * `IOTOTaskView` 结构性满足该接口，barrel 侧传 `this` 即可，无需 `implements`。
 */

import type { App, Component, HoverPopover, TFile } from 'obsidian';
import type { EditorView } from '@codemirror/view';

import type {
	TaskViewAppearanceStyle,
	TaskViewExportOptions,
} from '../../settings';
import type { EntryTemplateConfig } from '../../tasks-center/task-entry-template';
import type { CommitOutcome, TaskLineTransform } from './commit-task-line';
import type { AutosaveScheduler } from './edit-autosave';
import type { EmbeddedEditorHandle } from './embedded-editor';
import type { SectionTitleEditorHandle } from './task-view-section-title-edit';
import type { EditingKind } from './task-view-editing-state';
import type {
	TaskContinuationFold,
	TaskNoteEditing,
	TaskNoteFilters,
} from './render-note-types';
import type { ToolbarButtonClickContext } from './task-view-constants';

export interface TaskViewHost extends Component {
	// ---- 继承自 TextFileView / FileView / ItemView（子模块直用）----
	readonly app: App;
	readonly file: TFile | null;
	readonly contentEl: HTMLElement;
	/** 子模块读写（写盘后同步），保持可变。 */
	data: string;
	getDisplayText(): string;

	// ---- 只读 provider / 稳定引用（与 barrel 既有 readonly 口径一致）----
	readonly supportsInlineEdit: () => boolean;
	readonly appearanceStyleProvider: () => TaskViewAppearanceStyle;
	readonly recentTaskCountProvider: () => number;
	readonly exportOptionsProvider: () => TaskViewExportOptions;
	readonly entryTemplateProvider: () => EntryTemplateConfig;
	readonly deleteButtonOnDesktopProvider: () => boolean;
	/** 手机端是否显示 Section 标题栏图标（[[Plan-20261019-202817]] §3.5）。 */
	readonly mobileSectionActionsVisibleProvider: () => boolean;
	readonly autosave: AutosaveScheduler;
	readonly hoverPreviewParent: { hoverPopover: HoverPopover | null };

	// ---- 可变状态：数据 / 渲染 ----
	collapsedSections: Set<string>;
	/**
	 * 续写区折叠态（键 = 续写正文哈希，见 `continuation-fold.ts`）。
	 * **内存真源**；每次装载由 `hydrateContinuationFolds` 按笔记路径从 store 灌回
	 * （`task-view-fold-store.ts`），`clear()` 只负责把叶子态归零。
	 */
	continuationCollapsed: Set<string>;
	/**
	 * `setState` 暂存的叶子级折叠键（一次性迁移），由两个 hydrate 认领后清空。
	 * `path` = `state.file`，与当前文件不符时丢弃（防叶子复用串态）。
	 * `continuations` / `sections` 分别由 `hydrateContinuationFolds` /
	 * `hydrateSectionFolds` 认领（[[Plan-20261023-062616]] S5）。
	 */
	pendingLeafFolds: {
		path: string;
		continuations: string[];
		sections: string[];
	} | null;
	lastLoadedText: string;
	isRendering: boolean;
	isExporting: boolean;
	/**
	 * 就地取消进行中的拖拽手势（ghost / 落点线 / 类名 / 指针捕获）。
	 * 整树重建前必须调用，否则捕获随旧 DOM 消失、state 卡在 dragging=true
	 * （[[Research-20261017-112730]] §四）。由两个手势模块在 beginDrag 时登记。
	 */
	cancelActiveDrag?: () => void;
	listTransitionToken: number;
	listTransitionCleanup: (() => void) | null;
	commandReadinessTimer: number | null;

	// ---- 可变状态：选择态 ----
	selectedLine: number | null;
	pendingDeleteLine: number | null;
	pendingDeleteEl: HTMLElement | null;

	// ---- 可变状态：标题内联编辑 ----
	editingLine: number | null;
	editingOriginalLine: string;
	editingHandle: EmbeddedEditorHandle | null;
	pendingCommit: Promise<void> | null;
	autosaveRunning: boolean;
	/**
	 * Section 编辑态的 `startLine`（= 被编辑 Section 的 `startLine`）；非编辑态 `null`。
	 * `resolveEditingKind` 见到即返回 `'section'`。
	 */
	sectionEditLine: number | null;
	/** Section 编辑块首行（快照，0 基，含）。 */
	sectionEditStartLine: number;
	/** Section 编辑块末行（快照，0 基，含）。 */
	sectionEditEndLine: number;
	/** Section 编辑块各行原文（快照，行漂移后二次定位用）。 */
	sectionEditOriginalLines: string[];
	/** Section 编辑器句柄（`null` = 未挂载）。 */
	sectionEditHandle: EmbeddedEditorHandle | null;
	/** Section 编辑器宿主 div（`destroy()` 只 empty 不 remove，需显式回收）。 */
	sectionEditHostEl: HTMLElement | null;

	// ---- 可变状态：Section 标题就地编辑（[[Plan-20261019-122509]] §2.4）----
	/** 被改名 Section 的 `startLine`；非编辑态 `null`。`resolveEditingKind` 见到即 `'section-title'`。 */
	sectionTitleEditLine: number | null;
	/** 标题行原文快照（提交时做行漂移复核）。 */
	sectionTitleEditOriginalLine: string;
	/** 标题输入框句柄（`null` = 未挂载）。 */
	sectionTitleEditHandle: SectionTitleEditorHandle | null;
	/** 带 `.is-title-editing` 的 `<section>`（提交收尾 / 失败兜底用）。 */
	sectionTitleEditSectionEl: HTMLElement | null;

	/** 派生真源（只读）：由四个行号推导，禁止直接写（`task-view-editing-state.ts`）。 */
	readonly editingKind: EditingKind;

	// ---- 可变状态：聚焦放大 ----
	zoomLine: number | null;

	// ---- 可变状态：只看本节（Section 级布局聚焦）----
	/** 被聚焦 Section 的 `startLine`；`null` = 未聚焦。瞬态，不进 `getState`。 */
	sectionZoomLine: number | null;
	/** 进入聚焦前的滚动位置（退出恢复）。 */
	sectionZoomScrollTop: number | null;
	/** 进入聚焦前选中的行（退出时若仍存在且未被改选则回填）。 */
	sectionZoomPrevSelectedLine: number | null;

	// ---- 可变状态：续行编辑 ----
	continuationLine: number | null;
	continuationStartLine: number;
	continuationEndLine: number;
	continuationOriginalLines: string[];
	continuationHandle: EmbeddedEditorHandle | null;
	continuationHostEl: HTMLElement | null;
	continuationIsNew: boolean;
	continuationDraftContainerEl: HTMLElement | null;

	// ---- 可变状态：外部写回窗口 ----
	externalWritebackActive: boolean;
	externalWritebackBlurred: boolean;
	externalWritebackDirty: boolean;

	// ---- 可变状态：搜索 / 过滤 ----
	searchQuery: string;
	searchDebounce: number | null;
	filters: TaskNoteFilters;

	// ---- 可变状态：工具栏 / 搜索条 DOM 句柄 ----
	toolbarEl: HTMLElement | null;
	bodyEl: HTMLElement | null;
	toggleTaskBlocksEl: HTMLButtonElement | null;
	togglePendingEl: HTMLButtonElement | null;
	toggleRecentEl: HTMLButtonElement | null;
	searchToggleEl: HTMLButtonElement | null;
	runTaskEl: HTMLButtonElement | null;
	addTaskEl: HTMLButtonElement | null;
	deleteTaskEl: HTMLButtonElement | null;
	searchBarEl: HTMLElement | null;
	searchInputEl: HTMLInputElement | null;
	searchPrevEl: HTMLButtonElement | null;
	searchNextEl: HTMLButtonElement | null;

	// ---- 薄代理方法：顶部控制栏 ----
	buildToolbar(): void;
	refreshToolbarState(): void;
	refreshDeleteButtonVisibility(): void;

	// ---- 薄代理方法：关键词搜索条 ----
	revealSearch(): void;
	toggleSearch(): void;
	refreshSearchToggleState(): void;
	onSearchInput(): void;
	closeSearch(): void;
	stepMatch(delta: 1 | -1): void;
	refreshSearchNavState(): void;

	// ---- 薄代理方法：过滤开关 ----
	reloadFilters(): void;
	toggleFilter(kind: keyof TaskNoteFilters): Promise<void>;

	// ---- 薄代理方法：渲染主入口 ----
	renderNote(
		data: string,
		options?: {
			skipAnchorRestore?: boolean;
			animateRecentSwap?: boolean;
			resetScroll?: boolean;
		},
	): void;
	scheduleListPlay(callback: () => void): void;
	cancelListTransition(): void;
	prefersReducedMotion(): boolean;
	syncSelectionClass(): void;
	reloadFromVault(): Promise<void>;
	buildEditingController(): TaskNoteEditing;
	/** 续写区折叠控制器（薄代理；缺省不作为 = 全展开且不渲染箭头）。 */
	getContinuationFold(): TaskContinuationFold;
	/** 取走 `setState` 暂存的叶子级折叠键（一次性迁移用）。 */
	takePendingLeafFolds(): {
		path: string;
		continuations: string[];
		sections: string[];
	} | null;

	// ---- 薄代理方法：聚焦放大 ----
	toggleZoomCard(line: number): void;
	enterZoom(line: number): Promise<void>;
	exitZoom(): void;
	restoreZoom(): void;
	flushZoomEdit(): Promise<void>;
	focusZoomEditor(line: number): void;

	// ---- 薄代理方法：只看本节 ----
	toggleSectionZoom(startLine: number): void;
	enterSectionZoom(startLine: number): void;
	exitSectionZoom(): void;
	restoreSectionZoom(): void;

	// ---- 薄代理方法：命令就绪补偿 ----
	canDispatch(commandId: string): boolean;
	dispatchCommand(commandId: string): void;
	awaitCommandReadiness(): void;

	// ---- 薄代理方法：选择态 ----
	select(line: number): void;
	applySelection(line: number): void;
	restoreSelectionFocusAfterBlurCommit(line: number): void;
	deleteSelected(line: number): Promise<void>;
	indentSelected(line: number, delta: number): Promise<void>;
	requestDelete(line: number): Promise<void>;
	cancelPendingDelete(refocus?: boolean): void;
	confirmPendingDelete(): void;
	insertSibling(line: number): Promise<void>;
	scrollCardIntoView(cardEl: HTMLElement): void;
	beginContinuationOrNew(line: number): Promise<void>;
	/** 同级任务互换（[[Plan-20261014-194115]] §4.4）：与上 / 下一个同级兄弟整块对调。 */
	canSwapSelectedTask(direction: 'prev' | 'next'): boolean;
	swapSelectedTask(direction: 'prev' | 'next'): Promise<void>;
	/** 条目 pin 切换（[[Plan-20261022-200135]] S4）：给选中卡加 / 去 `#ioto/pin`。 */
	canToggleSelectedTaskPin(): boolean;
	toggleSelectedTaskPin(): Promise<void>;
	/**
	 * 条目 pin / repeat 切换（右键菜单，**显式行号**，不依赖 selectedLine；
	 * [[Plan-20261023-104335]] §4.4）。
	 */
	toggleTaskPin(line: number): Promise<void>;
	toggleTaskRepeat(line: number): Promise<void>;

	// ---- 薄代理方法：内联编辑（标题） ----
	beginEdit(line: number, caretOffset?: number | null): Promise<void>;
	commitEdit(): Promise<void>;
	destroyActiveEditor(): void;
	refreshCardActions(line: number): void;
	refreshCard(line: number): void;
	autosaveEdit(): Promise<void>;

	// ---- 薄代理方法：续行编辑 ----
	beginContinuationEdit(line: number): Promise<void>;
	beginNewContinuationEdit(line: number): Promise<void>;
	onContinuationEnter(cm: EditorView): boolean;
	onContinuationDeleteEmpty(): boolean;
	onContinuationEscape(): void;
	commitContinuationEdit(forceEmpty?: boolean): Promise<void>;
	destroyContinuationEditor(): void;
	autosaveContinuation(): Promise<void>;

	// ---- 薄代理方法：Section 编辑 ----
	beginSectionEdit(startLine: number): Promise<void>;
	commitSectionEdit(): Promise<void>;
	destroySectionEditor(): void;
	autosaveSection(): Promise<void>;
	/** 整节删除（二次确认 + 写盘 + 行号迁移 + 重绘）。 */
	deleteSection(startLine: number, title: string): Promise<void>;

	// ---- 薄代理方法：Section 标题就地编辑 ----
	beginSectionTitleEdit(startLine: number): Promise<void>;
	commitSectionTitleEdit(): Promise<void>;
	destroySectionTitleEditor(): void;

	// ---- 薄代理方法：编辑器事件处理 ----
	onEditorEscape(): void;
	onEditorSoftBreak(cm: EditorView): boolean;
	onEditorEnter(cm: EditorView, shiftKey: boolean): boolean;
	onEditorDeleteEmpty(): boolean;
	onEditorIndent(delta: number): boolean;
	runLineAction(
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
	): Promise<void>;
	applyOutcome(outcome: CommitOutcome): void;
	syncCommittedContent(outcome: CommitOutcome): void;
	toggleTask(line: number, cardEl: HTMLElement): Promise<void>;

	// ---- 薄代理方法：任务命令 ----
	triggerAddTask(context?: ToolbarButtonClickContext): void;
	addTask(): Promise<void>;
	/** 文末新增同级 Section（默认标题）并进入该节标题编辑态。 */
	addSection(): Promise<void>;
	insertEntryTemplate(): Promise<void>;
	resolveCurrentProjectNames(): string[];
	runTask(): Promise<void>;
	canMarkAllTasksDone(): boolean;
	markAllTasksDone(): Promise<void>;

	// ---- 薄代理方法：外部写回窗口 ----
	flushInlineEdits(): Promise<void>;

	// ---- 薄代理方法：共用小工具 ----
	lineAt(index: number): string;
	countContinuationLines(line: number): number;
	queryCard(line: number): HTMLElement | null;
}
