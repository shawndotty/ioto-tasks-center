import {
	type HoverPopover,
	ItemView,
	MarkdownView,
	Menu,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';

import { PROJECT_METADATA_FILE_NAME } from '../tasks-center/project-metadata';

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
} from '../settings';
import {
	getTaskListGroupModeOptions,
	getTaskListSortModeOptions,
	getTaskListTimeFilterOptions,
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
import { TaskSearchPopover } from '../ui/task-search-popover';
import { shouldSkipOpeningTask } from './task-preview-state';
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
import {
	getTaskFilterCounts,
	getTaskFilterTabs,
	matchesTaskFilterTab,
	type TaskFilterTab,
} from './task-filter-tabs';
import * as SearchController from './tasks-center/search-controller';
import { filterTasksByTime } from './tasks-center/task-time-filter';
import {
	refreshFromVaultChange,
	loadProjects,
	loadTasks,
	getCachedTaskPath,
	selectProject,
} from './tasks-center/data-loader';
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
import {
	buildDirectChildTasksByParentPath,
	buildVisibleTaskHierarchy,
} from './task-hierarchy';
import {
	buildTaskHoverPreviewPayload,
	hasActiveTaskHoverPopover,
	shouldTriggerTaskHoverPreview,
} from './task-hover-preview';
import {
	buildTaskPresentationSections,
	sortTasksForPresentation,
} from './task-list-presentation';
import { filterTasksBySearchQuery } from './task-search';
import {
	COMPACT_LAYOUT_BREAKPOINT,
	getWorkspaceLeafId,
	HOVER_PREVIEW_REFRESH_RETRY_MS,
	parseViewState,
} from './tasks-center/constants';
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
import { renderProjectsPane } from './tasks-center/projects-pane-renderer';
import { renderTasksPane as renderTasksPaneFn } from './tasks-center/tasks-pane-renderer';
import { renderTaskRows as renderTaskRowsFn } from './tasks-center/task-row-renderer';
import { toggleSetMember } from './tasks-center/helpers';
import {
	bindTaskSubtaskPopover as bindTaskSubtaskPopoverFn,
	bindTaskOutlinkPopover as bindTaskOutlinkPopoverFn,
	bindTaskStatusChecklistPopover as bindTaskStatusChecklistPopoverFn,
} from './tasks-center/popover-controller';
import {
	queueOutlinkBadgeUpdate as queueOutlinkBadgeUpdateFn,
	updateTaskOutlinkBadges as updateTaskOutlinkBadgesFn,
} from './tasks-center/outlink-badge-sync';

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
	public isTaskSearchPopoverOpen = false;
	public shouldFocusTaskSearchPopover = false;
	openedTaskPath: string | null = null;
	openingTaskPath: string | null = null;
	draggingTaskPath: string | null = null;
	dropTargetTaskPath: string | null = null;
	invalidDropTargetTaskPath: string | null = null;
	isRemoveUpTaskDropTarget = false;
	previewLeaf: WorkspaceLeaf | null = null;
	readonly lastOpenedTaskByProject = new Map<string, string>();
	private readonly hoverPreviewParent: { hoverPopover: HoverPopover | null } =
		{
			hoverPopover: null,
		};
	outlinkPopover: TaskOutlinkPopover | null = null;
	taskStatusChecklistPopover: TaskStatusChecklistPopover | null = null;
	public taskSearchPopover: TaskSearchPopover | null = null;
	readonly pendingOutlinkBadgeUpdates = new Set<string>();
	outlinkBadgeUpdateTimer: number | null = null;
	pendingVaultRefresh = false;
	deferredVaultRefreshTimer: number | null = null;
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
	private isCompactLayout = false;
	private readonly collapsedTaskGroups = new Set<string>();
	private readonly collapsedProjectGroups = new Set<string>();
	readonly collapsedSubtaskParents = new Set<string>();
	projectListScrollTop = 0;
	taskListScrollTop = 0;
	refreshToken = 0;
	private resizeObserver: ResizeObserver | null = null;
	readonly getTasksRootPath: () => string;
	readonly getProjectListSortMode: () => ProjectListSortMode;
	readonly getProjectListGroupMode: () => ProjectListGroupMode;
	readonly getTaskListSortMode: () => TaskListSortMode;
	readonly getTaskListGroupMode: () => TaskListGroupMode;
	readonly getTaskListTimeFilter: () => TaskListTimeFilter;
	readonly updateTaskListTimeFilter: (
		filter: TaskListTimeFilter,
	) => Promise<void>;
	readonly getShowTaskPriority: () => boolean;
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

	constructor(
		leaf: WorkspaceLeaf,
		getTasksRootPath: () => string,
		getProjectListSortMode: () => ProjectListSortMode,
		getProjectListGroupMode: () => ProjectListGroupMode,
		getTaskListSortMode: () => TaskListSortMode,
		getTaskListGroupMode: () => TaskListGroupMode,
		getShowTaskPriority: () => boolean,
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
	) {
		super(leaf);
		this.navigation = true;
		this.getTasksRootPath = getTasksRootPath;
		this.getProjectListSortMode = getProjectListSortMode;
		this.getProjectListGroupMode = getProjectListGroupMode;
		this.getTaskListSortMode = getTaskListSortMode;
		this.getTaskListGroupMode = getTaskListGroupMode;
		this.getShowTaskPriority = getShowTaskPriority;
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
		this.updateShowTaskPriority = updateShowTaskPriority;
		this.getTaskListTimeFilter = getTaskListTimeFilter;
		this.updateTaskListTimeFilter = updateTaskListTimeFilter;
		this.getTaskTemplateConfig = getTaskTemplateConfig;
		this.getDateTaskDateFormat = getDateTaskDateFormat;
		this.setProjectHidden = setProjectHidden;
		this.getBatchTemplateConfig = getBatchTemplateConfig;
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
		this.taskSearchPopover = new TaskSearchPopover(
			this.contentEl.ownerDocument,
		);
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
		this.taskSearchPopover?.destroy();
		this.taskSearchPopover = null;
		this.isTaskSearchPopoverOpen = false;
		this.shouldFocusTaskSearchPopover = false;
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

	public render(): void {
		this.outlinkPopover?.close();
		this.taskStatusChecklistPopover?.close();
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
		const filePath = `${project.path}/${PROJECT_METADATA_FILE_NAME}`;
		const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
		const file =
			abstractFile instanceof TFile
				? abstractFile
				: await this.app.vault.create(
						filePath,
						'---\nIOTOProject:\n---\n',
					);
		const leaf = this.ensurePreviewLeaf();
		await leaf.openFile(file, { active: true });
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
		const orderedTasks = buildVisibleTaskHierarchy(
			sortTasksForPresentation(this.tasks, this.getTaskListSortMode()),
		);
		return buildDirectChildTasksByParentPath(orderedTasks);
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
		const leaf = this.ensurePreviewLeaf();
		await leaf.openFile(file, {
			active: true,
		});
		this.previewLeaf = leaf;
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
		if (!shouldTriggerTaskHoverPreview(event, rowEl)) {
			return;
		}

		this.app.workspace.trigger(
			'hover-link',
			buildTaskHoverPreviewPayload({
				event,
				rowEl,
				taskPath: task.path,
				hoverParent: this.hoverPreviewParent,
			}),
		);
	}

	shouldDeferVaultRefresh(): boolean {
		return (
			hasActiveTaskHoverPopover(this.hoverPreviewParent) ||
			this.deferVaultRefreshForSubtaskCreation
		);
	}

	scheduleDeferredVaultRefresh(): void {
		if (this.deferredVaultRefreshTimer !== null) {
			return;
		}

		this.deferredVaultRefreshTimer = window.setTimeout(() => {
			this.deferredVaultRefreshTimer = null;
			if (!this.pendingVaultRefresh) {
				return;
			}

			if (this.shouldDeferVaultRefresh()) {
				this.scheduleDeferredVaultRefresh();
				return;
			}

			void this.refreshAfterDeferredHoverPreview();
		}, HOVER_PREVIEW_REFRESH_RETRY_MS);
	}

	private async refreshAfterDeferredHoverPreview(): Promise<void> {
		this.pendingVaultRefresh = false;
		if (this.selectedProject) {
			await this.refreshCurrentProjectTasks();
			return;
		}

		await this.refreshFromVaultChange();
	}

	canCreateTask(): boolean {
		return canCreateTask(this);
	}

	canSwitchProjects(): boolean {
		return (
			!this.isProjectsLoading &&
			!this.isTasksLoading &&
			this.projects.length > 0
		);
	}

	private renderCompactProjectSwitcher(container: HTMLElement): void {
		const toolbarEl = container.createDiv({
			cls: 'ioto-tasks-center__compact-toolbar',
		});
		const buttonLabel = this.getProjectSwitcherLabel();
		const projectSwitcherEl = toolbarEl.createEl('button', {
			cls: 'ioto-tasks-center__project-switcher',
			text: buttonLabel,
		});
		projectSwitcherEl.type = 'button';
		projectSwitcherEl.disabled = !this.canSwitchProjects();
		projectSwitcherEl.ariaLabel = buttonLabel;
		projectSwitcherEl.title = buttonLabel;
		projectSwitcherEl.addEventListener('click', (event: MouseEvent) => {
			void this.showProjectSwitcherMenu(event);
		});
	}

	private canSearchTasks(): boolean {
		return SearchController.canSearchTasks(this);
	}

	shouldShowTaskSearchIcon(): boolean {
		return SearchController.shouldShowTaskSearchIcon(this);
	}

	toggleTaskSearchPopover(anchorEl: HTMLElement): void {
		SearchController.toggleTaskSearchPopover(this, anchorEl);
	}

	openTaskSearchPopover(anchorEl: HTMLElement, forceFocus: boolean): void {
		SearchController.openTaskSearchPopover(this, anchorEl, forceFocus);
	}

	closeTaskSearchPopover(): void {
		SearchController.closeTaskSearchPopover(this);
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
		this.pendingVaultRefresh = false;
		if (this.deferredVaultRefreshTimer !== null) {
			window.clearTimeout(this.deferredVaultRefreshTimer);
			this.deferredVaultRefreshTimer = null;
		}
	}

	private getProjectSwitcherLabel(): string {
		if (this.isProjectsLoading) {
			return t('view.projectSwitcher.loadingProjects');
		}

		if (this.isTasksLoading) {
			return t('view.projectSwitcher.loadingTasks');
		}

		if (!this.selectedProject) {
			return t('view.projectSwitcher.default');
		}

		return t('view.projectSwitcher.current', [this.selectedProject]);
	}

	private async showProjectSwitcherMenu(event: MouseEvent): Promise<void> {
		if (!this.canSwitchProjects()) {
			return;
		}

		const menu = new Menu();
		for (const project of this.projects) {
			const isCurrentProject = project.name === this.selectedProject;
			menu.addItem((item) =>
				item
					.setTitle(
						isCurrentProject
							? t('view.projectSwitcher.currentSuffix', [
									project.name,
								])
							: project.name,
					)
					.onClick(() => {
						if (isCurrentProject) {
							return;
						}

						void this.selectProject(project.name);
					}),
			);
		}

		menu.showAtMouseEvent(event);
	}

	private startResizeObserver(): void {
		if (this.resizeObserver || typeof ResizeObserver === 'undefined') {
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
		if (this.isCompactLayout === nextCompactLayout) {
			return;
		}

		this.isCompactLayout = nextCompactLayout;
		if (this.contentEl.isConnected) {
			this.render();
		}
	}

	renderTaskTabs(container: HTMLElement): void {
		const taskFilterTabs = getTaskFilterTabs();
		const tabBarEl = container.createDiv({
			cls: 'ioto-tasks-center__tabs-bar',
		});
		const tabListEl = tabBarEl.createDiv({
			cls: 'ioto-tasks-center__tabs ioto-tasks-center__tabs-list',
		});
		const counts = this.getTaskFilterCounts();

		for (const tab of taskFilterTabs) {
			const tabButtonEl = tabListEl.createEl('button', {
				cls: 'ioto-tasks-center__tab',
			});
			tabButtonEl.type = 'button';
			tabButtonEl.createSpan({
				cls: 'ioto-tasks-center__tab-label',
				text: tab.label,
			});
			tabButtonEl.createSpan({
				cls: 'ioto-tasks-center__tab-count',
				text: `${counts[tab.key]}`,
			});

			if (tab.key === this.activeTaskFilterTab) {
				tabButtonEl.addClass('is-active');
			}

			tabButtonEl.addEventListener('click', () => {
				if (tab.key === this.activeTaskFilterTab) {
					return;
				}

				this.activeTaskFilterTab = tab.key;
				this.render();
			});
		}

		const settingsContainerEl = tabBarEl.createDiv({
			cls: 'ioto-tasks-center__tabs-settings',
		});
		const settingsButtonEl = settingsContainerEl.createEl('button', {
			cls: 'ioto-tasks-center__tab-settings-button',
		});
		settingsButtonEl.type = 'button';
		settingsButtonEl.ariaLabel = t('view.taskListSettings');
		settingsButtonEl.title = t('view.taskListSettings');
		setIcon(settingsButtonEl, 'sliders-horizontal');
		settingsButtonEl.addEventListener('click', (event: MouseEvent) => {
			this.showTaskPresentationMenu(event);
		});
	}

	getTasksForActiveTab(): TaskFileEntry[] {
		return this.tasks.filter((task) =>
			this.matchesTaskFilterTab(task, this.activeTaskFilterTab),
		);
	}

	getVisibleTasks(): TaskFileEntry[] {
		const byTab = this.getTasksForActiveTab();
		const bySearch = filterTasksBySearchQuery(byTab, this.taskSearchQuery);
		return filterTasksByTime(bySearch, this.getTaskListTimeFilter());
	}

	getTaskPresentationSections(tasks: TaskFileEntry[]) {
		return buildTaskPresentationSections(tasks, {
			sortMode: this.getTaskListSortMode(),
			groupMode: this.getTaskListGroupMode(),
		});
	}

	isTaskGroupCollapsed(sectionKey: string): boolean {
		return this.collapsedTaskGroups.has(sectionKey);
	}

	isProjectGroupCollapsed(groupKey: string): boolean {
		return this.collapsedProjectGroups.has(groupKey);
	}

	toggleTaskGroupCollapsed(sectionKey: string): void {
		toggleSetMember(this.collapsedTaskGroups, sectionKey);
		this.render();
	}

	toggleProjectGroupCollapsed(groupKey: string): void {
		toggleSetMember(this.collapsedProjectGroups, groupKey);
		this.render();
	}

	isSubtasksCollapsed(taskPath: string): boolean {
		return this.collapsedSubtaskParents.has(taskPath);
	}

	toggleSubtasksCollapsed(taskPath: string): void {
		toggleSetMember(this.collapsedSubtaskParents, taskPath);
		this.render();
	}

	syncCollapsedTaskGroups(
		sections: Array<{ key: string; label: string | null }>,
	): void {
		const groupMode = this.getTaskListGroupMode();
		if (groupMode === 'none') {
			this.collapsedTaskGroups.clear();
			return;
		}

		const validKeys = new Set(
			sections
				.filter((section) => section.label)
				.map((section) => section.key),
		);
		for (const key of [...this.collapsedTaskGroups]) {
			if (!validKeys.has(key)) {
				this.collapsedTaskGroups.delete(key);
			}
		}
	}

	syncCollapsedProjectGroups(sections: Array<{ groupKey: string }>): void {
		const groupMode = this.getProjectListGroupMode();
		if (groupMode === 'none') {
			this.collapsedProjectGroups.clear();
			return;
		}

		const validKeys = new Set(sections.map((section) => section.groupKey));
		for (const key of [...this.collapsedProjectGroups]) {
			if (!validKeys.has(key)) {
				this.collapsedProjectGroups.delete(key);
			}
		}
	}

	getTaskListDescription(): string {
		const taskListSortModeOptions = getTaskListSortModeOptions();
		const taskListGroupModeOptions = getTaskListGroupModeOptions();
		if (!this.selectedProject) {
			return t('view.description.noneSelected');
		}

		const sortDescription =
			taskListSortModeOptions[this.getTaskListSortMode()];
		const groupMode = this.getTaskListGroupMode();
		const groupDescription =
			groupMode === 'none'
				? ''
				: t('view.description.groupPrefix', [
						taskListGroupModeOptions[groupMode],
					]);
		const priorityDescription = this.getShowTaskPriority()
			? t('view.description.priorityVisible')
			: '';
		const timeFilter = this.getTaskListTimeFilter();
		const timeFilterOpts = getTaskListTimeFilterOptions();
		const timeFilterDescription =
			timeFilter !== 'none'
				? t('view.description.timeFilter', [timeFilterOpts[timeFilter]])
				: '';
		return t('view.description.currentProject', [
			this.selectedProject,
			String(this.tasks.length),
			sortDescription,
			groupDescription,
			priorityDescription,
			timeFilterDescription,
		]);
	}

	private getTaskFilterCounts(): Record<TaskFilterTab, number> {
		return getTaskFilterCounts(this.tasks);
	}

	private matchesTaskFilterTab(
		task: TaskFileEntry,
		tab: TaskFilterTab,
	): boolean {
		return matchesTaskFilterTab(task, tab);
	}

	showProjectPresentationMenu(event: MouseEvent): void {
		showProjectPresentationMenu(this, event);
	}

	private showTaskPresentationMenu(event: MouseEvent): void {
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
		const taskFilterTabs = getTaskFilterTabs();
		const tabLabel =
			taskFilterTabs.find((tab) => tab.key === this.activeTaskFilterTab)
				?.label ?? t('view.label.currentFilter');
		this.renderState(
			container,
			t('view.filter.emptyTitle'),
			t('view.filter.emptyDesc', [tabLabel]),
			'is-empty',
		);
	}

	renderTaskSearchEmptyState(container: HTMLElement): void {
		const keyword = this.taskSearchQuery.trim();
		this.renderState(
			container,
			t('view.search.emptyTitle'),
			t('view.search.emptyDesc', [keyword]),
			'is-empty',
		);
	}

	renderState(
		container: HTMLElement,
		title: string,
		description: string,
		stateClass: 'is-empty' | 'is-loading',
	): void {
		const stateEl = container.createDiv({
			cls: `ioto-tasks-center__state ${stateClass}`,
		});
		stateEl.createDiv({
			cls: 'ioto-tasks-center__state-title',
			text: title,
		});
		stateEl.createDiv({
			cls: 'ioto-tasks-center__state-desc',
			text: description,
		});
	}

	private getCachedTaskPath(projectName: string): string | null {
		return getCachedTaskPath(this, projectName);
	}

	async openTaskFile(task: TaskFileEntry): Promise<void> {
		const previewLeafAvailable = Boolean(
			this.previewLeaf && this.isLeafAvailable(this.previewLeaf),
		);
		const previewedFilePath = this.getPreviewLeafFilePath();
		if (
			shouldSkipOpeningTask({
				targetTaskPath: task.path,
				openedTaskPath: this.openedTaskPath,
				previewLeafAvailable,
				previewedFilePath,
			})
		) {
			this.activatePreviewLeaf();
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			return;
		}

		await this.openFileInPreview(file);
	}

	async openTaskFileAtChecklist(
		taskPath: string,
		item: IncompleteChecklistItem,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(taskPath);
		if (!(file instanceof TFile)) {
			return;
		}

		this.openingTaskPath = file.path;
		this.render();

		try {
			const leaf = this.ensurePreviewLeaf();
			await leaf.setViewState({
				type: 'markdown',
				active: true,
				state: {
					file: file.path,
					mode: 'source',
				},
			});
			this.previewLeaf = leaf;
			this.openedTaskPath = file.path;
			if (this.selectedProject) {
				this.lastOpenedTaskByProject.set(
					this.selectedProject,
					file.path,
				);
			}

			this.app.workspace.setActiveLeaf(leaf, { focus: true });
			const view = leaf.view;
			if (
				!(view instanceof MarkdownView) ||
				view.file?.path !== file.path
			) {
				return;
			}

			const editor = view.editor;
			const lastLine = editor.lastLine();
			const line = Math.max(0, Math.min(item.line, lastLine));
			const lineText = editor.getLine(line);
			const startCh = Math.max(
				0,
				Math.min(item.selectionStartCh, lineText.length),
			);
			const fallbackEndCh = lineText.trimEnd().length;
			const endCh = Math.max(
				startCh,
				Math.min(
					Math.max(item.selectionEndCh, fallbackEndCh),
					lineText.length,
				),
			);

			editor.setSelection({ line, ch: startCh }, { line, ch: endCh });
			editor.focus();
		} catch {
			await this.openFileInPreview(file);
		} finally {
			this.openingTaskPath = null;
			this.render();
		}
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

	private async refreshCurrentProjectTasks(): Promise<void> {
		if (!this.selectedProject) {
			return;
		}

		this.isTasksLoading = true;
		this.render();
		await this.loadTasks(this.selectedProject);
	}

	async openFileInPreview(file: TFile): Promise<void> {
		this.openingTaskPath = file.path;
		this.render();

		try {
			const leaf = this.ensurePreviewLeaf();
			const query = this.taskSearchQuery.trim();
			if (query) {
				await leaf.setViewState({
					type: 'markdown',
					active: true,
					state: {
						file: file.path,
						mode: 'source',
					},
				});
			} else {
				await leaf.openFile(file, {
					active: true,
				});
			}
			this.previewLeaf = leaf;
			this.openedTaskPath = file.path;
			if (this.selectedProject) {
				this.lastOpenedTaskByProject.set(
					this.selectedProject,
					file.path,
				);
			}

			if (query) {
				await this.scrollPreviewToFirstMatch(leaf, file, query);
			}
		} finally {
			this.openingTaskPath = null;
			this.render();
		}
	}

	private async scrollPreviewToFirstMatch(
		leaf: WorkspaceLeaf,
		file: TFile,
		query: string,
	): Promise<void> {
		const view = leaf.view;
		if (!(view instanceof MarkdownView) || view.file?.path !== file.path) {
			return;
		}

		const editor = view.editor;
		const normalizedQuery = query.toLocaleLowerCase();
		const lineCount = editor.lineCount();
		for (let line = 0; line < lineCount; line++) {
			const lineText = editor.getLine(line);
			const ch = lineText.toLocaleLowerCase().indexOf(normalizedQuery);
			if (ch !== -1) {
				const from = { line, ch };
				const to = { line, ch: ch + query.length };
				editor.setSelection(from, to);
				editor.scrollIntoView({ from, to }, true);
				editor.focus();
				return;
			}
		}
	}

	getActiveTaskPath(): string | null {
		return getActiveTaskPathFn(this);
	}

	getPreviewLeafFilePath(): string | null {
		return getPreviewLeafFilePathFn(this);
	}

	private activatePreviewLeaf(): void {
		activatePreviewLeafFn(this);
	}

	ensurePreviewLeaf(): WorkspaceLeaf {
		return ensurePreviewLeafFn(this);
	}

	isLeafAvailable(targetLeaf: WorkspaceLeaf): boolean {
		return isLeafAvailable(this, targetLeaf);
	}

	findReusablePreviewLeaf(): WorkspaceLeaf | null {
		if (this.openedTaskPath) {
			const openedFileLeaf = this.findLeafByFilePath(this.openedTaskPath);
			if (openedFileLeaf && openedFileLeaf !== this.leaf) {
				return openedFileLeaf;
			}
		}

		return null;
	}

	findLeafByFilePath(filePath: string): WorkspaceLeaf | null {
		return findLeafByFilePath(this, filePath);
	}

	private findLeafById(leafId: string): WorkspaceLeaf | null {
		return findLeafById(this, leafId);
	}
}
