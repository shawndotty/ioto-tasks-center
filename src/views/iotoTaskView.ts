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
 * 🔴 红线：写盘成功后必须同步 `this.data` 与 `this.lastLoadedText`，否则 `getViewData()`
 * 会返回过期字节，`TextFileView` 的保存路径会把用户的编辑写回去。编辑期间用
 * `editingLine` 抑制位挡住外部写入触发的重绘，避免编辑器被冲掉。
 */

import type { EditorView } from '@codemirror/view';
import {
	MarkdownRenderer,
	Notice,
	setIcon,
	TextFileView,
	type TFile,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import { t } from '../lang/helpter';
import {
	buildSiblingTaskLine,
	parseChecklistItems,
	replaceTaskBody,
	setTaskIndent,
	taskBodyForEditor,
	toggleTaskMarker,
} from '../tasks-center/note-structure';
import {
	commitTaskLineAction,
	commitTaskText,
	type CommitOutcome,
	type TaskLineTransform,
} from './ioto-task/commit-task-line';
import {
	mountEmbeddedEditor,
	type EmbeddedEditorHandle,
} from './ioto-task/embedded-editor';
import {
	captureIotoTaskScroll,
	restoreIotoTaskScroll,
} from './ioto-task/ioto-task-scroll';
import { renderTaskNote, type TaskNoteEditing } from './ioto-task/render-note';
import { IOTO_TASK_VIEW_TYPE } from './ioto-task/item-control-bridge';

export { IOTO_TASK_VIEW_TYPE };

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
	private editingOriginalLine = '';
	private editingHandle: EmbeddedEditorHandle | null = null;
	private pendingCommit: Promise<void> | null = null;
	private readonly supportsInlineEdit: () => boolean;

	constructor(leaf: WorkspaceLeaf, supportsInlineEdit: () => boolean) {
		super(leaf);
		this.allowNoFile = false;
		this.supportsInlineEdit = supportsInlineEdit;
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
		this.editingLine = null;
		this.editingOriginalLine = '';
		this.contentEl.empty();
		this.data = '';
		this.lastLoadedText = '';
		this.collapsedSections.clear();
	}

	onunload(): void {
		this.destroyActiveEditor();
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

	private async reloadFromVault(): Promise<void> {
		const file = this.file;
		if (!file) {
			return;
		}

		// 编辑期间忽略外部写入，避免编辑器被重绘冲掉（只挡重绘，不挡写盘）。
		if (this.editingLine !== null) {
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

	private renderNote(data: string): void {
		if (this.isRendering) {
			return;
		}

		this.isRendering = true;
		try {
			// 重绘会新建滚动容器（render-note.ts:60），scrollTop 会归零；
			// 先捕获、render 之后恢复，保证结构性变更（回车新建 / 折叠 Section / 冲突回滚）
			// 不把用户看到的视口位置丢掉（[[Plan-20261003-094145]] §5.2）。
			const snapshot = captureIotoTaskScroll(this.contentEl);
			this.contentEl.empty();
			renderTaskNote({
				app: this.app,
				containerEl: this.contentEl,
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
			});
			restoreIotoTaskScroll(this.contentEl, snapshot);
		} finally {
			this.isRendering = false;
		}
	}

	/* ------------------------------------------------------------------ *
	 * 编辑：对外接口（渲染层通过回调调用）
	 * ------------------------------------------------------------------ */

	private buildEditingController(): TaskNoteEditing {
		return {
			enabled: this.supportsInlineEdit(),
			beginEdit: (line) => {
				void this.beginEdit(line);
			},
			toggleTask: (line, cardEl) => {
				void this.toggleTask(line, cardEl);
			},
		};
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
		}
		return outcome;
	}

	private lineAt(index: number): string {
		return this.data.split('\n')[index] ?? '';
	}

	private queryCard(line: number): HTMLElement | null {
		return this.contentEl.querySelector<HTMLElement>(
			`.ioto-task-view__card[data-line="${line}"]`,
		);
	}

	private destroyActiveEditor(): void {
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

		// 切换卡片：先提交上一个
		await this.commitEdit();

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
				onEnter: (cm) => this.onEditorEnter(cm),
				onDeleteEmpty: () => this.onEditorDeleteEmpty(),
				onIndent: (delta) => this.onEditorIndent(delta),
				onEscape: () => this.onEditorEscape(),
				onBlur: () => {
					void this.commitEdit();
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
		handle.focus();

		// 视口兜底：结构性变更（回车新建末行 / 删除）后目标卡可能在视口外，
		// `block:'nearest'` 只在确实出视口时才滚动（[[Plan-20261003-094145]] §5.4）。
		const rect = cardEl.getBoundingClientRect();
		const scrollEl = this.contentEl.querySelector<HTMLElement>(
			'.ioto-task-view__scroll',
		);
		const view = scrollEl?.getBoundingClientRect();
		if (view && (rect.top < view.top || rect.bottom > view.bottom)) {
			cardEl.scrollIntoView({ block: 'nearest' });
		}
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
		if (item) {
			void MarkdownRenderer.render(
				this.app,
				item.text,
				textEl,
				this.file?.path ?? '',
				this,
			);
		}
	}

	private onEditorEscape(): void {
		if (this.editingHandle === null) {
			return;
		}
		this.destroyActiveEditor();
		this.editingLine = null;
		this.renderNote(this.data);
	}

	private onEditorEnter(cm: EditorView): boolean {
		const handle = this.editingHandle;
		const line = this.editingLine;
		if (!handle || line === null) {
			return false;
		}

		const text = handle.getValue();
		const selection = cm.state.selection.main;
		const head = Math.min(Math.max(selection.head, 0), text.length);
		const before = text.slice(0, head);
		const after = text.slice(head);
		const originalLine = this.editingOriginalLine;

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
				line + 1,
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
	): Promise<void> {
		const file = this.file;
		if (!file) {
			return;
		}

		this.destroyActiveEditor();
		const outcome = await commitTaskLineAction(this.app, file, {
			line,
			originalLine,
			transform,
		});
		this.editingLine = null;
		this.applyOutcome(outcome);
		await this.reloadFromVault();
		this.renderNote(this.data);

		if (outcome.status !== 'conflict' && nextEditLine !== null) {
			await this.beginEdit(nextEditLine);
		}
	}

	private applyOutcome(outcome: CommitOutcome): void {
		if (outcome.status === 'ok') {
			// 🔴 红线：data 与 lastLoadedText 必须一起更新
			this.data = outcome.content;
			this.lastLoadedText = outcome.content;
		} else if (outcome.status === 'conflict') {
			new Notice(t('notice.iotoTaskView.commitConflict'));
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
				nextMarker === 'x' ? 'check-square' : 'square',
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
		} else if (outcome.status === 'conflict') {
			new Notice(t('notice.iotoTaskView.commitConflict'));
			await this.reloadFromVault();
			this.renderNote(this.data);
		}
	}
}
