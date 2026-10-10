import {
	type HoverPopover,
	ItemView,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';

import type { TaskPriorityValue } from '../tasks-center/task-priority';

import {
	type BatchTaskItem,
	type BatchTaskTemplate,
	type BatchTemplateConfig,
} from '../tasks-center/batch-task-template';
import type {
	TaskCreationType,
	TaskTemplateConfig,
} from '../tasks-center/task-template-config';
import type {
	ProjectListGroupMode,
	ProjectListSortMode,
	TaskLinkBadgeBackgroundMode,
	TaskListGroupMode,
	TaskListSortMode,
	TaskListTimeFilter,
	TaskSearchEntryMode,
} from '../settings';
import { t } from '../lang/helpter';
import type {
	IncompleteChecklistItem,
	ProjectFolderEntry,
	ProjectListResult,
	TaskFileEntry,
	TaskFileListResult,
} from '../tasks-center/types';
import {
	TaskOutlinkPopover,
	type TaskOutlinkCategory,
} from '../ui/task-outlink-popover';
import { TaskStatusChecklistPopover } from '../ui/task-status-checklist-popover';
import { TaskSearchModal } from '../ui/task-search-modal';
import {
	handleTaskDragStart,
	handleTaskDragOver,
	handleTaskDragLeave,
	handleTaskDrop,
	setCurrentDropTarget,
	clearTaskDragState,
	getTaskRowElements,
	findTaskRowByPath,
	assignDraggedTaskToParent,
	handleRemoveUpTaskDragOver,
	handleRemoveUpTaskDragLeave,
	handleRemoveUpTaskDrop,
	clearCurrentTaskDropTargetClasses,
	removeDraggedTaskParent,
} from './tasks-center/drag-controller';
import { type TaskFilterTab } from './task-filter-tabs';
import * as SearchController from './tasks-center/search-controller';
import {
	refreshFromVaultChange,
	loadProjects,
	loadTasks,
	getCachedTaskPath,
	selectProject,
	refreshProjectIncompleteCounts as refreshProjectIncompleteCountsFn,
} from './tasks-center/data-loader';
import { LOADING_RENDER_DELAY_MS } from './tasks-center/constants';
import {
	triggerBatchCreateFromTemplate,
	executeBatchCreate,
	canCreateTask,
	getAddTaskButtonLabel,
	canCreateProject as canCreateProjectFn,
	getAddProjectButtonLabel as getAddProjectButtonLabelFn,
	handleCreateProject,
	showTaskCreationMenu as showTaskCreationMenuFn,
	handleCreateTask,
	handleCreateSubtask,
	applyCreatedTaskSettings,
	updateTaskPriority,
	clearTaskPriority,
	updateTaskStarred,
	clearTaskStarred,
	confirmAndDeleteTask,
} from './tasks-center/task-operations';
import { captureProjectListScrollTop } from './project-list-scroll';
import { captureTaskListScrollTop } from './task-list-scroll';
import { renderProjectsPane } from './tasks-center/projects-pane-renderer';
import {
	renderTasksPane as renderTasksPaneFn,
} from './tasks-center/tasks-pane-renderer';
import { renderTaskRows as renderTaskRowsFn } from './tasks-center/task-row-renderer';
import {
	bindTaskSubtaskPopover as bindTaskSubtaskPopoverFn,
	bindTaskOutlinkPopover as bindTaskOutlinkPopoverFn,
	bindTaskStatusChecklistPopover as bindTaskStatusChecklistPopoverFn,
} from './tasks-center/popover-controller';
import {
	queueOutlinkBadgeUpdate as queueOutlinkBadgeUpdateFn,
	updateTaskOutlinkBadges as updateTaskOutlinkBadgesFn,
} from './tasks-center/outlink-badge-sync';
import {
	getWorkspaceLeafId,
	parseViewState,
	type TaskOpenTarget,
} from './tasks-center/constants';
import { createTaskSearchSession } from './tasks-center/task-search-session';
import type { TaskSearchHit } from './tasks-center/task-search-index';
import {
	renderTaskSearchRow as renderTaskSearchRowFn,
} from './tasks-center/task-search-row';
import {
	getActiveTaskPath as getActiveTaskPathFn,
	getPreviewLeafFilePath as getPreviewLeafFilePathFn,
	activatePreviewLeaf as activatePreviewLeafFn,
	ensurePreviewLeaf as ensurePreviewLeafFn,
	isLeafAvailable,
	findLeafByFilePath,
	findLeafById,
} from './tasks-center/preview-leaf';
import {
	showProjectContextMenu,
	showProjectPresentationMenu,
	showTaskPresentationMenu,
	showTaskPriorityMenu,
	showTaskSubtaskTypeMenu,
} from './tasks-center/menus';
import {
	setTaskSearchQuery as setTaskSearchQueryFn,
	focusTaskSearch as focusTaskSearchFn,
	focusFirstTaskRow as focusFirstTaskRowFn,
	getTaskSearchSummary as getTaskSearchSummaryFn,
	getTaskSearchHit as getTaskSearchHitFn,
	applyTaskSearch as applyTaskSearchFn,
	getTaskFilterCounts as getTaskFilterCountsFn,
	getTaskFilterSwitcherLabel as getTaskFilterSwitcherLabelFn,
	renderTaskListIncremental as renderTaskListIncrementalFn,
	syncTaskSearchCount as syncTaskSearchCountFn,
} from './tasks-center/task-search-ops';
import { renderTaskTabs as renderTaskTabsFn } from './tasks-center/task-tabs-renderer';
import {
	getTasksForActiveTab as getTasksForActiveTabFn,
	getVisibleTasks as getVisibleTasksFn,
	getTaskPresentationSections as getTaskPresentationSectionsFn,
	isTaskGroupCollapsed as isTaskGroupCollapsedFn,
	isProjectGroupCollapsed as isProjectGroupCollapsedFn,
	toggleTaskGroupCollapsed as toggleTaskGroupCollapsedFn,
	toggleProjectGroupCollapsed as toggleProjectGroupCollapsedFn,
	isSubtasksCollapsed as isSubtasksCollapsedFn,
	toggleSubtasksCollapsed as toggleSubtasksCollapsedFn,
	toggleBatchEditMode as toggleBatchEditModeFn,
	toggleTaskSelected as toggleTaskSelectedFn,
	getSelectedTasks as getSelectedTasksFn,
	selectAllVisibleTasks as selectAllVisibleTasksFn,
	clearSelection as clearSelectionFn,
	syncCollapsedTaskGroups as syncCollapsedTaskGroupsFn,
	syncCollapsedProjectGroups as syncCollapsedProjectGroupsFn,
	getTaskListDescription as getTaskListDescriptionFn,
	buildDirectChildTasksForCurrentProject as buildDirectChildTasksForCurrentProjectFn,
} from './tasks-center/task-list-queries';
import {
	triggerTaskHoverPreview as triggerTaskHoverPreviewFn,
	shouldDeferVaultRefresh as shouldDeferVaultRefreshFn,
	scheduleDeferredVaultRefresh as scheduleDeferredVaultRefreshFn,
	clearDeferredVaultRefreshState as clearDeferredVaultRefreshStateFn,
} from './tasks-center/deferred-refresh';
import {
	renderCompactProjectSwitcher as renderCompactProjectSwitcherFn,
	isMobileTaskListLayout as isMobileTaskListLayoutFn,
	toggleTaskListHeaderExpanded as toggleTaskListHeaderExpandedFn,
	applyTaskListHeaderCollapsed as applyTaskListHeaderCollapsedFn,
	canSwitchProjects as canSwitchProjectsFn,
	startResizeObserver as startResizeObserverFn,
	stopResizeObserver as stopResizeObserverFn,
} from './tasks-center/compact-layout';
import {
	renderTaskFilterEmptyState as renderTaskFilterEmptyStateFn,
	renderTaskSearchEmptyState as renderTaskSearchEmptyStateFn,
	renderState as renderStateFn,
} from './tasks-center/empty-states';
import {
	openTaskFile as openTaskFileFn,
	openTaskFileAtChecklist as openTaskFileAtChecklistFn,
	openOutlinkFileInPreview as openOutlinkFileInPreviewFn,
	openProjectSpecByProject as openProjectSpecByProjectFn,
	openFileInPreview as openFileInPreviewFn,
	findReusablePreviewLeaf as findReusablePreviewLeafFn,
} from './tasks-center/task-file-opening';

export const IOTO_TASKS_CENTER_VIEW_TYPE = 'IOTOTasksCenter';

export class IOTOTasksCenterView extends ItemView {
	projects: ProjectFolderEntry[] = [];
	projectIncompleteCounts = new Map<string, number>();
	projectCategoryByName = new Map<string, string>();
	public selectedProject: string | null = null;
	public tasks: TaskFileEntry[] = [];
	activeTaskFilterTab: TaskFilterTab = 'core';
	public taskSearchQuery = '';
	public taskSearchInputValue = '';
	public taskSearchInputEl: HTMLInputElement | null = null;
	public taskSearchCountEl: HTMLElement | null = null;
	public isTaskSearchModalOpen = false;
	openedTaskPath: string | null = null;
	openingTaskPath: string | null = null;
	draggingTaskPath: string | null = null;
	dropTargetTaskPath: string | null = null;
	invalidDropTargetTaskPath: string | null = null;
	isRemoveUpTaskDropTarget = false;
	previewLeaf: WorkspaceLeaf | null = null;
	readonly lastOpenedTaskByProject = new Map<string, string>();
	public readonly hoverPreviewParent: { hoverPopover: HoverPopover | null } =
		{
			hoverPopover: null,
		};
	outlinkPopover: TaskOutlinkPopover | null = null;
	taskStatusChecklistPopover: TaskStatusChecklistPopover | null = null;
	public taskSearchModal: TaskSearchModal | null = null;
	readonly pendingOutlinkBadgeUpdates = new Set<string>();
	outlinkBadgeUpdateTimer: number | null = null;
	pendingVaultRefresh = false;
	deferredVaultRefreshTimer: number | null = null;
	loadingRenderTimer: number | null = null;
	deferVaultRefreshForSubtaskCreation = false;
	projectResult: ProjectListResult = {
		status: 'success',
		projects: [],
	};
	public taskResult: TaskFileListResult | null = null;
	isProjectsLoading = false;
	public isTasksLoading = false;
	isCreatingProject = false;
	isCreatingTask = false;
	isUpdatingUpTask = false;
	isCompactLayout = false;
	isNarrowLayout = false;
	public isTaskListHeaderExpanded = false;
	public readonly collapsedTaskGroups = new Set<string>();
	public readonly collapsedProjectGroups = new Set<string>();
	readonly collapsedSubtaskParents = new Set<string>();
	public isBatchEditMode = false;
	readonly selectedTaskPaths = new Set<string>();
	projectListScrollTop = 0;
	taskListScrollTop = 0;
	refreshToken = 0;
	public resizeObserver: ResizeObserver | null = null;
	readonly getTasksRootPath: () => string;
	readonly getProjectListSortMode: () => ProjectListSortMode;
	readonly getProjectListGroupMode: () => ProjectListGroupMode;
	readonly getTaskListSortMode: () => TaskListSortMode;
	readonly getTaskListGroupMode: () => TaskListGroupMode;
	readonly getTaskListTimeFilter: () => TaskListTimeFilter;
	readonly updateTaskListTimeFilter: (
		filter: TaskListTimeFilter,
	) => Promise<void>;
	readonly getShowTaskHierarchy: () => boolean;
	readonly getShowTaskPriority: () => boolean;
	readonly getColorTaskTitleByPriority: () => boolean;
	readonly getInputRootPath: () => string;
	readonly getOutputRootPath: () => string;
	readonly getOutcomeRootPath: () => string;
	readonly getShowTaskSubtaskCount: () => boolean;
	readonly getTaskLinkBadgeBackgroundMode: () => TaskLinkBadgeBackgroundMode;
	readonly getShowTaskOutlinkCounts: () => boolean;
	readonly getShowTaskInputOutlinkCount: () => boolean;
	readonly getShowTaskOutputOutlinkCount: () => boolean;
	readonly getShowTaskOutcomeOutlinkCount: () => boolean;
	readonly getHiddenProjectNames: () => string[];
	readonly getEnabledTaskCreationTypes: () => TaskCreationType[];
	readonly updateProjectListSortMode: (
		sortMode: ProjectListSortMode,
	) => Promise<void>;
	readonly updateProjectListGroupMode: (
		groupMode: ProjectListGroupMode,
	) => Promise<void>;
	readonly updateTaskListSortMode: (
		sortMode: TaskListSortMode,
	) => Promise<void>;
	readonly updateTaskListGroupMode: (
		groupMode: TaskListGroupMode,
	) => Promise<void>;
	readonly updateShowTaskHierarchy: (show: boolean) => Promise<void>;
	readonly updateShowTaskPriority: (show: boolean) => Promise<void>;
	readonly getTaskTemplateConfig: (
		type: TaskCreationType,
	) => TaskTemplateConfig;
	readonly getDateTaskDateFormat: () => string;
	readonly setProjectHidden: (
		projectName: string,
		hidden: boolean,
	) => Promise<void>;
	readonly getBatchTemplateConfig: () => BatchTemplateConfig;
	readonly getTaskSearchEntryMode: () => TaskSearchEntryMode;
	readonly getUseIOTOTaskViewAsDefault: () => boolean;
	public readonly taskSearchSession = createTaskSearchSession();
	public taskFilterCountsCache: {
		key: string;
		counts: Record<TaskFilterTab, number>;
	} | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		getTasksRootPath: () => string,
		getProjectListSortMode: () => ProjectListSortMode,
		getProjectListGroupMode: () => ProjectListGroupMode,
		getTaskListSortMode: () => TaskListSortMode,
		getTaskListGroupMode: () => TaskListGroupMode,
		getShowTaskHierarchy: () => boolean,
		getShowTaskPriority: () => boolean,
		getColorTaskTitleByPriority: () => boolean,
		getInputRootPath: () => string,
		getOutputRootPath: () => string,
		getOutcomeRootPath: () => string,
		getShowTaskSubtaskCount: () => boolean,
		getTaskLinkBadgeBackgroundMode: () => TaskLinkBadgeBackgroundMode,
		getShowTaskOutlinkCounts: () => boolean,
		getShowTaskInputOutlinkCount: () => boolean,
		getShowTaskOutputOutlinkCount: () => boolean,
		getShowTaskOutcomeOutlinkCount: () => boolean,
		getHiddenProjectNames: () => string[],
		getEnabledTaskCreationTypes: () => TaskCreationType[],
		updateProjectListSortMode: (
			sortMode: ProjectListSortMode,
		) => Promise<void>,
		updateProjectListGroupMode: (
			groupMode: ProjectListGroupMode,
		) => Promise<void>,
		updateTaskListSortMode: (sortMode: TaskListSortMode) => Promise<void>,
		updateTaskListGroupMode: (
			groupMode: TaskListGroupMode,
		) => Promise<void>,
		updateShowTaskHierarchy: (show: boolean) => Promise<void>,
		updateShowTaskPriority: (show: boolean) => Promise<void>,
		getTaskListTimeFilter: () => TaskListTimeFilter,
		updateTaskListTimeFilter: (filter: TaskListTimeFilter) => Promise<void>,
		getTaskTemplateConfig: (type: TaskCreationType) => TaskTemplateConfig,
		getDateTaskDateFormat: () => string,
		setProjectHidden: (
			projectName: string,
			hidden: boolean,
		) => Promise<void>,
		getBatchTemplateConfig: () => BatchTemplateConfig,
		getTaskSearchEntryMode: () => TaskSearchEntryMode,
		getUseIOTOTaskViewAsDefault: () => boolean,
	) {
		super(leaf);
		this.navigation = true;
		this.getTasksRootPath = getTasksRootPath;
		this.getProjectListSortMode = getProjectListSortMode;
		this.getProjectListGroupMode = getProjectListGroupMode;
		this.getTaskListSortMode = getTaskListSortMode;
		this.getTaskListGroupMode = getTaskListGroupMode;
		this.getShowTaskHierarchy = getShowTaskHierarchy;
		this.getShowTaskPriority = getShowTaskPriority;
		this.getColorTaskTitleByPriority = getColorTaskTitleByPriority;
		this.getInputRootPath = getInputRootPath;
		this.getOutputRootPath = getOutputRootPath;
		this.getOutcomeRootPath = getOutcomeRootPath;
		this.getShowTaskSubtaskCount = getShowTaskSubtaskCount;
		this.getTaskLinkBadgeBackgroundMode = getTaskLinkBadgeBackgroundMode;
		this.getShowTaskOutlinkCounts = getShowTaskOutlinkCounts;
		this.getShowTaskInputOutlinkCount = getShowTaskInputOutlinkCount;
		this.getShowTaskOutputOutlinkCount = getShowTaskOutputOutlinkCount;
		this.getShowTaskOutcomeOutlinkCount = getShowTaskOutcomeOutlinkCount;
		this.getHiddenProjectNames = getHiddenProjectNames;
		this.getEnabledTaskCreationTypes = getEnabledTaskCreationTypes;
		this.updateProjectListSortMode = updateProjectListSortMode;
		this.updateProjectListGroupMode = updateProjectListGroupMode;
		this.updateTaskListSortMode = updateTaskListSortMode;
		this.updateTaskListGroupMode = updateTaskListGroupMode;
		this.updateShowTaskHierarchy = updateShowTaskHierarchy;
		this.updateShowTaskPriority = updateShowTaskPriority;
		this.getTaskListTimeFilter = getTaskListTimeFilter;
		this.updateTaskListTimeFilter = updateTaskListTimeFilter;
		this.getTaskTemplateConfig = getTaskTemplateConfig;
		this.getDateTaskDateFormat = getDateTaskDateFormat;
		this.setProjectHidden = setProjectHidden;
		this.getBatchTemplateConfig = getBatchTemplateConfig;
		this.getTaskSearchEntryMode = getTaskSearchEntryMode;
		this.getUseIOTOTaskViewAsDefault = getUseIOTOTaskViewAsDefault;
	}

	getViewType(): string {
		return IOTO_TASKS_CENTER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('view.title');
	}

	getIcon(): string {
		return 'folder-kanban';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('ioto-tasks-center-view');
		this.outlinkPopover = new TaskOutlinkPopover(
			this.contentEl.ownerDocument,
			this.app.workspace,
		);
		this.taskStatusChecklistPopover = new TaskStatusChecklistPopover(
			this.contentEl.ownerDocument,
		);
		this.taskSearchModal = new TaskSearchModal(this.app);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (!this.getShowTaskOutlinkCounts()) {
					return;
				}

				if (!this.tasks.some((task) => task.path === file.path)) {
					return;
				}

				this.queueOutlinkBadgeUpdate(file.path);
			}),
		);
		this.startResizeObserver();
		await this.refreshFromVaultChange();
	}

	async onClose(): Promise<void> {
		this.outlinkPopover?.destroy();
		this.outlinkPopover = null;
		this.taskStatusChecklistPopover?.destroy();
		this.taskStatusChecklistPopover = null;
		this.isTaskSearchModalOpen = false;
		this.taskSearchModal?.close();
		this.taskSearchModal = null;
		if (this.outlinkBadgeUpdateTimer !== null) {
			window.clearTimeout(this.outlinkBadgeUpdateTimer);
			this.outlinkBadgeUpdateTimer = null;
		}
		this.pendingOutlinkBadgeUpdates.clear();
		this.stopResizeObserver();
		if (this.deferredVaultRefreshTimer !== null) {
			window.clearTimeout(this.deferredVaultRefreshTimer);
			this.deferredVaultRefreshTimer = null;
		}
		if (this.loadingRenderTimer !== null) {
			window.clearTimeout(this.loadingRenderTimer);
			this.loadingRenderTimer = null;
		}
		this.contentEl.empty();
	}

	getState(): Record<string, unknown> {
		return {
			selectedProject: this.selectedProject ?? undefined,
			activeTaskFilterTab: this.activeTaskFilterTab,
			taskSearchQuery: this.taskSearchQuery || undefined,
			taskSearchInputValue: this.taskSearchInputValue || undefined,
			openedTaskPath: this.openedTaskPath ?? undefined,
			previewLeafId: getWorkspaceLeafId(this.previewLeaf) ?? undefined,
			taskListHeaderExpanded: this.isTaskListHeaderExpanded,
		};
	}

	async setState(state: unknown): Promise<void> {
		const viewState = parseViewState(state);
		this.selectedProject = viewState.selectedProject ?? null;
		this.openedTaskPath = viewState.openedTaskPath ?? null;
		this.activeTaskFilterTab = viewState.activeTaskFilterTab ?? 'core';
		this.taskSearchQuery = viewState.taskSearchQuery ?? '';
		this.taskSearchInputValue =
			viewState.taskSearchInputValue ?? this.taskSearchQuery;
		this.previewLeaf =
			(viewState.previewLeafId
				? this.findLeafById(viewState.previewLeafId)
				: null) ?? null;
		this.isTaskListHeaderExpanded =
			viewState.taskListHeaderExpanded ?? false;
		await this.refreshFromVaultChange();
	}

	async refreshFromVaultChange(): Promise<void> {
		return refreshFromVaultChange(this);
	}

	async handleSettingsChange(): Promise<void> {
		await this.refreshFromVaultChange();
	}

	async loadProjects(preferredProject?: string | null): Promise<void> {
		return loadProjects(this, preferredProject);
	}

	async selectProject(
		projectName: string,
		options: {
			resetTaskListScroll?: boolean;
			resetCollapsedSubtasks?: boolean;
		} = {},
	): Promise<void> {
		return selectProject(this, projectName, options);
	}

	async loadTasks(projectName: string): Promise<void> {
		return loadTasks(this, projectName);
	}

	/**
	 * 只重算指定项目的未完成角标（不触碰任务列表）。
	 * 用于「改动的不是当前项目」这类定向刷新，避免整库重扫 + 任务列表重载。
	 */
	async refreshProjectIncompleteCounts(
		projectNames: readonly string[],
	): Promise<void> {
		return refreshProjectIncompleteCountsFn(this, projectNames);
	}

	/**
	 * 延迟渲染 loading 态：加载在 `LOADING_RENDER_DELAY_MS` 内完成时不会产生
	 * 这一次额外的全量 DOM 重建，也避免项目列表闪一下。
	 */
	scheduleLoadingRender(): void {
		if (this.loadingRenderTimer !== null) {
			return;
		}

		this.loadingRenderTimer = window.setTimeout(() => {
			this.loadingRenderTimer = null;
			this.render();
		}, LOADING_RENDER_DELAY_MS);
	}

	cancelLoadingRender(): void {
		if (this.loadingRenderTimer !== null) {
			window.clearTimeout(this.loadingRenderTimer);
			this.loadingRenderTimer = null;
		}
	}

	public render(): void {
		this.outlinkPopover?.close();
		this.taskStatusChecklistPopover?.close();
		this.taskSearchInputEl = null;
		this.taskSearchCountEl = null;
		this.taskFilterCountsCache = null;
		this.projectListScrollTop = captureProjectListScrollTop(
			this.contentEl,
			this.projectListScrollTop,
		);
		this.taskListScrollTop = captureTaskListScrollTop(
			this.contentEl,
			this.taskListScrollTop,
		);
		const root = this.contentEl;
		root.empty();

		const shellEl = root.createDiv({ cls: 'ioto-tasks-center__shell' });
		if (this.isCompactLayout) {
			this.renderCompactProjectSwitcher(shellEl);
		}

		const viewEl = shellEl.createDiv({ cls: 'ioto-tasks-center' });
		if (this.isCompactLayout) {
			viewEl.addClass('ioto-tasks-center--compact');
		}
		const projectsPane = viewEl.createDiv({
			cls: 'ioto-tasks-center__pane ioto-tasks-center__pane--projects',
		});
		const tasksPane = viewEl.createDiv({
			cls: 'ioto-tasks-center__pane ioto-tasks-center__pane--tasks',
		});

		this.renderProjectsPane(projectsPane);
		this.renderTasksPane(tasksPane);
	}

	private renderProjectsPane(container: HTMLElement): void {
		renderProjectsPane(this, container);
	}

	showProjectContextMenu(
		event: MouseEvent,
		project: ProjectFolderEntry,
	): void {
		showProjectContextMenu(this, event, project);
	}

	async openProjectSpecByProject(project: ProjectFolderEntry): Promise<void> {
		return openProjectSpecByProjectFn(this, project);
	}

	async triggerBatchCreateFromTemplate(): Promise<void> {
		return triggerBatchCreateFromTemplate(this);
	}

	private async executeBatchCreate(
		template: BatchTaskTemplate,
		prefix: string,
		suffix: string,
		items: BatchTaskItem[],
	): Promise<void> {
		return executeBatchCreate(this, template, prefix, suffix, items);
	}

	renderTasksPane(container: HTMLElement): void {
		renderTasksPaneFn(this, container);
	}

	isTaskSearchInline(): boolean {
		return this.getTaskSearchEntryMode() === 'inline';
	}

	/**
	 * 移动端判定：手机端宽度必然 ≤ 720，与既有 `isCompactLayout` 一致；
	 * 桌面把面板拖窄时同样缺空间，一起生效更符合"省空间"的初衷。
	 */
	public isMobileTaskListLayout(): boolean {
		return isMobileTaskListLayoutFn(this);
	}

	public toggleTaskListHeaderExpanded(): void {
		toggleTaskListHeaderExpandedFn(this);
	}

	/**
	 * 只切换现有 DOM 的 class 与图标，不触发 `render()`，
	 * 避免滚动位置跳动与搜索框失焦。
	 */
	public applyTaskListHeaderCollapsed(): void {
		applyTaskListHeaderCollapsedFn(this);
	}

	renderTaskSearchRow(container: HTMLElement): void {
		renderTaskSearchRowFn(this, container);
	}

	/**
	 * 只重绘任务列表，不触碰搜索行与 header —— 保证输入过程中焦点与输入法 composition 不中断。
	 */
	public renderTaskListIncremental(): void {
		renderTaskListIncrementalFn(this);
	}

	public setTaskSearchQuery(value: string): void {
		setTaskSearchQueryFn(this, value);
	}

	syncTaskSearchCount(): void {
		syncTaskSearchCountFn(this);
	}

	focusTaskSearch(): void {
		focusTaskSearchFn(this);
	}

	focusFirstTaskRow(): void {
		focusFirstTaskRowFn(this);
	}

	getTaskSearchSummary(): { matched: number; total: number } | null {
		return getTaskSearchSummaryFn(this);
	}

	getTaskSearchHit(taskPath: string): TaskSearchHit | null {
		return getTaskSearchHitFn(this, taskPath);
	}

	public applyTaskSearch(tasks: TaskFileEntry[]): TaskFileEntry[] {
		return applyTaskSearchFn(this, tasks);
	}

	public getTaskFilterCounts(): Record<TaskFilterTab, number> {
		return getTaskFilterCountsFn(this);
	}

	public getTaskFilterSwitcherLabel(): string {
		return getTaskFilterSwitcherLabelFn(this);
	}

	renderTaskRows(
		container: HTMLElement,
		tasks: TaskFileEntry[],
		activeTaskPath: string | null,
		directChildTasksByParentPath: ReadonlyMap<
			string,
			TaskFileEntry[]
		> | null,
	): void {
		renderTaskRowsFn(
			this,
			container,
			tasks,
			activeTaskPath,
			directChildTasksByParentPath,
		);
	}

	buildDirectChildTasksForCurrentProject(): Map<string, TaskFileEntry[]> {
		return buildDirectChildTasksForCurrentProjectFn(this);
	}

	bindTaskSubtaskPopover(
		badgeEl: HTMLElement,
		childTasks: TaskFileEntry[],
	): void {
		bindTaskSubtaskPopoverFn(this, badgeEl, childTasks);
	}

	bindTaskOutlinkPopover(
		badgeEl: HTMLElement,
		taskPath: string,
		category: TaskOutlinkCategory,
	): void {
		bindTaskOutlinkPopoverFn(this, badgeEl, taskPath, category);
	}

	bindTaskStatusChecklistPopover(
		badgeEl: HTMLElement,
		task: TaskFileEntry,
	): void {
		bindTaskStatusChecklistPopoverFn(this, badgeEl, task);
	}

	async openOutlinkFileInPreview(file: TFile): Promise<void> {
		return openOutlinkFileInPreviewFn(this, file);
	}

	queueOutlinkBadgeUpdate(taskPath: string): void {
		queueOutlinkBadgeUpdateFn(this, taskPath);
	}

	updateTaskOutlinkBadges(taskPath: string): void {
		updateTaskOutlinkBadgesFn(this, taskPath);
	}

	triggerTaskHoverPreview(
		event: MouseEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		triggerTaskHoverPreviewFn(this, event, task, rowEl);
	}

	shouldDeferVaultRefresh(): boolean {
		return shouldDeferVaultRefreshFn(this);
	}

	scheduleDeferredVaultRefresh(): void {
		scheduleDeferredVaultRefreshFn(this);
	}

	canCreateTask(): boolean {
		return canCreateTask(this);
	}

	canSwitchProjects(): boolean {
		return canSwitchProjectsFn(this);
	}

	public renderCompactProjectSwitcher(container: HTMLElement): void {
		renderCompactProjectSwitcherFn(this, container);
	}

	private canSearchTasks(): boolean {
		return SearchController.canSearchTasks(this);
	}

	shouldShowTaskSearchIcon(): boolean {
		return SearchController.shouldShowTaskSearchIcon(this);
	}

	toggleTaskSearchModal(): void {
		SearchController.toggleTaskSearchModal(this);
	}

	openTaskSearchModal(): void {
		SearchController.openTaskSearchModal(this);
	}

	closeTaskSearchModal(): void {
		SearchController.closeTaskSearchModal(this);
	}

	private applyTaskSearchQuery(): void {
		SearchController.applyTaskSearchQuery(this);
	}

	clearTaskSearch(): void {
		SearchController.clearTaskSearch(this);
	}

	handleTaskDragStart(
		event: DragEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		handleTaskDragStart(this, event, task, rowEl);
	}

	handleTaskDragOver(
		event: DragEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		handleTaskDragOver(this, event, task, rowEl);
	}

	handleTaskDragLeave(
		event: DragEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		handleTaskDragLeave(this, event, task, rowEl);
	}

	async handleTaskDrop(
		event: DragEvent,
		targetTask: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): Promise<void> {
		return handleTaskDrop(this, event, targetTask, rowEl);
	}

	private setCurrentDropTarget(
		taskPath: string,
		invalid: boolean,
		rowEl: HTMLButtonElement,
	): void {
		setCurrentDropTarget(this, taskPath, invalid, rowEl);
	}

	clearTaskDragState(): void {
		clearTaskDragState(this);
	}

	private getTaskRowElements(): HTMLButtonElement[] {
		return getTaskRowElements(this);
	}

	private findTaskRowByPath(taskPath: string): HTMLButtonElement | null {
		return findTaskRowByPath(this, taskPath);
	}

	private async assignDraggedTaskToParent(
		draggedTaskPath: string,
		targetTask: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): Promise<void> {
		await assignDraggedTaskToParent(
			this,
			draggedTaskPath,
			targetTask,
			rowEl,
		);
	}

	handleRemoveUpTaskDragOver(
		event: DragEvent,
		dropZoneEl: HTMLDivElement,
	): void {
		handleRemoveUpTaskDragOver(this, event, dropZoneEl);
	}

	handleRemoveUpTaskDragLeave(
		event: DragEvent,
		dropZoneEl: HTMLDivElement,
	): void {
		handleRemoveUpTaskDragLeave(this, event, dropZoneEl);
	}

	async handleRemoveUpTaskDrop(
		event: DragEvent,
		dropZoneEl: HTMLDivElement,
	): Promise<void> {
		await handleRemoveUpTaskDrop(this, event, dropZoneEl);
	}

	private clearCurrentTaskDropTargetClasses(): void {
		clearCurrentTaskDropTargetClasses(this);
	}

	private async removeDraggedTaskParent(
		draggedTaskPath: string,
	): Promise<void> {
		await removeDraggedTaskParent(this, draggedTaskPath);
	}

	getAddTaskButtonLabel(): string {
		return getAddTaskButtonLabel(this);
	}

	canCreateProject(): boolean {
		return canCreateProjectFn(this);
	}

	getAddProjectButtonLabel(): string {
		return getAddProjectButtonLabelFn(this);
	}

	async handleCreateProject(): Promise<void> {
		return handleCreateProject(this);
	}

	async showTaskCreationMenu(event: MouseEvent): Promise<void> {
		return showTaskCreationMenuFn(this, event);
	}

	private async handleCreateTask(type: TaskCreationType): Promise<void> {
		return handleCreateTask(this, type);
	}

	async handleCreateSubtask(
		parentTask: TaskFileEntry,
		type: TaskCreationType,
	): Promise<void> {
		return handleCreateSubtask(this, parentTask, type);
	}

	private async applyCreatedTaskSettings(
		file: TFile,
		settings: { priority: TaskPriorityValue | null; starred: boolean },
	): Promise<void> {
		return applyCreatedTaskSettings(this, file, settings);
	}

	clearDeferredVaultRefreshState(): void {
		clearDeferredVaultRefreshStateFn(this);
	}

	public startResizeObserver(): void {
		startResizeObserverFn(this);
	}

	public stopResizeObserver(): void {
		stopResizeObserverFn(this);
	}

	renderTaskTabs(container: HTMLElement): void {
		renderTaskTabsFn(this, container);
	}

	getTasksForActiveTab(): TaskFileEntry[] {
		return getTasksForActiveTabFn(this);
	}

	getVisibleTasks(): TaskFileEntry[] {
		return getVisibleTasksFn(this);
	}

	getTaskPresentationSections(tasks: TaskFileEntry[]) {
		return getTaskPresentationSectionsFn(this, tasks);
	}

	isTaskGroupCollapsed(sectionKey: string): boolean {
		return isTaskGroupCollapsedFn(this, sectionKey);
	}

	isProjectGroupCollapsed(groupKey: string): boolean {
		return isProjectGroupCollapsedFn(this, groupKey);
	}

	toggleTaskGroupCollapsed(sectionKey: string): void {
		toggleTaskGroupCollapsedFn(this, sectionKey);
	}

	toggleProjectGroupCollapsed(groupKey: string): void {
		toggleProjectGroupCollapsedFn(this, groupKey);
	}

	isSubtasksCollapsed(taskPath: string): boolean {
		return isSubtasksCollapsedFn(this, taskPath);
	}

	toggleSubtasksCollapsed(taskPath: string): void {
		toggleSubtasksCollapsedFn(this, taskPath);
	}

	toggleBatchEditMode(): void {
		toggleBatchEditModeFn(this);
	}

	toggleTaskSelected(taskPath: string): void {
		toggleTaskSelectedFn(this, taskPath);
	}

	getSelectedTasks(): TaskFileEntry[] {
		return getSelectedTasksFn(this);
	}

	selectAllVisibleTasks(): void {
		selectAllVisibleTasksFn(this);
	}

	clearSelection(): void {
		clearSelectionFn(this);
	}

	syncCollapsedTaskGroups(
		sections: Array<{ key: string; label: string | null }>,
	): void {
		syncCollapsedTaskGroupsFn(this, sections);
	}

	syncCollapsedProjectGroups(sections: Array<{ groupKey: string }>): void {
		syncCollapsedProjectGroupsFn(this, sections);
	}

	getTaskListDescription(): string {
		return getTaskListDescriptionFn(this);
	}

	showProjectPresentationMenu(event: MouseEvent): void {
		showProjectPresentationMenu(this, event);
	}

	public showTaskPresentationMenu(event: MouseEvent): void {
		showTaskPresentationMenu(this, event);
	}

	showTaskPriorityMenu(event: MouseEvent, task: TaskFileEntry): void {
		showTaskPriorityMenu(this, event, task);
	}

	showTaskSubtaskTypeMenu(
		event: MouseEvent,
		parentTask: TaskFileEntry,
		enabledTypes: TaskCreationType[],
	): void {
		showTaskSubtaskTypeMenu(this, event, parentTask, enabledTypes);
	}

	renderTaskFilterEmptyState(container: HTMLElement): void {
		renderTaskFilterEmptyStateFn(this, container);
	}

	renderTaskSearchEmptyState(container: HTMLElement): void {
		renderTaskSearchEmptyStateFn(this, container);
	}

	renderState(
		container: HTMLElement,
		title: string,
		description: string,
		stateClass: 'is-empty' | 'is-loading',
	): void {
		renderStateFn(this, container, title, description, stateClass);
	}

	private getCachedTaskPath(projectName: string): string | null {
		return getCachedTaskPath(this, projectName);
	}

	async openTaskFile(
		task: TaskFileEntry,
		options?: {
			target?: TaskOpenTarget;
		},
	): Promise<void> {
		return openTaskFileFn(this, task, options);
	}

	async openTaskFileAtChecklist(
		taskPath: string,
		item: IncompleteChecklistItem,
	): Promise<void> {
		return openTaskFileAtChecklistFn(this, taskPath, item);
	}

	async updateTaskPriority(
		task: TaskFileEntry,
		priority: TaskPriorityValue,
	): Promise<void> {
		return updateTaskPriority(this, task, priority);
	}

	async clearTaskPriority(task: TaskFileEntry): Promise<void> {
		return clearTaskPriority(this, task);
	}

	async updateTaskStarred(task: TaskFileEntry): Promise<void> {
		return updateTaskStarred(this, task);
	}

	async clearTaskStarred(task: TaskFileEntry): Promise<void> {
		return clearTaskStarred(this, task);
	}

	async confirmAndDeleteTask(task: TaskFileEntry): Promise<void> {
		return confirmAndDeleteTask(this, task);
	}

	async openFileInPreview(
		file: TFile,
		options?: { cursorOffset?: number | null },
	): Promise<void> {
		return openFileInPreviewFn(this, file, options);
	}

	getActiveTaskPath(): string | null {
		return getActiveTaskPathFn(this);
	}

	getPreviewLeafFilePath(): string | null {
		return getPreviewLeafFilePathFn(this);
	}

	public activatePreviewLeaf(): void {
		activatePreviewLeafFn(this);
	}

	ensurePreviewLeaf(): WorkspaceLeaf {
		return ensurePreviewLeafFn(this);
	}

	isLeafAvailable(targetLeaf: WorkspaceLeaf): boolean {
		return isLeafAvailable(this, targetLeaf);
	}

	findReusablePreviewLeaf(): WorkspaceLeaf | null {
		return findReusablePreviewLeafFn(this);
	}

	findLeafByFilePath(filePath: string): WorkspaceLeaf | null {
		return findLeafByFilePath(this, filePath);
	}

	private findLeafById(leafId: string): WorkspaceLeaf | null {
		return findLeafById(this, leafId);
	}
}
