/**
 * 优先级四象限视图（[[Plan-20261115-201917]] §3.4）。
 *
 * 跨项目聚合 `Priority: 0~3` 的任务笔记：P3 桶收 `>=3`，未标注进右侧侧栏。
 * 本文件只保留生命周期、过滤状态、reload 编排、写优先级与上下文方法；
 * 渲染细节拆在 `views/quadrant/*`。
 */

import {
	ItemView,
	Menu,
	Notice,
	Platform,
	TFile,
	type WorkspaceLeaf,
} from 'obsidian';

import { t } from '../lang/helpter';
import type { TaskViewAppearanceStyle } from '../settings-types';
import {
	buildQuadrantModel,
	QUADRANT_KEYS,
	type QuadrantKey,
	type QuadrantModel,
	type QuadrantProjectScope,
	type QuadrantStatusKey,
} from '../tasks-center/quadrant-data';
import {
	encodeQuadrantTimeFilter,
	resolveTaskTimeBounds,
	toLocalDateString,
	type QuadrantTimeFilter,
	type TaskTimeField,
} from '../tasks-center/task-time-range';
import { QuadrantTimeRangeModal } from '../ui/quadrantTimeRangeModal';
import {
	clearTaskFilePriority,
	setTaskFilePriority,
	type TaskPriorityValue,
} from '../tasks-center/task-priority';
import type { TaskFileEntry } from '../tasks-center/types';
import type {
	TaskCreationType,
	TaskTemplateConfig,
} from '../tasks-center/task-template-config';
import { applyAppearanceStyleClasses } from './appearance-style';
import { buildQuadrantFilterBar, updateQuadrantFilterBar } from './quadrant/filter-bar';
import {
	DEFAULT_QUADRANT_STATUS_KEYS,
	IOTO_PRIORITY_QUADRANT_VIEW_TYPE,
	mergeQuadrantViewState,
	parseQuadrantViewState,
	QUADRANT_BODY_CLASS,
	QUADRANT_LOADING_RENDER_DELAY_MS,
} from './quadrant/constants';
import type { QuadrantViewContext } from './quadrant/context';
import {
	scanQuadrantTasks,
	type QuadrantProjectOption,
} from './quadrant/data-loader';
import {
	readQuadrantFilterFallback,
	writeQuadrantFilterFallback,
} from './quadrant/filter-storage';
import { encodeQuadrantScope } from './quadrant/scope-codec';
import { attachQuadrantDrag } from './quadrant/drag-controller';
import { getWorkspaceLeafId } from './tasks-center/constants';
import {
	ensurePreviewLeafFor,
	findLeafByIdIn,
	isLeafAvailableIn,
} from './tasks-center/preview-leaf';
import { openCreatedTaskNote } from './tasks-center/task-note-opening';
import {
	buildQuadrantPriorityMenu,
	runAfterMenuCloses,
} from './quadrant/menus';
import { createTaskInQuadrant as runQuadrantTaskCreation } from './quadrant/create-task';
import { resolveQuadrantTaskTypeOptions } from './quadrant/create-task-type-options';
import {
	captureQuadrantScroll,
	renderQuadrantGrid,
} from './quadrant/quadrant-grid';
import { renderQuadrantSidebar } from './quadrant/sidebar';
import { renderQuadrantState } from './quadrant/states';
import { openQuadrantTask } from './quadrant/task-open';
import type { TaskPreviewOpenHost } from './task-preview-open';
import { QuadrantTimeRangePopover } from './quadrant/time-range-popover';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export interface PriorityQuadrantDeps {
	getTasksRootPath(): string;
	getHiddenProjectNames(): string[];
	getShowTaskPriority(): boolean;
	getColorTaskTitleByPriority(): boolean;
	getShowProjectNameInTaskList(): boolean;
	getUseIOTOTaskViewAsDefault(): boolean;
	getAppearanceStyle(): TaskViewAppearanceStyle;
	getEnabledTaskCreationTypes(): TaskCreationType[];
	getTaskTemplateConfig(type: TaskCreationType): TaskTemplateConfig;
	getDateTaskDateFormat(): string;
}

