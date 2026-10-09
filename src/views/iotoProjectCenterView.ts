/**
 * 项目中心视图：项目列表与元数据管理的 ItemView。
 *
 * Phase 5 拆分后，渲染/动作/单元格/卡片/头部逻辑分别移至：
 * - `project-center-types`：类型 + `ProjectCenterViewContext` 契约 + 纯函数
 * - `project-center-header`：头部 DOM（搜索输入、搜索/刷新/创建按钮）
 * - `project-center-renderer`：列表/表格/卡片/状态占位渲染
 * - `project-center-cells`：表格单元格渲染器
 * - `project-center-card`：紧凑卡片渲染
 * - `project-center-actions`：创建项目/归档/分类/元数据/规格文件动作
 *
 * 本文件仅保留生命周期、状态加载、渲染编排与上下文方法实现。
 * `IOTOProjectCenterView` 结构性实现 `ProjectCenterViewContext`，对外暴露 `this` 即可。
 */

import { ItemView, WorkspaceLeaf } from 'obsidian';

import { t } from '../lang/helpter';
import { listProjectFolders } from '../tasks-center/data';
import {
	countProjectTaskNotes,
	getProjectMetadataFile,
	readProjectMetadata,
	type ProjectMetadata,
} from '../tasks-center/project-metadata';
import {
	COMPACT_LAYOUT_BREAKPOINT,
	NARROW_LAYOUT_BREAKPOINT,
} from './tasks-center/constants';
import {
	captureProjectCenterScrollPosition,
	restoreProjectCenterScrollPosition,
	type ScrollPosition,
} from './project-center-scroll';
import type {
	ProjectCenterSortDirection,
	ProjectCenterSortKey,
} from './project-center-sort';
import { buildProjectCenterHeader } from './project-center-header';
import { renderProjectCenterList } from './project-center-renderer';
import {
	parseViewState,
	type ProjectCenterRow,
	type ProjectCenterViewContext,
} from './project-center-types';

export const IOTO_PROJECT_CENTER_VIEW_TYPE = 'IOTOProjectCenter';

