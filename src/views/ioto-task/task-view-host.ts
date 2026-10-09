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
import type {
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
	readonly autosave: AutosaveScheduler;
	readonly hoverPreviewParent: { hoverPopover: HoverPopover | null };

	// ---- 可变状态：数据 / 渲染 ----
	collapsedSections: Set<string>;
	lastLoadedText: string;
	isRendering: boolean;
	isExporting: boolean;
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

	// ---- 可变状态：聚焦放大 ----
	zoomLine: number | null;

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

	// ---- 薄代理方法：聚焦放大 ----
	toggleZoomCard(line: number): void;
	enterZoom(line: number): Promise<void>;
	exitZoom(): void;
	restoreZoom(): void;
	flushZoomEdit(): Promise<void>;
	focusZoomEditor(line: number): void;

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
	insertEntryTemplate(): Promise<void>;
	resolveCurrentProjectNames(): string[];
	runTask(): Promise<void>;

	// ---- 薄代理方法：外部写回窗口 ----
	flushInlineEdits(): Promise<void>;

	// ---- 薄代理方法：共用小工具 ----
	lineAt(index: number): string;
	countContinuationLines(line: number): number;
	queryCard(line: number): HTMLElement | null;
}