export class IOTOPriorityQuadrantView
	extends ItemView
	implements QuadrantViewContext, TaskPreviewOpenHost
{
	/** 四象限自持的预览叶（[[Plan-20261116-155634]] §5.5），可跨会话恢复。 */
	previewLeaf: WorkspaceLeaf | null = null;
	/** 最近打开的任务路径（[[Plan-20261117-062052]] §5.6）：仅用于「同一任务只激活」判定。 */
	openedTaskPath: string | null = null;
	private statusKeys = new Set<QuadrantStatusKey>(DEFAULT_QUADRANT_STATUS_KEYS);
	private projectScope: QuadrantProjectScope = { kind: 'unarchived' };
	private sidebarOpen = false;
	private timeFilter: QuadrantTimeFilter = { kind: 'none' };
	private model: QuadrantModel | null = null;
	private lastTasks: TaskFileEntry[] = [];
	private projectOptions: QuadrantProjectOption[] = [];
	private scanStatus: 'loading' | 'ready' | 'root-missing' = 'loading';
	private loadToken = 0;
	private loadingTimer: number | null = null;
	private loadingVisible = false;
	private pendingPriorityPaths = new Set<string>();
	private readonly creatingQuadrants = new Set<QuadrantKey>();
	private projectMissingNotified = false;

	private headerEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private gridEl: HTMLElement | null = null;
	private sidebarEl: HTMLElement | null = null;
	private scrimEl: HTMLElement | null = null;
	private timeRangePopover: QuadrantTimeRangePopover | null = null;
	private dragDispose: (() => void) | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly deps: PriorityQuadrantDeps,
	) {
		super(leaf);
		this.navigation = true;
	}

	getViewType(): string {
		return IOTO_PRIORITY_QUADRANT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('priorityQuadrant.title');
	}

	getIcon(): string {
		return 'layout-grid';
	}

	getState(): Record<string, unknown> {
		return {
			...super.getState(),
			sidebarOpen: this.sidebarOpen,
			timeFilter: encodeQuadrantTimeFilter(this.timeFilter),
			statusKeys: [...this.statusKeys],
			projectScope: encodeQuadrantScope(this.projectScope),
			previewLeafId: getWorkspaceLeafId(this.previewLeaf) ?? undefined,
			openedTaskPath: this.openedTaskPath ?? undefined,
		};
	}

	async setState(state: unknown): Promise<void> {
		const parsed = parseQuadrantViewState(state);
		// 方案 B：叶子状态缺失时用设备级最近值作基线（`[]` 合法，不可真值判断）。
		const fallback = readQuadrantFilterFallback(this.app);
		const merged = mergeQuadrantViewState(
			{
				sidebarOpen: this.sidebarOpen,
				timeFilter: fallback.timeFilter ?? this.timeFilter,
				statusKeys: fallback.statusKeys ?? [...this.statusKeys],
				projectScope: fallback.projectScope ?? this.projectScope,
			},
			parsed,
		);
		const previousScope = this.projectScope;
		this.sidebarOpen = merged.sidebarOpen;
		this.timeFilter = merged.timeFilter;
		this.statusKeys = new Set(merged.statusKeys);
		this.projectScope = merged.projectScope;
		// 恢复了不同的项目范围（尤其是一个已被删除的项目）时，允许再次提示一次。
		if (
			this.projectScope.kind !== previousScope.kind ||
			this.projectScope.projectName !== previousScope.projectName
		) {
			this.projectMissingNotified = false;
		}
		// 叶子状态落地即镜像到设备级，保持「最近值」新鲜（工作区切换 / 复制标签也走这里）。
		this.writeFilterFallback();
		this.openedTaskPath = parsed.openedTaskPath ?? null;
		this.previewLeaf = parsed.previewLeafId
			? findLeafByIdIn(this.app, parsed.previewLeafId)
			: null;

		// 早于 `onOpen`（同 iotoTaskView.ts:681）：字段已就位，首轮 `reload` 会读到。
		if (!this.contentEl.isConnected) return;
		// 晚于 `onOpen`：扫描已就绪时用内存结果重建，零额外 IO。
		if (this.scanStatus === 'ready') this.rebuildModel();
		this.render();
	}

	async onOpen(): Promise<void> {
		this.contentEl.addClass('ioto-pq-view');
		this.contentEl.setAttr('data-view', 'priority-quadrant');
		// 首帧前就位，避免先闪 card 基线（[[Plan-20261116-052507]] §3.2）。
		this.applyAppearanceStyle();
		this.render();
		// 方案 A+：不阻塞 Obsidian 工作区恢复（leaf 复原外层 10s 超时）。
		void this.reload().catch((error: unknown) => {
			console.error('[IOTO Task Center] 优先级四象限首轮扫描失败', error);
		});
	}

	async onClose(): Promise<void> {
		this.dragDispose?.();
		this.dragDispose = null;
		this.clearLoadingTimer();
		this.pendingPriorityPaths.clear();
		this.timeRangePopover?.destroy();
		this.timeRangePopover = null;
		this.contentEl.empty();
	}

	// 设置变更：外观档位先切类，再按数据类设置（隐藏项目 / 根目录 / 显示优先级等）重载
	async handleSettingsChange(): Promise<void> {
		this.applyAppearanceStyle();
		await this.reload();
	}

	/**
	 * 跟随 TaskView 的外观档位（同一份 `data.json` 的 `appearanceStyle`）。
	 * 类挂在 `contentEl`：`render()` / `clearShell()` 不摘根类，重绘后主题自然保留。
	 */
	applyAppearanceStyle(): void {
		applyAppearanceStyleClasses(
			this.contentEl,
			this.deps.getAppearanceStyle(),
		);
	}

	// vault 外部变更（create / delete / modify / rename 的去抖后刷新）
	async refreshFromVaultChange(): Promise<void> {
		await this.reload();
	}

	// --- QuadrantViewContext ---

	getModel(): QuadrantModel | null {
		return this.model;
	}

	getProjectOptions(): QuadrantProjectOption[] {
		return this.projectOptions;
	}

	getStatusKeys(): ReadonlySet<QuadrantStatusKey> {
		return this.statusKeys;
	}

	getProjectScope(): QuadrantProjectScope {
		return this.projectScope;
	}

	isSidebarOpen(): boolean {
		return this.sidebarOpen;
	}

	getTimeFilter(): QuadrantTimeFilter {
		return this.timeFilter;
	}

	getShowTaskPriority(): boolean {
		return this.deps.getShowTaskPriority();
	}

	getColorTaskTitleByPriority(): boolean {
		return this.deps.getColorTaskTitleByPriority();
	}

	getShowProjectNameInTaskList(): boolean {
		return this.deps.getShowProjectNameInTaskList();
	}

	toggleStatusKey(key: QuadrantStatusKey): void {
		if (this.statusKeys.has(key)) this.statusKeys.delete(key);
		else this.statusKeys.add(key);
		this.rebuildModel();
		this.render();
		this.writeFilterFallback();
		this.app.workspace.requestSaveLayout();
	}

	setProjectScope(scope: QuadrantProjectScope): void {
		this.projectScope = scope;
		this.projectMissingNotified = false;
		this.rebuildModel();
		this.render();
		this.writeFilterFallback();
		this.app.workspace.requestSaveLayout();
	}

	toggleSidebar(): void {
		this.sidebarOpen = !this.sidebarOpen;
		this.render();
		// `getState` 在保存工作区时读取该字段，改完需主动请求落盘（[[Plan-20261116-060249]] E1）。
		this.app.workspace.requestSaveLayout();
	}

	setTimeFilter(filter: QuadrantTimeFilter): void {
		this.timeFilter = filter;
		this.rebuildModel();
		this.render();
		this.writeFilterFallback();
		this.app.workspace.requestSaveLayout();
	}

	openTimeRangeEditor(anchorEl: HTMLElement): void {
		const seed = this.timeRangeEditorSeed();
		const onApply = (
			field: TaskTimeField,
			start: string,
			end: string,
		): void => {
			this.setTimeFilter({ kind: 'custom', field, start, end });
		};
		const onClear = (): void => this.setTimeFilter({ kind: 'none' });

		if (Platform.isPhone) {
			new QuadrantTimeRangeModal(this.app, {
				...seed,
				onApply,
				onClear,
				onAfterClose: () => anchorEl.focus(),
			}).open();
			return;
		}

		this.timeRangePopover?.destroy();
		const popover = new QuadrantTimeRangePopover(
			this.contentEl.ownerDocument,
		);
		this.timeRangePopover = popover;
		popover.open({
			hostEl: this.contentEl,
			anchorEl,
			...seed,
			onApply,
			onClear,
			onAfterClose: () => {
				if (this.timeRangePopover === popover) {
					this.timeRangePopover = null;
				}
			},
		});
	}

	/** 自定义编辑器初值：当前自定义 → 预设换算 → 默认最近 14 天（§2.2-2）。 */
	private timeRangeEditorSeed(): {
		field: TaskTimeField;
		start: string;
		end: string;
	} {
		const nowMs = Date.now();
		const filter = this.timeFilter;
		if (filter.kind === 'custom') {
			return {
				field: filter.field,
				start: filter.start ?? '',
				end: filter.end ?? '',
			};
		}
		if (filter.kind === 'preset') {
			const bounds = resolveTaskTimeBounds(filter, nowMs);
			return {
				field: bounds?.field ?? 'updated',
				start:
					bounds?.startMs === undefined
						? ''
						: toLocalDateString(bounds.startMs),
				end: toLocalDateString(nowMs),
			};
		}
		return {
			field: 'updated',
			start: toLocalDateString(nowMs - FOURTEEN_DAYS_MS),
			end: toLocalDateString(nowMs),
		};
	}

	setPriority(path: string, priority: TaskPriorityValue | undefined): void {
		void this.writePriority(path, priority);
	}

	openTask(path: string, mods: MouseEvent | null): void {
		void openQuadrantTask(this, path, mods);
	}

	openPriorityMenu(
		task: TaskFileEntry,
		event: MouseEvent,
		anchor: HTMLElement,
	): void {
		const menu = new Menu();
		buildQuadrantPriorityMenu(menu, {
			priority: task.priority,
			onSelect: (priority) => this.setPriority(task.path, priority),
		});
		if (event.type === 'contextmenu') {
			menu.showAtMouseEvent(event);
			return;
		}
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	isCardBusy(path: string): boolean {
		return this.pendingPriorityPaths.has(path);
	}

	createTaskInQuadrant(
		key: QuadrantKey,
		event: MouseEvent,
		anchor: HTMLElement,
	): void {
		if (this.creatingQuadrants.size > 0) {
			new Notice(t('priorityQuadrant.create.busy'));
			return;
		}

		const options = resolveQuadrantTaskTypeOptions(
			this.deps.getEnabledTaskCreationTypes(),
		);
		const [onlyOption] = options;
		if (!onlyOption) return;
		if (options.length === 1) {
			this.startQuadrantTaskCreation(key, onlyOption.key);
			return;
		}

		// 与任务中心一致：菜单在 click 的同步路径里打开，且不被 await。
		const menu = new Menu();
		menu.setUseNativeMenu(false);
		for (const option of options) {
			menu.addItem((item) =>
				item.setTitle(option.label).onClick(() =>
					runAfterMenuCloses(menu, () =>
						this.startQuadrantTaskCreation(key, option.key),
					),
				),
			);
		}

		// 键盘触发的合成 click 没有指针坐标，回退到按钮矩形。
		if (event.detail === 0) {
			const rect = anchor.getBoundingClientRect();
			menu.showAtPosition({ x: rect.left, y: rect.bottom });
			return;
		}
		menu.showAtMouseEvent(event);
	}

	isLeafAvailable(targetLeaf: WorkspaceLeaf): boolean {
		return isLeafAvailableIn(this.app, targetLeaf);
	}

	ensurePreviewLeaf(): WorkspaceLeaf {
		return ensurePreviewLeafFor(this);
	}

	getTasksRootPath(): string {
		return this.deps.getTasksRootPath();
	}

	getUseIOTOTaskViewAsDefault(): boolean {
		return this.deps.getUseIOTOTaskViewAsDefault();
	}

	async openCreatedTask(
		file: TFile,
		cursorOffset: number | null,
	): Promise<void> {
		const leaf = this.ensurePreviewLeaf();
		this.previewLeaf = leaf;
		await openCreatedTaskNote(this.app, leaf, file, {
			tasksRootPath: this.deps.getTasksRootPath(),
			preferTaskView: this.deps.getUseIOTOTaskViewAsDefault(),
			cursorOffset,
		});
	}

	private startQuadrantTaskCreation(
		key: QuadrantKey,
		type: TaskCreationType,
	): void {
		void runQuadrantTaskCreation(key, type, {
			app: this.app,
			getTasksRootPath: () => this.deps.getTasksRootPath(),
			getProjectScope: () => this.projectScope,
			getProjectOptions: () => this.projectOptions,
			getTaskTemplateConfig: (typeConfig) =>
				this.deps.getTaskTemplateConfig(typeConfig),
			getDateTaskDateFormat: () => this.deps.getDateTaskDateFormat(),
			ensurePreviewLeaf: () => this.ensurePreviewLeaf(),
			openCreatedTask: (file, cursorOffset) =>
				this.openCreatedTask(file, cursorOffset),
			sourceLeaf: this.leaf,
			isTaskVisible: (path) => this.isTaskVisibleInModel(path),
			beginCreating: (targetKey) =>
				this.setCreatingInQuadrant(targetKey, true),
			endCreating: (targetKey) =>
				this.setCreatingInQuadrant(targetKey, false),
			reload: () => this.reload(),
		});
	}

	isCreatingInQuadrant(key: QuadrantKey): boolean {
		return this.creatingQuadrants.has(key);
	}

	private setCreatingInQuadrant(key: QuadrantKey, creating: boolean): void {
		if (creating) this.creatingQuadrants.add(key);
		else this.creatingQuadrants.delete(key);
		this.render();
	}

	private isTaskVisibleInModel(path: string): boolean {
		const model = this.model;
		if (!model) return false;
		if (model.unlabeled.some((task) => task.path === path)) return true;
		return QUADRANT_KEYS.some((key) =>
			model.buckets[key].some((task) => task.path === path),
		);
	}

	// --- 加载与状态 ---

	/** 过滤状态的唯一落盘点：三字段同写，避免后续新增字段再漏（[[Plan-20261116-161225]] 步骤 4.5）。 */
	private writeFilterFallback(): void {
		writeQuadrantFilterFallback(this.app, {
			statusKeys: this.statusKeys,
			timeFilter: this.timeFilter,
			projectScope: this.projectScope,
		});
	}

	private async reload(): Promise<void> {
		const token = ++this.loadToken;
		if (this.model === null && this.loadingTimer === null) {
			this.loadingTimer = window.setTimeout(() => {
				this.loadingTimer = null;
				if (token !== this.loadToken) return;
				this.loadingVisible = true;
				this.render();
			}, QUADRANT_LOADING_RENDER_DELAY_MS);
		}

		const hiddenProjectNames = new Set(
			this.deps.getHiddenProjectNames(),
		);
		const result = await scanQuadrantTasks(
			this.app,
			this.deps.getTasksRootPath(),
			hiddenProjectNames,
		);

		if (token !== this.loadToken) return;
		this.clearLoadingTimer();
		this.loadingVisible = false;
		this.projectOptions = result.projects;

		if (result.status === 'root-missing') {
			this.scanStatus = 'root-missing';
			this.model = null;
			this.lastTasks = [];
			this.render();
			return;
		}

		this.scanStatus = 'ready';
		if (
			this.projectScope.kind === 'project' &&
			!result.projects.some(
				(project) => project.name === this.projectScope.projectName,
			)
		) {
			this.projectScope = { kind: 'unarchived' };
			// 回退结果立即落盘，避免每次启动重复弹 Notice（[[Plan-20261116-161225]] 步骤 4.4）。
			this.writeFilterFallback();
			this.app.workspace.requestSaveLayout();
			if (!this.projectMissingNotified) {
				this.projectMissingNotified = true;
				new Notice(t('priorityQuadrant.notice.projectMissing'));
			}
		} else {
			this.projectMissingNotified = false;
		}

		this.lastTasks = result.tasks;
		this.rebuildModel();
		this.render();
	}

	private rebuildModel(): void {
		this.model = buildQuadrantModel(this.lastTasks, {
			statusKeys: this.statusKeys,
			projectScope: this.projectScope,
			hiddenProjectNames: new Set(this.deps.getHiddenProjectNames()),
			timeFilter: this.timeFilter,
		});
	}

	private clearLoadingTimer(): void {
		if (this.loadingTimer !== null) {
			window.clearTimeout(this.loadingTimer);
			this.loadingTimer = null;
		}
	}

	// --- 写优先级 ---

	private async writePriority(
		path: string,
		priority: TaskPriorityValue | undefined,
	): Promise<void> {
		if (this.pendingPriorityPaths.has(path)) return;
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			new Notice(t('view.notice.updateTaskPriorityFailed'));
			return;
		}

		this.pendingPriorityPaths.add(path);
		this.markCardBusy(path, true);
		try {
			if (priority === undefined) {
				await clearTaskFilePriority(this.app, file);
			} else {
				await setTaskFilePriority(this.app, file, priority);
			}
			// 本地乐观更新：卡片立即迁移，不等 vault 事件。
			this.applyLocalPriority(path, priority);
			this.render();
			void this.reload(); // 以磁盘为准兜底
		} catch {
			new Notice(
				priority === undefined
					? t('view.notice.clearTaskPriorityFailed')
					: t('view.notice.updateTaskPriorityFailed'),
			);
		} finally {
			this.pendingPriorityPaths.delete(path);
			this.markCardBusy(path, false);
		}
	}

	private applyLocalPriority(
		path: string,
		priority: TaskPriorityValue | undefined,
	): void {
		this.lastTasks = this.lastTasks.map((task) =>
			task.path === path ? { ...task, priority } : task,
		);
		this.rebuildModel();
	}

	private markCardBusy(path: string, busy: boolean): void {
		for (const cardEl of Array.from(
			this.contentEl.querySelectorAll<HTMLElement>('.ioto-pq-card'),
		)) {
			if (cardEl.dataset.taskPath !== path) continue;
			cardEl.classList.toggle('is-busy', busy);
			if (busy) cardEl.setAttribute('aria-busy', 'true');
			else cardEl.removeAttribute('aria-busy');
			const moreEl = cardEl.querySelector<HTMLButtonElement>(
				'.ioto-pq-card__more',
			);
			if (moreEl) moreEl.disabled = busy;
		}
	}

	// --- 渲染 ---

	private render(): void {
		const root = this.contentEl;
		root.dataset.scanStatus = this.scanStatus;
		root.dataset.projectScope = encodeQuadrantScope(this.projectScope);
		root.dataset.statusFilter = [...this.statusKeys].join(',');
		root.dataset.sidebarOpen = this.sidebarOpen ? 'true' : 'false';
		root.dataset.timeFilter = encodeQuadrantTimeFilter(this.timeFilter);

		if (this.scanStatus === 'root-missing') {
			this.clearShell();
			renderQuadrantState(
				root,
				'root-missing',
				this.deps.getTasksRootPath(),
			);
			return;
		}

		if (!this.model) {
			if (!this.loadingVisible) return;
			this.clearShell();
			renderQuadrantState(root, 'loading', this.deps.getTasksRootPath());
			return;
		}

		if (!this.headerEl) {
			// 首帧 / 从 loading、root-missing 恢复：先清掉整页状态占位。
			root.empty();
			this.headerEl = buildQuadrantFilterBar(root, this);
		}
		if (!this.bodyEl) this.buildBody();

		updateQuadrantFilterBar(this.headerEl, this);
		const scrollPositions = captureQuadrantScroll(this.bodyEl!);
		renderQuadrantGrid(this.gridEl!, this, scrollPositions);
		renderQuadrantSidebar(this.sidebarEl!, this, scrollPositions);
		this.scrimEl!.hidden = !this.sidebarOpen;
	}

	private buildBody(): void {
		const root = this.contentEl;
		this.bodyEl = root.createDiv({ cls: QUADRANT_BODY_CLASS });
		const gridEl = this.bodyEl.createDiv({ cls: 'ioto-pq-grid' });
		const sidebarEl = this.bodyEl.createEl('aside', {
			cls: 'ioto-pq-sidebar',
		});
		sidebarEl.id = 'ioto-pq-sidebar';
		const scrimEl = this.bodyEl.createDiv({ cls: 'ioto-pq-scrim' });
		scrimEl.hidden = !this.sidebarOpen;
		scrimEl.addEventListener('click', () => {
			if (this.sidebarOpen) this.toggleSidebar();
		});
		this.gridEl = gridEl;
		this.sidebarEl = sidebarEl;
		this.scrimEl = scrimEl;

		// 手势挂容器（事件委托）：`render()` 重建象限与卡片不影响监听。
		this.dragDispose?.();
		this.dragDispose = attachQuadrantDrag({
			gridEl,
			sidebarEl,
			isCardBusy: (path) => this.isCardBusy(path),
			setPriority: (path, priority) => this.setPriority(path, priority),
			// P1 换成侧栏真实可见性判定。
			isSidebarDropEnabled: () => false,
		});
	}

	private clearShell(): void {
		this.dragDispose?.();
		this.dragDispose = null;
		if (this.headerEl) {
			this.headerEl.remove();
			this.headerEl = null;
		}
		if (this.bodyEl) {
			this.bodyEl.remove();
			this.bodyEl = null;
		}
		this.gridEl = null;
		this.sidebarEl = null;
		this.scrimEl = null;
	}
}