export class IOTOProjectCenterView
	extends ItemView
	implements ProjectCenterViewContext
{
	// 上下文可读状态（public 以满足 ProjectCenterViewContext 契约）
	public rows: ProjectCenterRow[] = [];
	public status: 'idle' | 'loading' | 'root-missing' = 'idle';
	public isCreatingProject = false;
	public sortKey: ProjectCenterSortKey = 'projectName';
	public sortDirection: ProjectCenterSortDirection = 'asc';
	public isProjectSearchVisible = false;
	public projectSearchInputValue = '';
	public projectSearchQuery = '';
	public isCompactLayout = false;
	public previewLeaf: WorkspaceLeaf | null = null;

	// 视图内部状态
	private contentScroll: ScrollPosition = { scrollTop: 0, scrollLeft: 0 };
	private shouldFocusProjectSearch = false;
	public readonly getTasksRootPath: () => string;
	private readonly getHiddenProjectNames: () => string[];
	public readonly setProjectHidden: (
		projectName: string,
		hidden: boolean,
	) => Promise<void>;
	public readonly getProjectCategoryOptions: () => string[];
	public readonly addProjectCategoryOption: (
		category: string,
	) => Promise<void>;
	private readonly refreshTokenParent: { token: number } = {
		token: 0,
	};
	private isNarrowLayout = false;
	private resizeObserver: ResizeObserver | null = null;
	private headerEl: HTMLElement | null = null;
	private contentContainerEl: HTMLElement | null = null;
	private createProjectButtonEl: HTMLButtonElement | null = null;
	private lastHeaderSearchVisible: boolean | null = null;
	private lastHeaderSearchHasQuery = false;

	constructor(
		leaf: WorkspaceLeaf,
		getTasksRootPath: () => string,
		getHiddenProjectNames: () => string[],
		setProjectHidden: (
			projectName: string,
			hidden: boolean,
		) => Promise<void>,
		getProjectCategoryOptions: () => string[],
		addProjectCategoryOption: (category: string) => Promise<void>,
	) {
		super(leaf);
		this.navigation = true;
		this.getTasksRootPath = getTasksRootPath;
		this.getHiddenProjectNames = getHiddenProjectNames;
		this.setProjectHidden = setProjectHidden;
		this.getProjectCategoryOptions = getProjectCategoryOptions;
		this.addProjectCategoryOption = addProjectCategoryOption;
	}

	getViewType(): string {
		return IOTO_PROJECT_CENTER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('projectCenter.title');
	}

	getIcon(): string {
		return 'table';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('ioto-project-center-view');
		this.startResizeObserver();
		await this.refreshFromVaultChange();
	}

	async onClose(): Promise<void> {
		this.stopResizeObserver();
		this.contentEl.empty();
		this.headerEl = null;
		this.contentContainerEl = null;
		this.createProjectButtonEl = null;
	}

	private startResizeObserver(): void {
		if (
			this.resizeObserver ||
			typeof ResizeObserver === 'undefined'
		) {
			this.syncCompactLayout(this.contentEl.clientWidth);
			return;
		}

		this.resizeObserver = new ResizeObserver((entries) => {
			const entry = entries[0];
			this.syncCompactLayout(
				entry?.contentRect.width ?? this.contentEl.clientWidth,
			);
		});
		this.resizeObserver.observe(this.contentEl);
		this.syncCompactLayout(this.contentEl.clientWidth);
	}

	private stopResizeObserver(): void {
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
	}

	private syncCompactLayout(width: number): void {
		if (width <= 0) {
			return;
		}

		const nextCompactLayout = width <= COMPACT_LAYOUT_BREAKPOINT;
		const nextNarrowLayout = width < NARROW_LAYOUT_BREAKPOINT;
		if (
			this.isCompactLayout === nextCompactLayout &&
			this.isNarrowLayout === nextNarrowLayout
		) {
			return;
		}

		this.isCompactLayout = nextCompactLayout;
		this.isNarrowLayout = nextNarrowLayout;
		if (this.contentEl.isConnected) {
			this.render();
		}
	}

	getState(): Record<string, unknown> {
		return {
			sortKey: this.sortKey,
			sortDirection: this.sortDirection,
		};
	}

	async setState(state: unknown): Promise<void> {
		const viewState = parseViewState(state);
		this.sortKey = viewState.sortKey ?? 'projectName';
		this.sortDirection = viewState.sortDirection ?? 'asc';
		await this.refreshFromVaultChange();
	}

	async handleSettingsChange(): Promise<void> {
		await this.refreshFromVaultChange();
	}

	async refreshFromVaultChange(): Promise<void> {
		const token = ++this.refreshTokenParent.token;
		this.status = 'loading';
		this.render();

		const tasksRootPath = this.getTasksRootPath();
		const result = listProjectFolders(this.app, tasksRootPath);
		if (token !== this.refreshTokenParent.token) {
			return;
		}

		if (result.status === 'root-missing') {
			this.rows = [];
			this.status = 'root-missing';
			this.render();
			return;
		}

		this.status = 'loading';
		const hiddenProjectNames = new Set(this.getHiddenProjectNames());
		const rows = await Promise.all(
			result.projects.map(async (project) => {
				const archived = hiddenProjectNames.has(project.name);
				const taskCount = countProjectTaskNotes(
					this.app,
					tasksRootPath,
					project.name,
				);
				const metadataFile = getProjectMetadataFile(
					this.app,
					tasksRootPath,
					project.name,
				);
				const metadata: ProjectMetadata = metadataFile
					? await readProjectMetadata(this.app, metadataFile)
					: {};
				return {
					name: project.name,
					path: project.path,
					taskCount,
					archived,
					metadata,
				} satisfies ProjectCenterRow;
			}),
		);
		if (token !== this.refreshTokenParent.token) {
			return;
		}

		this.rows = rows;
		this.status = 'idle';
		this.render();
	}

	render(): void {
		const root = this.contentEl;
		this.contentScroll = captureProjectCenterScrollPosition(
			root,
			this.contentScroll,
		);

		const hasQuery = Boolean(
			this.projectSearchInputValue || this.projectSearchQuery,
		);
		const needRebuildHeader =
			!this.headerEl ||
			this.contentContainerEl === null ||
			this.lastHeaderSearchVisible !== this.isProjectSearchVisible ||
			(this.isProjectSearchVisible &&
				this.lastHeaderSearchHasQuery !== hasQuery);

		if (needRebuildHeader) {
			root.empty();
			this.headerEl = root.createDiv({
				cls: 'ioto-project-center__header',
			});
			this.createProjectButtonEl = buildProjectCenterHeader(
				this.headerEl,
				this,
			);
			this.contentContainerEl = root.createDiv({
				cls: 'ioto-project-center__content',
			});
			this.lastHeaderSearchVisible = this.isProjectSearchVisible;
			this.lastHeaderSearchHasQuery = hasQuery;
		}

		root.toggleClass('is-compact-layout', this.isCompactLayout);
		root.toggleClass('is-narrow-layout', this.isNarrowLayout);

		if (this.createProjectButtonEl) {
			this.createProjectButtonEl.disabled = !this.canCreateProject();
		}

		renderProjectCenterList(this.contentContainerEl!, this);
		restoreProjectCenterScrollPosition(
			this.contentContainerEl,
			this.contentScroll,
		);
	}

	canCreateProject(): boolean {
		return (
			this.status === 'idle' &&
			!this.isCreatingProject &&
			this.getTasksRootPath().trim().length > 0
		);
	}

	handleSortClick(key: ProjectCenterSortKey): void {
		if (this.sortKey !== key) {
			this.sortKey = key;
			this.sortDirection = 'asc';
			this.render();
			return;
		}

		this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
		this.render();
	}

	applyProjectSearchQuery(): void {
		const nextQuery = this.projectSearchInputValue;
		if (nextQuery === this.projectSearchQuery) {
			return;
		}

		this.projectSearchQuery = nextQuery;
		this.render();
	}

	clearProjectSearch(): void {
		if (!this.projectSearchInputValue && !this.projectSearchQuery) {
			return;
		}

		this.projectSearchInputValue = '';
		this.projectSearchQuery = '';
		this.render();
	}

	toggleProjectSearch(): void {
		this.isProjectSearchVisible = !this.isProjectSearchVisible;
		if (this.isProjectSearchVisible) {
			this.shouldFocusProjectSearch = true;
		}
		this.render();
	}

	setProjectSearchInputValue(value: string): void {
		this.projectSearchInputValue = value;
	}

	consumeShouldFocusProjectSearch(): boolean {
		const value = this.shouldFocusProjectSearch;
		this.shouldFocusProjectSearch = false;
		return value;
	}

	setIsCreatingProject(value: boolean): void {
		this.isCreatingProject = value;
	}

	setPreviewLeaf(leaf: WorkspaceLeaf | null): void {
		this.previewLeaf = leaf;
	}
}
