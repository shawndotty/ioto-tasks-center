/**
 * 优先级四象限视图（[[Plan-20261115-201917]] §3.4）。
 *
 * 跨项目聚合 `Priority: 0~3` 的任务笔记：P3 桶收 `>=3`，未标注进右侧侧栏。
 * 本文件只保留生命周期、过滤状态、reload 编排、写优先级与上下文方法；
 * 渲染细节拆在 `views/quadrant/*`。
 */

import { ItemView, Menu, Notice, TFile, type WorkspaceLeaf } from 'obsidian';

import { t } from '../lang/helpter';
import {
	buildQuadrantModel,
	type QuadrantModel,
	type QuadrantProjectScope,
	type QuadrantStatusKey,
} from '../tasks-center/quadrant-data';
import {
	clearTaskFilePriority,
	setTaskFilePriority,
	type TaskPriorityValue,
} from '../tasks-center/task-priority';
import type { TaskFileEntry } from '../tasks-center/types';
import { buildQuadrantFilterBar, encodeQuadrantScope, updateQuadrantFilterBar } from './quadrant/filter-bar';
import {
	IOTO_PRIORITY_QUADRANT_VIEW_TYPE,
	QUADRANT_BODY_CLASS,
	QUADRANT_COMPACT_BREAKPOINT,
	QUADRANT_LOADING_RENDER_DELAY_MS,
} from './quadrant/constants';
import type { QuadrantViewContext } from './quadrant/context';
import {
	scanQuadrantTasks,
	type QuadrantProjectOption,
} from './quadrant/data-loader';
import { buildQuadrantPriorityMenu } from './quadrant/menus';
import {
	captureQuadrantScroll,
	renderQuadrantGrid,
} from './quadrant/quadrant-grid';
import { renderQuadrantSidebar } from './quadrant/sidebar';
import { renderQuadrantState } from './quadrant/states';
import { openQuadrantTask } from './quadrant/task-open';

export interface PriorityQuadrantDeps {
	getTasksRootPath(): string;
	getHiddenProjectNames(): string[];
	getShowTaskPriority(): boolean;
	getColorTaskTitleByPriority(): boolean;
	getShowProjectNameInTaskList(): boolean;
	getUseIOTOTaskViewAsDefault(): boolean;
}

export class IOTOPriorityQuadrantView
	extends ItemView
	implements QuadrantViewContext
{
	private statusKeys = new Set<QuadrantStatusKey>(['in-progress', 'todo']);
	private projectScope: QuadrantProjectScope = { kind: 'unarchived' };
	private sidebarOpen = true;
	private model: QuadrantModel | null = null;
	private lastTasks: TaskFileEntry[] = [];
	private projectOptions: QuadrantProjectOption[] = [];
	private scanStatus: 'loading' | 'ready' | 'root-missing' = 'loading';
	private loadToken = 0;
	private loadingTimer: number | null = null;
	private loadingVisible = false;
	private pendingPriorityPaths = new Set<string>();
	private projectMissingNotified = false;

	private headerEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private gridEl: HTMLElement | null = null;
	private sidebarEl: HTMLElement | null = null;
	private scrimEl: HTMLElement | null = null;

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

	async onOpen(): Promise<void> {
		this.contentEl.addClass('ioto-pq-view');
		this.contentEl.setAttr('data-view', 'priority-quadrant');
		this.render();
		// 窄容器默认收起侧栏（E3）；首帧布局完成后再量宽度。
		window.requestAnimationFrame(() => {
			if (!this.contentEl.isConnected) return;
			const width = this.contentEl.clientWidth;
			if (
				width > 0 &&
				width < QUADRANT_COMPACT_BREAKPOINT &&
				this.sidebarOpen
			) {
				this.sidebarOpen = false;
				this.render();
			}
		});
		await this.reload();
	}

	async onClose(): Promise<void> {
		this.clearLoadingTimer();
		this.pendingPriorityPaths.clear();
		this.contentEl.empty();
	}

	// 设置变更（隐藏项目 / 根目录 / 显示优先级 / 按优先级着色 / 显示项目名）
	async handleSettingsChange(): Promise<void> {
		await this.reload();
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
	}

	setProjectScope(scope: QuadrantProjectScope): void {
		this.projectScope = scope;
		this.projectMissingNotified = false;
		this.rebuildModel();
		this.render();
	}

	toggleSidebar(): void {
		this.sidebarOpen = !this.sidebarOpen;
		this.render();
	}

	setPriority(path: string, priority: TaskPriorityValue | undefined): void {
		void this.writePriority(path, priority);
	}

	openTask(path: string, mods: MouseEvent | null): void {
		void openQuadrantTask(
			this.app,
			this.deps.getTasksRootPath(),
			path,
			mods,
			this.deps.getUseIOTOTaskViewAsDefault(),
		);
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

	// --- 加载与状态 ---

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
		this.gridEl = this.bodyEl.createDiv({ cls: 'ioto-pq-grid' });
		this.sidebarEl = this.bodyEl.createEl('aside', {
			cls: 'ioto-pq-sidebar',
		});
		this.sidebarEl.id = 'ioto-pq-sidebar';
		this.scrimEl = this.bodyEl.createDiv({ cls: 'ioto-pq-scrim' });
		this.scrimEl.hidden = !this.sidebarOpen;
		this.scrimEl.addEventListener('click', () => {
			if (this.sidebarOpen) this.toggleSidebar();
		});
	}

	private clearShell(): void {
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
