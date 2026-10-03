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
	type TFile,
	type ViewStateResult,
	type WorkspaceLeaf,
} from 'obsidian';

import { t } from '../lang/helpter';
import type { TaskViewAppearanceStyle } from '../settings';
import {
	buildSiblingTaskLine,
	parseChecklistItems,
	replaceTaskBody,
	setTaskIndent,
	taskBodyForEditor,
	toggleTaskMarker,
} from '../tasks-center/note-structure';
import {
	collectCardLines,
	pickLineAfterDelete,
} from './ioto-task/card-navigation';
import {
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
} from './ioto-task/render-note';
import { IOTO_TASK_VIEW_TYPE } from './ioto-task/item-control-bridge';

export { IOTO_TASK_VIEW_TYPE };

/** 自动落盘窗口：与核心 2000ms 对齐；移动端 I/O 与电量敏感，放宽一档。 */
const AUTOSAVE_INTERVAL_MS = Platform.isMobile ? 4000 : 2000;

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

	constructor(
		leaf: WorkspaceLeaf,
		supportsInlineEdit: () => boolean,
		appearanceStyleProvider: () => TaskViewAppearanceStyle,
	) {
		super(leaf);
		this.allowNoFile = false;
		this.supportsInlineEdit = supportsInlineEdit;
		this.appearanceStyleProvider = appearanceStyleProvider;
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
		this.selectedLine = null;
		this.editingOriginalLine = '';
		this.contentEl.empty();
		this.data = '';
		this.lastLoadedText = '';
		this.collapsedSections.clear();
	}

	onunload(): void {
		this.destroyActiveEditor();
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
			// 回填选中类：整树重建后 `selectedLine` 仍在，但不 `focus()`——
			// `renderNote` 也会被后台 `reloadFromVault` 触发，抢焦点会打断用户输入
			// （[[Plan-20261003-194909]] §5.1f）。
			this.syncSelectionClass();
		} finally {
			this.isRendering = false;
		}
	}

	/** 只按 `selectedLine` 回填 `.is-selected`，不抢焦点。 */
	private syncSelectionClass(): void {
		const line = this.selectedLine;
		if (line === null) {
			return;
		}
		this.queryCard(line)?.addClass('is-selected');
	}

	/* ------------------------------------------------------------------ *
	 * 编辑：对外接口（渲染层通过回调调用）
	 * ------------------------------------------------------------------ */

	private buildEditingController(): TaskNoteEditing {
		// 箭头函数读实时值，供下面的 getter 转发（不写 `const self = this`）
		const readSelected = (): number | null => this.selectedLine;
		return {
			enabled: this.supportsInlineEdit(),
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
			insertSibling: (line) => {
				void this.insertSibling(line);
			},
			toggleTask: (line, cardEl) => {
				void this.toggleTask(line, cardEl);
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
	 * 选择态下 `Delete` / `Backspace`：只删当前行（已确认不级联子行），
	 * 选择落到「原位置的下一张，否则上一张」。
	 */
	private async deleteSelected(line: number): Promise<void> {
		const file = this.file;
		if (!file) {
			return;
		}

		// 删除前先取 DOM 顺序：删除会让后续卡片的 data-line 整体前移
		const order = collectCardLines(this.contentEl);
		const nextLine = pickLineAfterDelete(order, line);

		const outcome = await commitTaskLineAction(this.app, file, {
			line,
			originalLine: this.lineAt(line),
			transform: () => '',
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
			line + 1,
		);
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
		renderCardActions(cardEl, item?.controls ?? []);
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
