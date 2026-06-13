import {
	FileView,
	type HoverPopover,
	ItemView,
	Menu,
	Notice,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';

import { listProjectFolders, listProjectTaskFiles } from '../tasks-center/data';
import { createProjectFolder } from '../tasks-center/project-creation';
import {
	filterHiddenProjectEntries,
	sortProjectEntries,
} from '../tasks-center/project-sort';
import {
	getProjectMetadataFile,
	readProjectMetadataFromFrontmatter,
} from '../tasks-center/project-metadata';
import { createTaskFile } from '../tasks-center/task-creation';
import {
	countTaskOutlinksByRootPaths,
	groupTaskOutlinksByRootPaths,
} from '../tasks-center/task-outlink-counts';
import {
	clearTaskFilePriority,
	setTaskFilePriority,
	TASK_PRIORITY_VALUES,
	type TaskPriorityValue,
} from '../tasks-center/task-priority';
import { trashTaskFile } from '../tasks-center/task-deletion';
import {
	clearTaskFileStarred,
	setTaskFileStarred,
} from '../tasks-center/task-starred';
import {
	assignUpTaskToFile,
	removeUpTaskFromFile,
} from '../tasks-center/up-task-assignment';
import type {
	TaskCreationType,
	TaskTemplateConfig,
} from '../tasks-center/task-template-config';
import type {
	ProjectListGroupMode,
	ProjectListSortMode,
	TaskListGroupMode,
	TaskListSortMode,
} from '../settings';
import {
	getProjectListGroupModeOptions,
	getProjectListSortModeOptions,
	getTaskListGroupModeOptions,
	getTaskListSortModeOptions,
} from '../settings';
import { t } from '../lang/helpter';
import type {
	ProjectFolderEntry,
	ProjectListResult,
	TaskFileEntry,
	TaskFileListResult,
} from '../tasks-center/types';
import {
	TaskOutlinkPopover,
	type TaskOutlinkCategory,
	type TaskOutlinkPopoverItem,
} from '../ui/task-outlink-popover';
import { ConfirmModal } from '../ui/confirmModal';
import { TaskSearchPopover } from '../ui/task-search-popover';
import { TaskNameModal } from '../ui/taskNameModal';
import {
	resolveActiveTaskPath,
	shouldSkipOpeningTask,
} from './task-preview-state';
import { validateTaskParentDrop } from './task-drag';
import {
	getTaskFilterCounts,
	getTaskFilterTabs,
	isTaskFilterTab,
	matchesTaskFilterTab,
	type TaskFilterTab,
} from './task-filter-tabs';
import { buildProjectListSections } from './project-list-group';
import {
	captureProjectListScrollTop,
	restoreProjectListScrollTop,
} from './project-list-scroll';
import {
	captureTaskListScrollTop,
	restoreTaskListScrollTop,
	TASK_LIST_SELECTOR,
} from './task-list-scroll';
import { buildVisibleTaskHierarchy } from './task-hierarchy';
import {
	buildTaskHoverPreviewPayload,
	hasActiveTaskHoverPopover,
	shouldTriggerTaskHoverPreview,
} from './task-hover-preview';
import { buildTaskPresentationSections } from './task-list-presentation';
import { filterTasksBySearchQuery } from './task-search';
import { resolveCurrentTaskContext } from '../tasks-center/selected-text-subtask';

export const IOTO_TASKS_CENTER_VIEW_TYPE = 'IOTOTasksCenter';
const COMPACT_LAYOUT_BREAKPOINT = 720;
const HOVER_PREVIEW_REFRESH_RETRY_MS = 150;
interface IOTOTasksCenterViewState {
	selectedProject?: string;
	activeTaskFilterTab?: TaskFilterTab;
	taskSearchQuery?: string;
	taskSearchInputValue?: string;
	openedTaskPath?: string;
	previewLeafId?: string;
}

export class IOTOTasksCenterView extends ItemView {
	private projects: ProjectFolderEntry[] = [];
	private projectIncompleteCounts = new Map<string, number>();
	private projectCategoryByName = new Map<string, string>();
	private selectedProject: string | null = null;
	private tasks: TaskFileEntry[] = [];
	private activeTaskFilterTab: TaskFilterTab = 'core';
	private taskSearchQuery = '';
	private taskSearchInputValue = '';
	private isTaskSearchPopoverOpen = false;
	private shouldFocusTaskSearchPopover = false;
	private openedTaskPath: string | null = null;
	private openingTaskPath: string | null = null;
	private draggingTaskPath: string | null = null;
	private dropTargetTaskPath: string | null = null;
	private invalidDropTargetTaskPath: string | null = null;
	private isRemoveUpTaskDropTarget = false;
	private previewLeaf: WorkspaceLeaf | null = null;
	private readonly lastOpenedTaskByProject = new Map<string, string>();
	private readonly hoverPreviewParent: { hoverPopover: HoverPopover | null } =
		{
			hoverPopover: null,
		};
	private outlinkPopover: TaskOutlinkPopover | null = null;
	private taskSearchPopover: TaskSearchPopover | null = null;
	private readonly pendingOutlinkBadgeUpdates = new Set<string>();
	private outlinkBadgeUpdateTimer: number | null = null;
	private pendingVaultRefresh = false;
	private deferredVaultRefreshTimer: number | null = null;
	private deferVaultRefreshForSubtaskCreation = false;
	private projectResult: ProjectListResult = {
		status: 'success',
		projects: [],
	};
	private taskResult: TaskFileListResult | null = null;
	private isProjectsLoading = false;
	private isTasksLoading = false;
	private isCreatingProject = false;
	private isCreatingTask = false;
	private isUpdatingUpTask = false;
	private isCompactLayout = false;
	private readonly collapsedTaskGroups = new Set<string>();
	private readonly collapsedProjectGroups = new Set<string>();
	private readonly collapsedSubtaskParents = new Set<string>();
	private projectListScrollTop = 0;
	private taskListScrollTop = 0;
	private refreshToken = 0;
	private resizeObserver: ResizeObserver | null = null;
	private readonly getTasksRootPath: () => string;
	private readonly getProjectListSortMode: () => ProjectListSortMode;
	private readonly getProjectListGroupMode: () => ProjectListGroupMode;
	private readonly getTaskListSortMode: () => TaskListSortMode;
	private readonly getTaskListGroupMode: () => TaskListGroupMode;
	private readonly getShowTaskPriority: () => boolean;
	private readonly getInputRootPath: () => string;
	private readonly getOutputRootPath: () => string;
	private readonly getOutcomeRootPath: () => string;
	private readonly getShowTaskOutlinkCounts: () => boolean;
	private readonly getShowTaskInputOutlinkCount: () => boolean;
	private readonly getShowTaskOutputOutlinkCount: () => boolean;
	private readonly getShowTaskOutcomeOutlinkCount: () => boolean;
	private readonly getHiddenProjectNames: () => string[];
	private readonly getEnabledTaskCreationTypes: () => TaskCreationType[];
	private readonly updateProjectListSortMode: (
		sortMode: ProjectListSortMode,
	) => Promise<void>;
	private readonly updateProjectListGroupMode: (
		groupMode: ProjectListGroupMode,
	) => Promise<void>;
	private readonly updateTaskListSortMode: (
		sortMode: TaskListSortMode,
	) => Promise<void>;
	private readonly updateTaskListGroupMode: (
		groupMode: TaskListGroupMode,
	) => Promise<void>;
	private readonly updateShowTaskPriority: (show: boolean) => Promise<void>;
	private readonly getTaskTemplateConfig: (
		type: TaskCreationType,
	) => TaskTemplateConfig;
	private readonly getDateTaskDateFormat: () => string;

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
		getTaskTemplateConfig: (type: TaskCreationType) => TaskTemplateConfig,
		getDateTaskDateFormat: () => string,
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
		this.getTaskTemplateConfig = getTaskTemplateConfig;
		this.getDateTaskDateFormat = getDateTaskDateFormat;
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
		this.outlinkPopover?.close();
		if (this.shouldDeferVaultRefresh()) {
			this.pendingVaultRefresh = true;
			this.scheduleDeferredVaultRefresh();
			return;
		}

		this.pendingVaultRefresh = false;
		if (this.deferredVaultRefreshTimer !== null) {
			window.clearTimeout(this.deferredVaultRefreshTimer);
			this.deferredVaultRefreshTimer = null;
		}

		const previousSelection = this.selectedProject;
		await this.loadProjects(previousSelection);
	}

	async handleSettingsChange(): Promise<void> {
		await this.refreshFromVaultChange();
	}

	private async loadProjects(
		preferredProject?: string | null,
	): Promise<void> {
		const token = ++this.refreshToken;
		this.isProjectsLoading = true;
		this.render();

		const result = listProjectFolders(this.app, this.getTasksRootPath());
		if (token !== this.refreshToken) {
			return;
		}

		this.projectResult = result;
		this.projects = filterHiddenProjectEntries(
			result.projects,
			this.getHiddenProjectNames(),
		);
		this.projectIncompleteCounts = await this.buildProjectIncompleteCounts(
			result.projects,
		);
		this.applyProjectSorting();
		this.projectCategoryByName = this.buildProjectCategoryByName(
			this.projects,
		);
		this.isProjectsLoading = false;

		if (result.status !== 'success' || this.projects.length === 0) {
			this.selectedProject = null;
			this.taskResult = null;
			this.tasks = [];
			this.isTasksLoading = false;
			this.render();
			return;
		}

		const nextProject = this.resolveSelectedProject(preferredProject);
		const shouldPreserveTaskListState =
			nextProject === this.selectedProject;
		await this.selectProject(nextProject, {
			resetTaskListScroll: !shouldPreserveTaskListState,
			resetCollapsedSubtasks: !shouldPreserveTaskListState,
		});
	}

	private resolveSelectedProject(preferredProject?: string | null): string {
		if (
			preferredProject &&
			this.projects.some((project) => project.name === preferredProject)
		) {
			return preferredProject;
		}

		const fallbackProject = this.projects[0];
		if (!fallbackProject) {
			throw new Error('No project is available for selection.');
		}

		return fallbackProject.name;
	}

	private async selectProject(
		projectName: string,
		options: {
			resetTaskListScroll?: boolean;
			resetCollapsedSubtasks?: boolean;
		} = {},
	): Promise<void> {
		const { resetTaskListScroll = true, resetCollapsedSubtasks = true } =
			options;
		this.selectedProject = projectName;
		if (resetTaskListScroll) {
			this.taskListScrollTop = 0;
		}
		if (resetCollapsedSubtasks) {
			this.collapsedSubtaskParents.clear();
		}
		this.isTasksLoading = true;
		this.render();
		await this.loadTasks(projectName);
	}

	private async loadTasks(projectName: string): Promise<void> {
		const token = ++this.refreshToken;
		const result = await listProjectTaskFiles(
			this.app,
			this.getTasksRootPath(),
			projectName,
		);

		if (token !== this.refreshToken) {
			return;
		}

		this.taskResult = result;
		this.tasks = result.tasks;
		this.isTasksLoading = false;
		this.openedTaskPath = this.getCachedTaskPath(projectName);

		if (result.status === 'project-missing') {
			const nextProject = this.resolveSelectedProject(projectName);
			if (nextProject !== projectName) {
				await this.selectProject(nextProject);
				return;
			}
		}

		this.render();
	}

	private render(): void {
		this.outlinkPopover?.close();
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
		const tasksRootPath = this.getTasksRootPath();
		const headerEl = container.createDiv({
			cls: 'ioto-tasks-center__section-header',
		});
		headerEl.createDiv({
			cls: 'ioto-tasks-center__section-title',
			text: t('view.projectsPaneTitle'),
		});
		const actionsEl = headerEl.createDiv({
			cls: 'ioto-tasks-center__section-actions',
		});
		const projectSettingsButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-tasks-center__icon-button',
		});
		projectSettingsButtonEl.type = 'button';
		projectSettingsButtonEl.disabled = this.isProjectsLoading;
		projectSettingsButtonEl.ariaLabel = t('view.projectListSettings');
		projectSettingsButtonEl.title = t('view.projectListSettings');
		setIcon(projectSettingsButtonEl, 'sliders-horizontal');
		projectSettingsButtonEl.addEventListener('click', (event) => {
			this.showProjectPresentationMenu(event);
		});
		const addProjectButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-tasks-center__icon-button',
			text: '+',
		});
		addProjectButtonEl.type = 'button';
		addProjectButtonEl.disabled = !this.canCreateProject();
		addProjectButtonEl.ariaLabel = this.getAddProjectButtonLabel();
		addProjectButtonEl.title = this.getAddProjectButtonLabel();
		addProjectButtonEl.addEventListener('click', () => {
			void this.handleCreateProject();
		});

		const helperText = this.isProjectsLoading
			? `正在扫描 ${tasksRootPath} 根目录...`
			: t('view.projectsPaneDesc');
		container.createDiv({
			cls: 'ioto-tasks-center__section-desc',
			text: helperText,
		});

		const listEl = container.createDiv({
			cls: 'ioto-tasks-center__project-list',
		});
		listEl.addEventListener('scroll', () => {
			this.projectListScrollTop = listEl.scrollTop;
		});

		if (this.isProjectsLoading) {
			this.renderState(
				listEl,
				t('view.state.loadingProjectsTitle'),
				t('view.state.loadingProjectsDesc', [tasksRootPath]),
				'is-loading',
			);
			restoreProjectListScrollTop(listEl, this.projectListScrollTop);
			return;
		}

		if (this.projectResult.status === 'root-missing') {
			this.renderState(
				listEl,
				t('view.state.rootMissingTitle'),
				t('view.state.rootMissingDesc', [tasksRootPath]),
				'is-empty',
			);
			restoreProjectListScrollTop(listEl, this.projectListScrollTop);
			return;
		}

		if (this.projects.length === 0) {
			const isFilteredByHiddenProjects =
				this.projectResult.projects.length > 0;
			this.renderState(
				listEl,
				isFilteredByHiddenProjects
					? t('view.state.noVisibleProjectsTitle')
					: t('view.state.noProjectsTitle'),
				isFilteredByHiddenProjects
					? t('view.state.noVisibleProjectsDesc')
					: t('view.state.noProjectsDesc', [tasksRootPath]),
				'is-empty',
			);
			restoreProjectListScrollTop(listEl, this.projectListScrollTop);
			return;
		}

		const groupMode = this.getProjectListGroupMode();
		const sortMode = this.getProjectListSortMode();
		const sections = buildProjectListSections(
			this.projects,
			this.projectIncompleteCounts,
			this.projectCategoryByName,
			sortMode,
			groupMode,
		);
		this.syncCollapsedProjectGroups(sections);

		for (const section of sections) {
			const groupKey = section.groupKey;
			const groupLabel =
				groupKey.length > 0
					? groupKey
					: t('project.group.uncategorized');
			const groupEl = listEl.createDiv({
				cls: 'ioto-tasks-center__project-group',
			});

			const collapsed =
				groupMode === 'category' &&
				this.isProjectGroupCollapsed(groupKey);
			groupEl.toggleClass('is-collapsed', collapsed);
			groupEl.toggleClass('is-expanded', !collapsed);

			const groupBodyId = buildProjectGroupBodyId(groupKey);
			let groupBodyEl: HTMLElement;
			if (groupMode === 'category') {
				const groupHeaderEl = groupEl.createEl('button', {
					cls: 'ioto-tasks-center__project-group-header',
				});
				groupHeaderEl.type = 'button';
				groupHeaderEl.ariaLabel = collapsed
					? t('view.group.expand', [groupLabel])
					: t('view.group.collapse', [groupLabel]);
				groupHeaderEl.title = groupHeaderEl.ariaLabel;
				groupHeaderEl.setAttribute(
					'aria-expanded',
					collapsed ? 'false' : 'true',
				);
				groupHeaderEl.setAttribute('aria-controls', groupBodyId);

				const iconEl = groupHeaderEl.createSpan({
					cls: 'ioto-tasks-center__project-group-header-icon',
				});
				setIcon(iconEl, 'chevron-right');
				groupHeaderEl.createSpan({
					cls: 'ioto-tasks-center__project-group-header-label',
					text: groupLabel,
				});
				groupHeaderEl.createSpan({
					cls: 'ioto-tasks-center__project-group-header-count',
					text: `${section.projects.length}`,
				});
				groupHeaderEl.addEventListener('click', () => {
					this.toggleProjectGroupCollapsed(groupKey);
				});

				groupBodyEl = groupEl.createDiv({
					cls: 'ioto-tasks-center__project-group-body',
				});
				groupBodyEl.id = groupBodyId;
				groupBodyEl.toggleClass('is-hidden', collapsed);
				if (collapsed) {
					continue;
				}
			} else {
				groupBodyEl = groupEl.createDiv({
					cls: 'ioto-tasks-center__project-group-body',
				});
			}

			for (const project of section.projects) {
				const incompleteCount =
					this.projectIncompleteCounts.get(project.name) ?? 0;
				const itemEl = groupBodyEl.createEl('button', {
					cls: 'ioto-tasks-center__project-item',
				});
				itemEl.type = 'button';
				itemEl.createSpan({
					cls: 'ioto-tasks-center__project-name',
					text: project.name,
				});
				if (incompleteCount > 0) {
					itemEl.createSpan({
						cls: 'ioto-tasks-center__project-count',
						text: `${incompleteCount}`,
					});
				}

				if (project.name === this.selectedProject) {
					itemEl.addClass('is-selected');
				}

				itemEl.addEventListener('click', () => {
					if (
						project.name === this.selectedProject ||
						this.isTasksLoading
					) {
						return;
					}

					void this.selectProject(project.name);
				});
			}
		}

		restoreProjectListScrollTop(listEl, this.projectListScrollTop);
	}

	private renderTasksPane(container: HTMLElement): void {
		const tasksRootPath = this.getTasksRootPath();
		const headerEl = container.createDiv({
			cls: 'ioto-tasks-center__section-header',
		});
		headerEl.createDiv({
			cls: 'ioto-tasks-center__section-title',
			text: t('view.tasksPaneTitle'),
		});
		const actionsEl = headerEl.createDiv({
			cls: 'ioto-tasks-center__section-actions',
		});
		const shouldShowSearchIcon = this.shouldShowTaskSearchIcon();
		let searchToggleButtonEl: HTMLButtonElement | null = null;
		if (shouldShowSearchIcon) {
			const keyword = this.taskSearchQuery.trim();
			if (!this.isTaskSearchPopoverOpen && keyword) {
				const hintEl = actionsEl.createDiv({
					cls: 'ioto-tasks-center__task-search-hint',
				});
				hintEl.createSpan({
					cls: 'ioto-tasks-center__task-search-hint-text',
					text: keyword,
				});
				const hintClearButtonEl = hintEl.createEl('button', {
					cls: 'ioto-tasks-center__task-search-hint-clear',
					text: 'X',
				});
				hintClearButtonEl.type = 'button';
				hintClearButtonEl.ariaLabel = t('view.search.clear');
				hintClearButtonEl.title = t('view.search.clearShort');
				hintClearButtonEl.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.clearTaskSearch();
				});
			}

			searchToggleButtonEl = actionsEl.createEl('button', {
				cls: 'ioto-tasks-center__icon-button',
			});
			searchToggleButtonEl.type = 'button';
			searchToggleButtonEl.ariaLabel = t('view.search.toggle');
			searchToggleButtonEl.title = t('view.search.toggle');
			setIcon(searchToggleButtonEl, 'search');
			searchToggleButtonEl.addEventListener('click', (event) => {
				const anchorEl = event.currentTarget;
				if (!(anchorEl instanceof HTMLElement)) {
					return;
				}

				this.toggleTaskSearchPopover(anchorEl);
			});
		} else {
			this.closeTaskSearchPopover();
		}
		const addTaskButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-tasks-center__add-task-button',
			text: this.isCreatingTask
				? t('view.tasksPane.addTaskCreating')
				: t('view.tasksPane.addTask'),
		});
		addTaskButtonEl.type = 'button';
		addTaskButtonEl.disabled = !this.canCreateTask();
		addTaskButtonEl.ariaLabel = this.getAddTaskButtonLabel();
		addTaskButtonEl.title = this.getAddTaskButtonLabel();
		addTaskButtonEl.addEventListener('click', (event) => {
			void this.showTaskCreationMenu(event);
		});

		const currentProjectText = this.getTaskListDescription();
		container.createDiv({
			cls: 'ioto-tasks-center__section-desc',
			text: currentProjectText,
		});

		if (shouldShowSearchIcon && this.isTaskSearchPopoverOpen) {
			if (searchToggleButtonEl) {
				this.openTaskSearchPopover(searchToggleButtonEl, false);
			}
		}
		this.renderTaskTabs(container);

		const listEl = container.createDiv({
			cls: 'ioto-tasks-center__task-list',
		});
		listEl.addEventListener('scroll', () => {
			this.taskListScrollTop = listEl.scrollTop;
		});
		listEl.toggleClass(
			'has-remove-up-task-drop-zone',
			Boolean(this.draggingTaskPath),
		);

		if (this.projectResult.status === 'root-missing') {
			this.renderState(
				listEl,
				t('view.state.cannotLoadTasksTitle'),
				t('view.state.cannotLoadTasksDesc', [tasksRootPath]),
				'is-empty',
			);
			restoreTaskListScrollTop(listEl, this.taskListScrollTop);
			return;
		}

		if (!this.selectedProject) {
			this.renderState(
				listEl,
				t('view.state.selectProjectTitle'),
				t('view.state.selectProjectDesc'),
				'is-empty',
			);
			restoreTaskListScrollTop(listEl, this.taskListScrollTop);
			return;
		}

		if (this.isTasksLoading) {
			this.renderState(
				listEl,
				t('view.state.loadingTasksTitle'),
				t('view.state.loadingTasksDesc', [
					tasksRootPath,
					this.selectedProject,
				]),
				'is-loading',
			);
			restoreTaskListScrollTop(listEl, this.taskListScrollTop);
			return;
		}

		if (!this.taskResult) {
			this.renderState(
				listEl,
				t('view.state.noTaskDataTitle'),
				t('view.state.noTaskDataDesc'),
				'is-empty',
			);
			restoreTaskListScrollTop(listEl, this.taskListScrollTop);
			return;
		}

		if (this.taskResult.status === 'project-missing') {
			this.renderState(
				listEl,
				t('view.state.projectMissingTitle'),
				t('view.state.projectMissingDesc', [
					this.taskResult.projectPath,
				]),
				'is-empty',
			);
			restoreTaskListScrollTop(listEl, this.taskListScrollTop);
			return;
		}

		if (this.taskResult.status === 'empty') {
			this.renderState(
				listEl,
				t('view.state.emptyProjectTitle'),
				t('view.state.emptyProjectDesc', [this.taskResult.projectPath]),
				'is-empty',
			);
			restoreTaskListScrollTop(listEl, this.taskListScrollTop);
			return;
		}

		const tabVisibleTasks = this.getTasksForActiveTab();
		const visibleTasks = this.getVisibleTasks();
		if (visibleTasks.length === 0) {
			if (tabVisibleTasks.length === 0) {
				this.renderTaskFilterEmptyState(listEl);
				restoreTaskListScrollTop(listEl, this.taskListScrollTop);
				return;
			}

			this.renderTaskSearchEmptyState(listEl);
			restoreTaskListScrollTop(listEl, this.taskListScrollTop);
			return;
		}
		const presentationSections =
			this.getTaskPresentationSections(visibleTasks);
		this.syncCollapsedTaskGroups(presentationSections);
		const activeTaskPath = this.getActiveTaskPath();
		const removeZoneWrapperEl = listEl.createDiv({
			cls: 'ioto-tasks-center__remove-up-task-drop-zone-wrapper',
		});
		const removeZoneEl = removeZoneWrapperEl.createDiv({
			cls: 'ioto-tasks-center__remove-up-task-drop-zone',
		});
		if (this.isRemoveUpTaskDropTarget) {
			removeZoneEl.addClass('is-drop-target');
		}
		removeZoneEl.setText(t('view.removeParentDropZone'));
		removeZoneEl.addEventListener('dragover', (event) => {
			this.handleRemoveUpTaskDragOver(event, removeZoneEl);
		});
		removeZoneEl.addEventListener('dragleave', (event) => {
			this.handleRemoveUpTaskDragLeave(event, removeZoneEl);
		});
		removeZoneEl.addEventListener('drop', (event) => {
			void this.handleRemoveUpTaskDrop(event, removeZoneEl);
		});

		for (const section of presentationSections) {
			const sectionEl = listEl.createDiv({
				cls: 'ioto-tasks-center__task-group',
			});
			if (!section.label) {
				this.renderTaskRows(
					sectionEl,
					buildVisibleTaskHierarchy(section.tasks),
					activeTaskPath,
				);
				continue;
			}

			const collapsed = this.isTaskGroupCollapsed(section.key);
			sectionEl.toggleClass('is-collapsed', collapsed);
			sectionEl.toggleClass('is-expanded', !collapsed);

			const groupBodyId = `ioto-tasks-center-task-group-${section.key}`;
			const groupHeaderEl = sectionEl.createEl('button', {
				cls: 'ioto-tasks-center__task-group-header',
			});
			groupHeaderEl.type = 'button';
			groupHeaderEl.ariaLabel = collapsed
				? t('view.group.expand', [section.label])
				: t('view.group.collapse', [section.label]);
			groupHeaderEl.title = groupHeaderEl.ariaLabel;
			groupHeaderEl.setAttribute(
				'aria-expanded',
				collapsed ? 'false' : 'true',
			);
			groupHeaderEl.setAttribute('aria-controls', groupBodyId);
			const iconEl = groupHeaderEl.createSpan({
				cls: 'ioto-tasks-center__task-group-header-icon',
			});
			setIcon(iconEl, 'chevron-right');
			groupHeaderEl.createSpan({
				cls: 'ioto-tasks-center__task-group-header-label',
				text: section.label,
			});
			groupHeaderEl.createSpan({
				cls: 'ioto-tasks-center__task-group-header-count',
				text: `${section.tasks.length}`,
			});
			groupHeaderEl.addEventListener('click', () => {
				this.toggleTaskGroupCollapsed(section.key);
			});

			const groupBodyEl = sectionEl.createDiv({
				cls: 'ioto-tasks-center__task-group-body',
			});
			groupBodyEl.id = groupBodyId;
			groupBodyEl.toggleClass('is-hidden', collapsed);
			if (collapsed) {
				continue;
			}

			this.renderTaskRows(
				groupBodyEl,
				buildVisibleTaskHierarchy(section.tasks),
				activeTaskPath,
			);
		}

		restoreTaskListScrollTop(listEl, this.taskListScrollTop);
	}

	private renderTaskRows(
		container: HTMLElement,
		tasks: TaskFileEntry[],
		activeTaskPath: string | null,
	): void {
		const collapsedIndentStack: number[] = [];
		for (let i = 0; i < tasks.length; i++) {
			const task = tasks[i];
			if (!task) {
				continue;
			}
			const indentLevel = task.indentLevel ?? 0;
			while (collapsedIndentStack.length > 0) {
				const topIndent =
					collapsedIndentStack[collapsedIndentStack.length - 1];
				if (topIndent === undefined || indentLevel > topIndent) {
					break;
				}
				collapsedIndentStack.pop();
			}

			if (collapsedIndentStack.length > 0) {
				continue;
			}

			const nextIndentLevel = tasks[i + 1]?.indentLevel ?? 0;
			const hasChildren = nextIndentLevel > indentLevel;
			const subtasksCollapsed = hasChildren
				? this.isSubtasksCollapsed(task.path)
				: false;

			const rowEl = container.createEl('button', {
				cls: 'ioto-tasks-center__task-row',
			});
			rowEl.type = 'button';
			rowEl.draggable = !this.isUpdatingUpTask;
			rowEl.dataset.taskPath = task.path;
			rowEl.style.setProperty(
				'--ioto-task-indent-level',
				`${indentLevel}`,
			);
			if (indentLevel > 0) {
				rowEl.addClass('is-subtask');
			}

			if (task.path === activeTaskPath) {
				rowEl.addClass('is-active');
			}

			if (task.path === this.openingTaskPath) {
				rowEl.addClass('is-opening');
			}

			if (task.path === this.draggingTaskPath) {
				rowEl.addClass('is-dragging');
			}

			if (task.path === this.dropTargetTaskPath) {
				rowEl.addClass('is-drop-target');
			}

			if (task.path === this.invalidDropTargetTaskPath) {
				rowEl.addClass('is-drop-invalid');
			}

			const titleEl = rowEl.createDiv({
				cls: 'ioto-tasks-center__task-title',
			});
			if (hasChildren) {
				const toggleEl = titleEl.createSpan({
					cls: 'ioto-tasks-center__subtask-toggle-icon',
				});
				toggleEl.toggleClass('is-expanded', !subtasksCollapsed);
				toggleEl.ariaLabel = subtasksCollapsed
					? t('view.subtasks.expand')
					: t('view.subtasks.collapse');
				setIcon(toggleEl, 'chevron-right');
				toggleEl.addEventListener('click', (event: MouseEvent) => {
					event.preventDefault();
					event.stopPropagation();
					this.toggleSubtasksCollapsed(task.path);
				});
			}
			titleEl.createSpan({
				cls: 'ioto-tasks-center__task-title-text',
				text: task.title,
			});
			if (this.getShowTaskOutlinkCounts()) {
				const showInput = this.getShowTaskInputOutlinkCount();
				const showOutput = this.getShowTaskOutputOutlinkCount();
				const showOutcome = this.getShowTaskOutcomeOutlinkCount();
				if (showInput || showOutput || showOutcome) {
					const resolvedLinks =
						this.app.metadataCache.resolvedLinks?.[task.path];
					const counts = countTaskOutlinksByRootPaths(resolvedLinks, {
						inputRootPath: this.getInputRootPath(),
						outputRootPath: this.getOutputRootPath(),
						outcomeRootPath: this.getOutcomeRootPath(),
					});
					const countersEl = titleEl.createSpan({
						cls: 'ioto-tasks-center__task-outlink-counts',
					});
					if (showInput) {
						const label = t('task.outlinks.input', [
							String(counts.input),
						]);
						const badgeEl = countersEl.createSpan({
							cls: 'ioto-tasks-center__task-outlink-count',
							text: String(counts.input),
						});
						badgeEl.dataset.outlinkCategory = 'input';
						badgeEl.ariaLabel = label;
						this.bindTaskOutlinkPopover(
							badgeEl,
							task.path,
							'input',
						);
					}
					if (showOutput) {
						const label = t('task.outlinks.output', [
							String(counts.output),
						]);
						const badgeEl = countersEl.createSpan({
							cls: 'ioto-tasks-center__task-outlink-count',
							text: String(counts.output),
						});
						badgeEl.dataset.outlinkCategory = 'output';
						badgeEl.ariaLabel = label;
						this.bindTaskOutlinkPopover(
							badgeEl,
							task.path,
							'output',
						);
					}
					if (showOutcome) {
						const label = t('task.outlinks.outcome', [
							String(counts.outcome),
						]);
						const badgeEl = countersEl.createSpan({
							cls: 'ioto-tasks-center__task-outlink-count',
							text: String(counts.outcome),
						});
						badgeEl.dataset.outlinkCategory = 'outcome';
						badgeEl.ariaLabel = label;
						this.bindTaskOutlinkPopover(
							badgeEl,
							task.path,
							'outcome',
						);
					}
				}
			}
			if (
				this.getShowTaskPriority() &&
				typeof task.priority === 'number'
			) {
				const priorityEl = rowEl.createSpan({
					cls: `ioto-tasks-center__task-priority ${getTaskPriorityClassName(task.priority)}`,
					text: `P${task.priority}`,
				});
				priorityEl.ariaLabel = `优先级：P${task.priority}`;
			}
			if (task.starred) {
				const coreBadgeEl = rowEl.createSpan({
					cls: 'ioto-tasks-center__task-core-badge',
					text: '⭐',
				});
				coreBadgeEl.ariaLabel = t('view.taskCoreBadge.label');
				coreBadgeEl.title = t('view.taskCoreBadge.label');
			}
			const statusEl = rowEl.createSpan({
				cls: `ioto-tasks-center__task-status ioto-tasks-center__task-status--${task.status.key}`,
				text: task.status.label,
			});
			statusEl.ariaLabel = `任务状态：${task.status.label}`;

			rowEl.addEventListener('click', () => {
				void this.openTaskFile(task);
			});
			rowEl.addEventListener('mouseover', (event: MouseEvent) => {
				const target = event.target;
				if (
					target instanceof HTMLElement &&
					target.closest('.ioto-tasks-center__task-outlink-count')
				) {
					return;
				}

				this.triggerTaskHoverPreview(event, task, rowEl);
			});
			rowEl.addEventListener('contextmenu', (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				this.showTaskPriorityMenu(event, task);
			});
			rowEl.addEventListener('dragstart', (event: DragEvent) => {
				this.handleTaskDragStart(event, task, rowEl);
			});
			rowEl.addEventListener('dragover', (event: DragEvent) => {
				this.handleTaskDragOver(event, task, rowEl);
			});
			rowEl.addEventListener('dragleave', (event: DragEvent) => {
				this.handleTaskDragLeave(event, task, rowEl);
			});
			rowEl.addEventListener('drop', (event: DragEvent) => {
				void this.handleTaskDrop(event, task, rowEl);
			});
			rowEl.addEventListener('dragend', () => {
				this.clearTaskDragState();
			});

			if (hasChildren && subtasksCollapsed) {
				collapsedIndentStack.push(indentLevel);
			}
		}
	}

	private bindTaskOutlinkPopover(
		badgeEl: HTMLElement,
		taskPath: string,
		category: TaskOutlinkCategory,
	): void {
		const popover = this.outlinkPopover;
		if (!popover) {
			return;
		}

		badgeEl.addEventListener('mouseenter', (event) => {
			event.stopPropagation();
			const items = this.getTaskOutlinkPopoverItems(taskPath, category);
			popover.open({
				anchorEl: badgeEl,
				categoryTitle: this.getTaskOutlinkPopoverTitle(category),
				emptyText: t('task.outlinks.popover.empty'),
				items,
				onItemClick: (file) => {
					void this.openOutlinkFileInPreview(file);
				},
			});
		});
		badgeEl.addEventListener('mouseleave', (event) => {
			event.stopPropagation();
			popover.scheduleClose();
		});
	}

	private getTaskOutlinkPopoverTitle(category: TaskOutlinkCategory): string {
		switch (category) {
			case 'input':
				return t('task.outlinks.popover.title.input');
			case 'output':
				return t('task.outlinks.popover.title.output');
			case 'outcome':
				return t('task.outlinks.popover.title.outcome');
		}
	}

	private getTaskOutlinkPopoverItems(
		taskPath: string,
		category: TaskOutlinkCategory,
	): TaskOutlinkPopoverItem[] {
		const resolvedLinks = this.app.metadataCache.resolvedLinks?.[taskPath];
		const targets = groupTaskOutlinksByRootPaths(resolvedLinks, {
			inputRootPath: this.getInputRootPath(),
			outputRootPath: this.getOutputRootPath(),
			outcomeRootPath: this.getOutcomeRootPath(),
		});
		const paths = targets[category];

		const items: TaskOutlinkPopoverItem[] = [];
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) {
				continue;
			}

			items.push({
				path,
				title: file.basename,
				file,
			});
		}

		return items.sort((left, right) =>
			left.title.localeCompare(right.title, undefined, { numeric: true }),
		);
	}

	private async openOutlinkFileInPreview(file: TFile): Promise<void> {
		const leaf = this.ensurePreviewLeaf();
		await leaf.openFile(file, {
			active: true,
		});
		this.previewLeaf = leaf;
	}

	private queueOutlinkBadgeUpdate(taskPath: string): void {
		this.pendingOutlinkBadgeUpdates.add(taskPath);
		if (this.outlinkBadgeUpdateTimer !== null) {
			return;
		}

		this.outlinkBadgeUpdateTimer = window.setTimeout(() => {
			this.outlinkBadgeUpdateTimer = null;
			const paths = [...this.pendingOutlinkBadgeUpdates];
			this.pendingOutlinkBadgeUpdates.clear();
			for (const path of paths) {
				this.updateTaskOutlinkBadges(path);
			}
		}, 250);
	}

	private updateTaskOutlinkBadges(taskPath: string): void {
		if (!this.getShowTaskOutlinkCounts()) {
			return;
		}

		const rowEl = this.findTaskRowEl(taskPath);
		if (!rowEl) {
			return;
		}

		const resolvedLinks = this.app.metadataCache.resolvedLinks?.[taskPath];
		const counts = countTaskOutlinksByRootPaths(resolvedLinks, {
			inputRootPath: this.getInputRootPath(),
			outputRootPath: this.getOutputRootPath(),
			outcomeRootPath: this.getOutcomeRootPath(),
		});
		this.updateTaskOutlinkBadge(rowEl, 'input', counts.input);
		this.updateTaskOutlinkBadge(rowEl, 'output', counts.output);
		this.updateTaskOutlinkBadge(rowEl, 'outcome', counts.outcome);
	}

	private updateTaskOutlinkBadge(
		rowEl: HTMLElement,
		category: TaskOutlinkCategory,
		value: number,
	): void {
		const badgeEl = rowEl.querySelector<HTMLElement>(
			`.ioto-tasks-center__task-outlink-count[data-outlink-category="${category}"]`,
		);
		if (!badgeEl) {
			return;
		}

		badgeEl.textContent = String(value);
		const label = this.getTaskOutlinkBadgeLabel(category, value);
		badgeEl.ariaLabel = label;
		badgeEl.removeAttribute('title');
	}

	private getTaskOutlinkBadgeLabel(
		category: TaskOutlinkCategory,
		value: number,
	): string {
		switch (category) {
			case 'input':
				return t('task.outlinks.input', [String(value)]);
			case 'output':
				return t('task.outlinks.output', [String(value)]);
			case 'outcome':
				return t('task.outlinks.outcome', [String(value)]);
		}
	}

	private findTaskRowEl(taskPath: string): HTMLButtonElement | null {
		const escaped = this.escapeCssSelector(taskPath);
		const rowEl = this.contentEl.querySelector(
			`button.ioto-tasks-center__task-row[data-task-path="${escaped}"]`,
		);
		return rowEl instanceof HTMLButtonElement ? rowEl : null;
	}

	private escapeCssSelector(value: string): string {
		if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
			return CSS.escape(value);
		}

		return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
	}

	private triggerTaskHoverPreview(
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

	private shouldDeferVaultRefresh(): boolean {
		return (
			hasActiveTaskHoverPopover(this.hoverPreviewParent) ||
			this.deferVaultRefreshForSubtaskCreation
		);
	}

	private scheduleDeferredVaultRefresh(): void {
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

	private canCreateTask(): boolean {
		return Boolean(
			this.selectedProject &&
			!this.isProjectsLoading &&
			!this.isTasksLoading &&
			!this.isCreatingTask &&
			this.projects.some(
				(project) => project.name === this.selectedProject,
			),
		);
	}

	private canSwitchProjects(): boolean {
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

	private renderTaskSearch(container: HTMLElement): void {
		const searchContainerEl = container.createDiv({
			cls: 'ioto-tasks-center__task-search',
		});
		const searchControlsEl = searchContainerEl.createDiv({
			cls: 'ioto-tasks-center__task-search-controls',
		});
		const searchInputWrapperEl = searchControlsEl.createDiv({
			cls: 'ioto-tasks-center__task-search-input-wrapper',
		});
		const searchInputEl = searchInputWrapperEl.createEl('input', {
			cls: 'ioto-tasks-center__task-search-input',
			type: 'search',
		});
		searchInputEl.placeholder = t('view.search.placeholder');
		searchInputEl.value = this.taskSearchInputValue;
		searchInputEl.disabled = !this.canSearchTasks();
		searchInputEl.addEventListener('input', () => {
			this.taskSearchInputValue = searchInputEl.value;
		});
		searchInputEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') {
				return;
			}

			event.preventDefault();
			this.applyTaskSearchQuery();
		});
		if (this.taskSearchInputValue || this.taskSearchQuery) {
			const clearButtonEl = searchInputWrapperEl.createEl('button', {
				cls: 'ioto-tasks-center__task-search-clear-button',
				text: 'X',
			});
			clearButtonEl.type = 'button';
			clearButtonEl.disabled = !this.canSearchTasks();
			clearButtonEl.ariaLabel = t('view.search.clear');
			clearButtonEl.title = t('view.search.clearShort');
			clearButtonEl.addEventListener('click', () => {
				this.clearTaskSearch();
			});
		}
		const searchButtonEl = searchControlsEl.createEl('button', {
			cls: 'ioto-tasks-center__task-search-button',
			text: t('view.search.button'),
		});
		searchButtonEl.type = 'button';
		searchButtonEl.disabled = !this.canSearchTasks();
		searchButtonEl.ariaLabel = t('view.search.run');
		searchButtonEl.addEventListener('click', () => {
			this.applyTaskSearchQuery();
		});
	}

	private canSearchTasks(): boolean {
		return Boolean(
			this.selectedProject &&
			!this.isTasksLoading &&
			this.taskResult &&
			this.taskResult.status === 'success',
		);
	}

	private shouldShowTaskSearchIcon(): boolean {
		return Boolean(
			this.selectedProject &&
			this.taskResult &&
			this.taskResult.status === 'success' &&
			this.tasks.length > 0,
		);
	}

	private toggleTaskSearchPopover(anchorEl: HTMLElement): void {
		if (this.isTaskSearchPopoverOpen) {
			this.closeTaskSearchPopover();
			this.render();
			return;
		}

		this.isTaskSearchPopoverOpen = true;
		this.shouldFocusTaskSearchPopover = true;
		this.contentEl
			.querySelector('.ioto-tasks-center__task-search-hint')
			?.remove();
		this.openTaskSearchPopover(anchorEl, true);
	}

	private openTaskSearchPopover(
		anchorEl: HTMLElement,
		forceFocus: boolean,
	): void {
		const popover = this.taskSearchPopover;
		if (!popover) {
			return;
		}

		if (!this.shouldShowTaskSearchIcon()) {
			this.closeTaskSearchPopover();
			return;
		}

		const shouldFocus = forceFocus || this.shouldFocusTaskSearchPopover;
		this.shouldFocusTaskSearchPopover = false;

		popover.open({
			anchorEl,
			placeholder: t('view.search.placeholder'),
			value: this.taskSearchInputValue,
			canSearch: this.canSearchTasks(),
			showClear: Boolean(
				this.taskSearchInputValue || this.taskSearchQuery,
			),
			searchButtonText: t('view.search.button'),
			searchButtonAriaLabel: t('view.search.run'),
			clearButtonAriaLabel: t('view.search.clear'),
			clearButtonTitle: t('view.search.clearShort'),
			onChange: (value) => {
				this.taskSearchInputValue = value;
			},
			onApply: () => {
				this.applyTaskSearchQuery();
			},
			onClear: () => {
				this.clearTaskSearch();
			},
			onClose: () => {
				this.isTaskSearchPopoverOpen = false;
				this.shouldFocusTaskSearchPopover = false;
				this.render();
			},
			shouldFocus,
		});
	}

	private closeTaskSearchPopover(): void {
		this.taskSearchPopover?.close();
		this.isTaskSearchPopoverOpen = false;
		this.shouldFocusTaskSearchPopover = false;
	}

	private applyTaskSearchQuery(): void {
		const nextQuery = this.taskSearchInputValue;
		if (nextQuery === this.taskSearchQuery) {
			return;
		}

		this.taskSearchQuery = nextQuery;
		if (this.isTaskSearchPopoverOpen) {
			this.shouldFocusTaskSearchPopover = true;
		}
		this.render();
	}

	private clearTaskSearch(): void {
		if (!this.taskSearchInputValue && !this.taskSearchQuery) {
			return;
		}

		this.taskSearchInputValue = '';
		this.taskSearchQuery = '';
		if (this.isTaskSearchPopoverOpen) {
			this.shouldFocusTaskSearchPopover = true;
		}
		this.render();
	}

	private handleTaskDragStart(
		event: DragEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		if (this.isUpdatingUpTask) {
			event.preventDefault();
			return;
		}

		this.draggingTaskPath = task.path;
		this.dropTargetTaskPath = null;
		this.invalidDropTargetTaskPath = null;
		this.isRemoveUpTaskDropTarget = false;
		this.contentEl
			.querySelector(TASK_LIST_SELECTOR)
			?.addClass('has-remove-up-task-drop-zone');
		rowEl.addClass('is-dragging');
		if (event.dataTransfer) {
			event.dataTransfer.effectAllowed = 'move';
			event.dataTransfer.setData('text/plain', task.path);
		}
	}

	private handleTaskDragOver(
		event: DragEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		if (!this.draggingTaskPath || this.isUpdatingUpTask) {
			return;
		}

		const validation = validateTaskParentDrop(
			this.tasks,
			this.draggingTaskPath,
			task.path,
		);
		if (!validation.valid) {
			this.setCurrentDropTarget(task.path, true, rowEl);
			return;
		}

		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		this.setCurrentDropTarget(task.path, false, rowEl);
	}

	private handleTaskDragLeave(
		event: DragEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && rowEl.contains(nextTarget)) {
			return;
		}

		if (
			this.dropTargetTaskPath === task.path ||
			this.invalidDropTargetTaskPath === task.path
		) {
			rowEl.removeClass('is-drop-target', 'is-drop-invalid');
			this.dropTargetTaskPath = null;
			this.invalidDropTargetTaskPath = null;
		}
	}

	private async handleTaskDrop(
		event: DragEvent,
		targetTask: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): Promise<void> {
		event.preventDefault();
		const draggedTaskPath = this.draggingTaskPath;
		if (!draggedTaskPath || this.isUpdatingUpTask) {
			return;
		}

		const validation = validateTaskParentDrop(
			this.tasks,
			draggedTaskPath,
			targetTask.path,
		);
		if (!validation.valid) {
			new Notice(getTaskDropValidationMessage(validation.reason));
			this.clearTaskDragState();
			return;
		}

		await this.assignDraggedTaskToParent(
			draggedTaskPath,
			targetTask,
			rowEl,
		);
	}

	private setCurrentDropTarget(
		taskPath: string,
		invalid: boolean,
		rowEl: HTMLButtonElement,
	): void {
		if (this.dropTargetTaskPath && this.dropTargetTaskPath !== taskPath) {
			this.findTaskRowByPath(this.dropTargetTaskPath)?.removeClass(
				'is-drop-target',
			);
		}

		if (
			this.invalidDropTargetTaskPath &&
			this.invalidDropTargetTaskPath !== taskPath
		) {
			this.findTaskRowByPath(this.invalidDropTargetTaskPath)?.removeClass(
				'is-drop-invalid',
			);
		}

		this.dropTargetTaskPath = invalid ? null : taskPath;
		this.invalidDropTargetTaskPath = invalid ? taskPath : null;
		rowEl.toggleClass('is-drop-target', !invalid);
		rowEl.toggleClass('is-drop-invalid', invalid);
	}

	private clearTaskDragState(): void {
		for (const rowEl of this.getTaskRowElements()) {
			rowEl.removeClass(
				'is-dragging',
				'is-drop-target',
				'is-drop-invalid',
			);
		}
		this.contentEl
			.querySelector('.ioto-tasks-center__remove-up-task-drop-zone')
			?.removeClass('is-drop-target');
		this.contentEl
			.querySelector(TASK_LIST_SELECTOR)
			?.removeClass('has-remove-up-task-drop-zone');

		this.draggingTaskPath = null;
		this.dropTargetTaskPath = null;
		this.invalidDropTargetTaskPath = null;
		this.isRemoveUpTaskDropTarget = false;
	}

	private getTaskRowElements(): HTMLButtonElement[] {
		return Array.from(
			this.contentEl.querySelectorAll<HTMLButtonElement>(
				'.ioto-tasks-center__task-row',
			),
		);
	}

	private findTaskRowByPath(taskPath: string): HTMLButtonElement | null {
		for (const rowEl of this.getTaskRowElements()) {
			if (rowEl.dataset.taskPath === taskPath) {
				return rowEl;
			}
		}

		return null;
	}

	private async assignDraggedTaskToParent(
		draggedTaskPath: string,
		targetTask: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): Promise<void> {
		const draggedFile =
			this.app.vault.getAbstractFileByPath(draggedTaskPath);
		if (!(draggedFile instanceof TFile)) {
			this.clearTaskDragState();
			new Notice(t('view.notice.draggedTaskMissing'));
			return;
		}

		this.isUpdatingUpTask = true;
		rowEl.removeClass('is-drop-target', 'is-drop-invalid');

		try {
			await assignUpTaskToFile(this.app, draggedFile, targetTask.title);
			if (this.selectedProject) {
				this.isTasksLoading = true;
				this.render();
				await this.loadTasks(this.selectedProject);
			}
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.updateUpTaskFailed');
			new Notice(message);
		} finally {
			this.isUpdatingUpTask = false;
			this.clearTaskDragState();
			this.render();
		}
	}

	private handleRemoveUpTaskDragOver(
		event: DragEvent,
		dropZoneEl: HTMLDivElement,
	): void {
		if (!this.draggingTaskPath || this.isUpdatingUpTask) {
			return;
		}

		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'move';
		}
		this.clearCurrentTaskDropTargetClasses();
		this.isRemoveUpTaskDropTarget = true;
		dropZoneEl.addClass('is-drop-target');
	}

	private handleRemoveUpTaskDragLeave(
		event: DragEvent,
		dropZoneEl: HTMLDivElement,
	): void {
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && dropZoneEl.contains(nextTarget)) {
			return;
		}

		this.isRemoveUpTaskDropTarget = false;
		dropZoneEl.removeClass('is-drop-target');
	}

	private async handleRemoveUpTaskDrop(
		event: DragEvent,
		dropZoneEl: HTMLDivElement,
	): Promise<void> {
		event.preventDefault();
		const draggedTaskPath = this.draggingTaskPath;
		if (!draggedTaskPath || this.isUpdatingUpTask) {
			return;
		}

		this.isRemoveUpTaskDropTarget = false;
		dropZoneEl.removeClass('is-drop-target');
		await this.removeDraggedTaskParent(draggedTaskPath);
	}

	private clearCurrentTaskDropTargetClasses(): void {
		if (this.dropTargetTaskPath) {
			this.findTaskRowByPath(this.dropTargetTaskPath)?.removeClass(
				'is-drop-target',
			);
			this.dropTargetTaskPath = null;
		}

		if (this.invalidDropTargetTaskPath) {
			this.findTaskRowByPath(this.invalidDropTargetTaskPath)?.removeClass(
				'is-drop-invalid',
			);
			this.invalidDropTargetTaskPath = null;
		}

		this.contentEl
			.querySelector('.ioto-tasks-center__remove-up-task-drop-zone')
			?.removeClass('is-drop-target');
		this.isRemoveUpTaskDropTarget = false;
	}

	private async removeDraggedTaskParent(
		draggedTaskPath: string,
	): Promise<void> {
		const draggedFile =
			this.app.vault.getAbstractFileByPath(draggedTaskPath);
		if (!(draggedFile instanceof TFile)) {
			this.clearTaskDragState();
			new Notice(t('view.notice.draggedTaskMissing'));
			return;
		}

		this.isUpdatingUpTask = true;
		try {
			await removeUpTaskFromFile(this.app, draggedFile);
			if (this.selectedProject) {
				this.isTasksLoading = true;
				this.render();
				await this.loadTasks(this.selectedProject);
			}
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.removeUpTaskFailed');
			new Notice(message);
		} finally {
			this.isUpdatingUpTask = false;
			this.clearTaskDragState();
			this.render();
		}
	}

	private getAddTaskButtonLabel(): string {
		if (this.isCreatingTask) {
			return t('view.tasksPane.addTaskCreating');
		}

		if (!this.selectedProject) {
			return t('view.tasksPane.addTaskSelectProject');
		}

		if (this.isProjectsLoading || this.isTasksLoading) {
			return t('view.tasksPane.addTaskLoading');
		}

		return t('view.tasksPane.addTaskReady', [this.selectedProject]);
	}

	private canCreateProject(): boolean {
		return (
			!this.isProjectsLoading &&
			!this.isCreatingProject &&
			this.projectResult.status !== 'root-missing'
		);
	}

	private getAddProjectButtonLabel(): string {
		const tasksRootPath = this.getTasksRootPath();
		if (this.isCreatingProject) {
			return t('view.projectsPane.addProjectCreating');
		}

		if (this.isProjectsLoading) {
			return t('view.projectsPane.addProjectLoading');
		}

		if (this.projectResult.status === 'root-missing') {
			return t('view.projectsPane.addProjectRootMissing', [
				tasksRootPath,
			]);
		}

		return t('view.projectsPane.addProjectReady', [tasksRootPath]);
	}

	private async handleCreateProject(): Promise<void> {
		if (!this.canCreateProject()) {
			return;
		}

		const projectNameResult = await new TaskNameModal(
			this.app,
			t('modal.newProject.title'),
			t('modal.newProject.placeholder'),
			{
				descriptionText: t('modal.newProject.desc'),
				confirmButtonText: t('modal.create'),
			},
		).openAndGetValue();
		if (!projectNameResult) {
			return;
		}

		this.isCreatingProject = true;
		this.render();

		try {
			const result = await createProjectFolder(
				this.app,
				this.getTasksRootPath(),
				projectNameResult,
			);
			if (!result.created) {
				new Notice(t('view.notice.projectAlreadyExists'));
			}
			await this.loadProjects(result.name);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.createProjectFailed');
			new Notice(message);
		} finally {
			this.isCreatingProject = false;
			this.render();
		}
	}

	private async showTaskCreationMenu(event: MouseEvent): Promise<void> {
		if (!this.canCreateTask()) {
			return;
		}

		const enabledTypes = this.getEnabledTaskCreationTypes();
		const normalizedEnabledTypes =
			enabledTypes.length > 0
				? enabledTypes
				: getTaskCreationOptions().map((option) => option.key);
		if (normalizedEnabledTypes.length === 1) {
			const onlyType = normalizedEnabledTypes[0];
			if (!onlyType) {
				return;
			}
			void this.handleCreateTask(onlyType);
			return;
		}

		const menu = new Menu();
		const menuOptions = getTaskCreationOptions().filter((option) =>
			normalizedEnabledTypes.includes(option.key),
		);
		const resolvedMenuOptions =
			menuOptions.length > 0 ? menuOptions : getTaskCreationOptions();
		for (const option of resolvedMenuOptions) {
			menu.addItem((item) =>
				item.setTitle(option.label).onClick(() => {
					void this.handleCreateTask(option.key);
				}),
			);
		}
		menu.showAtMouseEvent(event);
	}

	private async handleCreateTask(type: TaskCreationType): Promise<void> {
		const projectName = this.selectedProject;
		if (
			!projectName ||
			!this.projects.some((project) => project.name === projectName)
		) {
			new Notice(t('view.notice.currentProjectUnavailable'));
			return;
		}

		let customName: string | undefined;
		if (type !== 'date') {
			const taskTypeTexts =
				type === 'plan'
					? {
							title: t('modal.newPlanTask.title'),
							label: t('modal.newPlanTask.placeholder'),
						}
					: type === 'topic'
						? {
								title: t('modal.newTopicTask.title'),
								label: t('modal.newTopicTask.placeholder'),
							}
						: {
								title: t('modal.newNormalTask.title'),
								label: t('modal.newNormalTask.placeholder'),
							};
			const customNameResult = await new TaskNameModal(
				this.app,
				taskTypeTexts.title,
				taskTypeTexts.label,
				{
					descriptionText: t('modal.newTask.desc'),
					confirmButtonText: t('modal.create'),
				},
			).openAndGetValue();
			if (!customNameResult) {
				return;
			}
			customName = customNameResult;
		}

		this.isCreatingTask = true;
		this.render();

		try {
			const previewLeaf = this.ensurePreviewLeaf();
			const result = await createTaskFile({
				app: this.app,
				tasksRootPath: this.getTasksRootPath(),
				projectName,
				type,
				customName,
				templateConfig: this.getTaskTemplateConfig(type),
				dateTaskDateFormat: this.getDateTaskDateFormat(),
				targetLeaf: previewLeaf,
				sourceLeaf: this.leaf,
			});
			this.previewLeaf = previewLeaf;
			this.lastOpenedTaskByProject.set(projectName, result.file.path);
			await this.refreshFromVaultChange();
			await this.openFileInPreview(result.file);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.createTaskFailed');
			new Notice(message);
		} finally {
			this.isCreatingTask = false;
			this.render();
		}
	}

	private async handleCreateSubtask(
		parentTask: TaskFileEntry,
		type: TaskCreationType,
	): Promise<void> {
		const parentFile = this.app.vault.getAbstractFileByPath(
			parentTask.path,
		);
		if (!(parentFile instanceof TFile)) {
			new Notice(t('view.notice.taskFileUnavailable'));
			return;
		}

		const currentTaskContext = resolveCurrentTaskContext(
			parentFile,
			this.getTasksRootPath(),
		);

		let customName: string | undefined;
		if (type !== 'date') {
			const taskTypeTexts =
				type === 'plan'
					? {
							title: t('modal.newPlanSubtask.title'),
							label: t('modal.newPlanSubtask.placeholder'),
						}
					: type === 'topic'
						? {
								title: t('modal.newTopicSubtask.title'),
								label: t('modal.newTopicSubtask.placeholder'),
							}
						: {
								title: t('modal.newNormalSubtask.title'),
								label: t('modal.newNormalSubtask.placeholder'),
							};
			const customNameResult = await new TaskNameModal(
				this.app,
				taskTypeTexts.title,
				taskTypeTexts.label,
				{
					descriptionText: t('modal.newSubtask.desc'),
					confirmButtonText: t('modal.create'),
				},
			).openAndGetValue();
			if (!customNameResult) {
				return;
			}
			customName = customNameResult;
		}

		this.isCreatingTask = true;
		this.deferVaultRefreshForSubtaskCreation = true;
		this.render();

		try {
			const previewLeaf = this.ensurePreviewLeaf();
			const result = await createTaskFile({
				app: this.app,
				tasksRootPath: this.getTasksRootPath(),
				projectName: currentTaskContext.projectName,
				type,
				customName,
				targetDirectoryPath: currentTaskContext.currentDirectoryPath,
				templateConfig: this.getTaskTemplateConfig(type),
				dateTaskDateFormat: this.getDateTaskDateFormat(),
				targetLeaf: previewLeaf,
				sourceLeaf: this.leaf,
			});
			await assignUpTaskToFile(
				this.app,
				result.file,
				currentTaskContext.parentTaskTitle,
			);
			this.previewLeaf = previewLeaf;
			this.lastOpenedTaskByProject.set(
				currentTaskContext.projectName,
				result.file.path,
			);
			this.deferVaultRefreshForSubtaskCreation = false;
			this.clearDeferredVaultRefreshState();
			await this.refreshFromVaultChange();
			await this.openFileInPreview(result.file);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.createSubtaskFailed');
			new Notice(message);
		} finally {
			this.deferVaultRefreshForSubtaskCreation = false;
			if (this.pendingVaultRefresh) {
				this.clearDeferredVaultRefreshState();
				await this.refreshFromVaultChange();
			}
			this.isCreatingTask = false;
			this.render();
		}
	}

	private clearDeferredVaultRefreshState(): void {
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

	private renderTaskTabs(container: HTMLElement): void {
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

	private getTasksForActiveTab(): TaskFileEntry[] {
		return this.tasks.filter((task) =>
			this.matchesTaskFilterTab(task, this.activeTaskFilterTab),
		);
	}

	private getVisibleTasks(): TaskFileEntry[] {
		return filterTasksBySearchQuery(
			this.getTasksForActiveTab(),
			this.taskSearchQuery,
		);
	}

	private getTaskPresentationSections(tasks: TaskFileEntry[]) {
		return buildTaskPresentationSections(tasks, {
			sortMode: this.getTaskListSortMode(),
			groupMode: this.getTaskListGroupMode(),
		});
	}

	private isTaskGroupCollapsed(sectionKey: string): boolean {
		return this.collapsedTaskGroups.has(sectionKey);
	}

	private isProjectGroupCollapsed(groupKey: string): boolean {
		return this.collapsedProjectGroups.has(groupKey);
	}

	private toggleTaskGroupCollapsed(sectionKey: string): void {
		if (this.collapsedTaskGroups.has(sectionKey)) {
			this.collapsedTaskGroups.delete(sectionKey);
		} else {
			this.collapsedTaskGroups.add(sectionKey);
		}

		this.render();
	}

	private toggleProjectGroupCollapsed(groupKey: string): void {
		if (this.collapsedProjectGroups.has(groupKey)) {
			this.collapsedProjectGroups.delete(groupKey);
		} else {
			this.collapsedProjectGroups.add(groupKey);
		}

		this.render();
	}

	private isSubtasksCollapsed(taskPath: string): boolean {
		return this.collapsedSubtaskParents.has(taskPath);
	}

	private toggleSubtasksCollapsed(taskPath: string): void {
		if (this.collapsedSubtaskParents.has(taskPath)) {
			this.collapsedSubtaskParents.delete(taskPath);
		} else {
			this.collapsedSubtaskParents.add(taskPath);
		}

		this.render();
	}

	private syncCollapsedTaskGroups(
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

	private syncCollapsedProjectGroups(
		sections: Array<{ groupKey: string }>,
	): void {
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

	private getTaskListDescription(): string {
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
		return t('view.description.currentProject', [
			this.selectedProject,
			String(this.tasks.length),
			sortDescription,
			groupDescription,
			priorityDescription,
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

	private showProjectPresentationMenu(event: MouseEvent): void {
		const projectListSortModeOptions = getProjectListSortModeOptions();
		const projectListGroupModeOptions = getProjectListGroupModeOptions();
		const menu = new Menu();
		const currentSortMode = this.getProjectListSortMode();
		const currentGroupMode = this.getProjectListGroupMode();

		for (const sortMode of PROJECT_LIST_SORT_MODE_ORDER) {
			const label = projectListSortModeOptions[sortMode];
			menu.addItem((item) =>
				item
					.setTitle(
						formatMenuOptionTitle(
							t('menu.category.sort'),
							label,
							sortMode === currentSortMode,
						),
					)
					.onClick(() => {
						void this.updateProjectListSortMode(sortMode).catch(
							(error: unknown) => {
								const message =
									error instanceof Error
										? error.message
										: t(
												'view.notice.updateProjectSortFailed',
											);
								new Notice(message);
							},
						);
					}),
			);
		}

		menu.addSeparator();

		for (const groupMode of PROJECT_LIST_GROUP_MODE_ORDER) {
			const label = projectListGroupModeOptions[groupMode];
			menu.addItem((item) =>
				item
					.setTitle(
						formatMenuOptionTitle(
							t('menu.category.group'),
							label,
							groupMode === currentGroupMode,
						),
					)
					.onClick(() => {
						void this.updateProjectListGroupMode(groupMode).catch(
							(error: unknown) => {
								const message =
									error instanceof Error
										? error.message
										: t(
												'view.notice.updateProjectGroupFailed',
											);
								new Notice(message);
							},
						);
					}),
			);
		}

		menu.showAtMouseEvent(event);
	}

	private showTaskPresentationMenu(event: MouseEvent): void {
		const taskListSortModeOptions = getTaskListSortModeOptions();
		const taskListGroupModeOptions = getTaskListGroupModeOptions();
		const menu = new Menu();
		const currentSortMode = this.getTaskListSortMode();
		const currentGroupMode = this.getTaskListGroupMode();
		const currentShowTaskPriority = this.getShowTaskPriority();

		for (const sortMode of TASK_LIST_SORT_MODE_ORDER) {
			const label = taskListSortModeOptions[sortMode];
			menu.addItem((item) =>
				item
					.setTitle(
						formatMenuOptionTitle(
							t('menu.category.sort'),
							label,
							sortMode === currentSortMode,
						),
					)
					.onClick(() => {
						void this.updateTaskListSortMode(sortMode).catch(
							(error: unknown) => {
								const message =
									error instanceof Error
										? error.message
										: t('view.notice.updateTaskSortFailed');
								new Notice(message);
							},
						);
					}),
			);
		}

		menu.addSeparator();

		for (const groupMode of TASK_LIST_GROUP_MODE_ORDER) {
			const label = taskListGroupModeOptions[groupMode];
			menu.addItem((item) =>
				item
					.setTitle(
						formatMenuOptionTitle(
							t('menu.category.group'),
							label,
							groupMode === currentGroupMode,
						),
					)
					.onClick(() => {
						void this.updateTaskListGroupMode(groupMode).catch(
							(error: unknown) => {
								const message =
									error instanceof Error
										? error.message
										: t(
												'view.notice.updateTaskGroupFailed',
											);
								new Notice(message);
							},
						);
					}),
			);
		}

		menu.addSeparator();
		for (const visibilityOption of getTaskPriorityVisibilityOptions()) {
			menu.addItem((item) =>
				item
					.setTitle(
						formatMenuOptionTitle(
							t('menu.category.priority'),
							visibilityOption.label,
							visibilityOption.show === currentShowTaskPriority,
						),
					)
					.onClick(() => {
						void this.updateShowTaskPriority(
							visibilityOption.show,
						).catch((error: unknown) => {
							const message =
								error instanceof Error
									? error.message
									: t(
											'view.notice.updateTaskPriorityDisplayFailed',
										);
							new Notice(message);
						});
					}),
			);
		}

		menu.showAtMouseEvent(event);
	}

	private showTaskPriorityMenu(event: MouseEvent, task: TaskFileEntry): void {
		const menu = new Menu();
		const enabledTypes = this.getEnabledTaskCreationTypes();
		const normalizedEnabledTypes =
			enabledTypes.length > 0
				? enabledTypes
				: getTaskCreationOptions().map((option) => option.key);

		menu.addItem((item) =>
			item
				.setTitle(
					task.starred
						? t('view.taskCoreMenu.clear')
						: t('view.taskCoreMenu.set'),
				)
				.onClick(() => {
					if (task.starred) {
						void this.clearTaskStarred(task);
						return;
					}

					void this.updateTaskStarred(task);
				}),
		);
		menu.addSeparator();

		menu.addItem((item) => {
			item.setTitle(t('view.taskMenu.addSubtask'));

			if (normalizedEnabledTypes.length === 1) {
				const onlyType = normalizedEnabledTypes[0];
				if (!onlyType) {
					return;
				}
				item.onClick(() => {
					void this.handleCreateSubtask(task, onlyType);
				});
				return;
			}

			if (typeof item.setSubmenu !== 'function') {
				item.onClick(() => {
					this.showTaskSubtaskTypeMenu(
						event,
						task,
						normalizedEnabledTypes,
					);
				});
				return;
			}

			try {
				const subMenu = item.setSubmenu();
				const menuOptions = getTaskCreationOptions().filter((option) =>
					normalizedEnabledTypes.includes(option.key),
				);
				const resolvedMenuOptions =
					menuOptions.length > 0
						? menuOptions
						: getTaskCreationOptions();
				for (const option of resolvedMenuOptions) {
					subMenu.addItem((subItem) =>
						subItem.setTitle(option.label).onClick(() => {
							void this.handleCreateSubtask(task, option.key);
						}),
					);
				}
			} catch {
				item.onClick(() => {
					this.showTaskSubtaskTypeMenu(
						event,
						task,
						normalizedEnabledTypes,
					);
				});
			}
		});
		menu.addSeparator();

		if (typeof task.priority === 'number') {
			menu.addItem((item) =>
				item.setTitle(t('view.taskPriorityMenu.clear')).onClick(() => {
					void this.clearTaskPriority(task);
				}),
			);
			menu.addSeparator();
		}

		for (const priority of TASK_PRIORITY_VALUES) {
			menu.addItem((item) =>
				item
					.setTitle(
						formatPriorityMenuTitle(
							priority,
							task.priority === priority,
						),
					)
					.onClick(() => {
						void this.updateTaskPriority(task, priority);
					}),
			);
		}

		menu.addSeparator();
		menu.addItem((item) =>
			item.setTitle(t('view.taskMenu.delete')).onClick(() => {
				void this.confirmAndDeleteTask(task);
			}),
		);

		menu.showAtMouseEvent(event);
	}

	private showTaskSubtaskTypeMenu(
		event: MouseEvent,
		parentTask: TaskFileEntry,
		enabledTypes: TaskCreationType[],
	): void {
		const menu = new Menu();
		const menuOptions = getTaskCreationOptions().filter((option) =>
			enabledTypes.includes(option.key),
		);
		const resolvedMenuOptions =
			menuOptions.length > 0 ? menuOptions : getTaskCreationOptions();
		for (const option of resolvedMenuOptions) {
			menu.addItem((item) =>
				item.setTitle(option.label).onClick(() => {
					void this.handleCreateSubtask(parentTask, option.key);
				}),
			);
		}

		menu.showAtPosition({
			x: event.clientX + 12,
			y: event.clientY,
		});
	}

	private renderTaskFilterEmptyState(container: HTMLElement): void {
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

	private renderTaskSearchEmptyState(container: HTMLElement): void {
		const keyword = this.taskSearchQuery.trim();
		this.renderState(
			container,
			t('view.search.emptyTitle'),
			t('view.search.emptyDesc', [keyword]),
			'is-empty',
		);
	}

	private async buildProjectIncompleteCounts(
		projects: ProjectFolderEntry[],
	): Promise<Map<string, number>> {
		const tasksRootPath = this.getTasksRootPath();
		const entries = await Promise.all(
			projects.map(async (project) => {
				const result = await listProjectTaskFiles(
					this.app,
					tasksRootPath,
					project.name,
				);
				const incompleteCount = result.tasks.filter((task) =>
					isIncompleteTaskStatus(task.status.key),
				).length;
				return [project.name, incompleteCount] as const;
			}),
		);

		return new Map(entries);
	}

	private buildProjectCategoryByName(
		projects: ProjectFolderEntry[],
	): Map<string, string> {
		const tasksRootPath = this.getTasksRootPath();
		const entries = projects.map((project) => {
			const file = getProjectMetadataFile(
				this.app,
				tasksRootPath,
				project.name,
			);
			if (!file) {
				return [project.name, ''] as const;
			}

			const frontmatter =
				this.app.metadataCache.getFileCache(file)?.frontmatter;
			const metadata = readProjectMetadataFromFrontmatter(frontmatter);
			const category =
				typeof metadata?.category === 'string' ? metadata.category : '';
			return [project.name, category] as const;
		});

		return new Map(entries);
	}

	private applyProjectSorting(): void {
		this.projects = sortProjectEntries(
			this.projects,
			this.projectIncompleteCounts,
			this.getProjectListSortMode(),
		);
	}

	private renderState(
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
		const cachedTaskPath = this.lastOpenedTaskByProject.get(projectName);
		if (!cachedTaskPath) {
			return null;
		}

		return this.tasks.some((task) => task.path === cachedTaskPath)
			? cachedTaskPath
			: null;
	}

	private async openTaskFile(task: TaskFileEntry): Promise<void> {
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

	private async updateTaskPriority(
		task: TaskFileEntry,
		priority: TaskPriorityValue,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			new Notice(t('view.notice.taskFileUnavailable'));
			return;
		}

		try {
			await setTaskFilePriority(this.app, file, priority);
			await this.refreshCurrentProjectTasks();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.updateTaskPriorityFailed');
			new Notice(message);
		}
	}

	private async clearTaskPriority(task: TaskFileEntry): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			new Notice(t('view.notice.taskFileUnavailable'));
			return;
		}

		try {
			await clearTaskFilePriority(this.app, file);
			await this.refreshCurrentProjectTasks();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.clearTaskPriorityFailed');
			new Notice(message);
		}
	}

	private async updateTaskStarred(task: TaskFileEntry): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			new Notice(t('view.notice.taskFileUnavailable'));
			return;
		}

		try {
			await setTaskFileStarred(this.app, file);
			await this.refreshCurrentProjectTasks();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.updateTaskCoreFailed');
			new Notice(message);
		}
	}

	private async clearTaskStarred(task: TaskFileEntry): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			new Notice(t('view.notice.taskFileUnavailable'));
			return;
		}

		try {
			await clearTaskFileStarred(this.app, file);
			await this.refreshCurrentProjectTasks();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.clearTaskCoreFailed');
			new Notice(message);
		}
	}

	private async confirmAndDeleteTask(task: TaskFileEntry): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			new Notice(t('view.notice.taskFileUnavailable'));
			return;
		}

		const confirmed = await new ConfirmModal(
			this.app,
			t('modal.deleteTask.title'),
			{
				descriptionText: t('modal.deleteTask.desc', [task.title]),
				confirmButtonText: t('modal.deleteTask.confirm'),
				cancelButtonText: t('modal.cancel'),
			},
		).openAndConfirm();
		if (!confirmed) {
			return;
		}

		try {
			await trashTaskFile(this.app, file);
			await this.refreshFromVaultChange();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('view.notice.deleteTaskFailed');
			new Notice(message);
		}
	}

	private async refreshCurrentProjectTasks(): Promise<void> {
		if (!this.selectedProject) {
			return;
		}

		this.isTasksLoading = true;
		this.render();
		await this.loadTasks(this.selectedProject);
	}

	private async openFileInPreview(file: TFile): Promise<void> {
		this.openingTaskPath = file.path;
		this.render();

		try {
			const leaf = this.ensurePreviewLeaf();
			await leaf.openFile(file, {
				active: true,
			});
			this.previewLeaf = leaf;
			this.openedTaskPath = file.path;
			if (this.selectedProject) {
				this.lastOpenedTaskByProject.set(
					this.selectedProject,
					file.path,
				);
			}
		} finally {
			this.openingTaskPath = null;
			this.render();
		}
	}

	private getActiveTaskPath(): string | null {
		return resolveActiveTaskPath({
			openedTaskPath: this.openedTaskPath,
			previewLeafAvailable: Boolean(
				this.previewLeaf && this.isLeafAvailable(this.previewLeaf),
			),
			previewedFilePath: this.getPreviewLeafFilePath(),
		});
	}

	private getPreviewLeafFilePath(): string | null {
		if (!this.previewLeaf || !this.isLeafAvailable(this.previewLeaf)) {
			return null;
		}

		const view = this.previewLeaf.view;
		return view instanceof FileView && view.file ? view.file.path : null;
	}

	private activatePreviewLeaf(): void {
		if (!this.previewLeaf || !this.isLeafAvailable(this.previewLeaf)) {
			return;
		}

		this.app.workspace.setActiveLeaf(this.previewLeaf, {
			focus: true,
		});
	}

	private ensurePreviewLeaf(): WorkspaceLeaf {
		if (this.previewLeaf && this.isLeafAvailable(this.previewLeaf)) {
			return this.previewLeaf;
		}

		const recoveredLeaf = this.findReusablePreviewLeaf();
		if (recoveredLeaf) {
			this.previewLeaf = recoveredLeaf;
			return recoveredLeaf;
		}

		const previewLeaf = this.app.workspace.createLeafBySplit(
			this.leaf,
			'vertical',
		);
		this.previewLeaf = previewLeaf;
		return previewLeaf;
	}

	private isLeafAvailable(targetLeaf: WorkspaceLeaf): boolean {
		let exists = false;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf === targetLeaf) {
				exists = true;
			}
		});
		return exists;
	}

	private findReusablePreviewLeaf(): WorkspaceLeaf | null {
		if (this.openedTaskPath) {
			const openedFileLeaf = this.findLeafByFilePath(this.openedTaskPath);
			if (openedFileLeaf && openedFileLeaf !== this.leaf) {
				return openedFileLeaf;
			}
		}

		return null;
	}

	private findLeafByFilePath(filePath: string): WorkspaceLeaf | null {
		let matchedLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (matchedLeaf || leaf === this.leaf) {
				return;
			}

			const view = leaf.view;
			if (view instanceof FileView && view.file?.path === filePath) {
				matchedLeaf = leaf;
			}
		});

		return matchedLeaf;
	}

	private findLeafById(leafId: string): WorkspaceLeaf | null {
		let matchedLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (matchedLeaf) {
				return;
			}

			if (getWorkspaceLeafId(leaf) === leafId) {
				matchedLeaf = leaf;
			}
		});

		return matchedLeaf;
	}
}

function getTaskCreationOptions(): Array<{
	key: TaskCreationType;
	label: string;
}> {
	return [
		{ key: 'normal', label: t('task.type.normal') },
		{ key: 'date', label: t('task.type.date') },
		{ key: 'topic', label: t('task.type.topic') },
		{ key: 'plan', label: t('task.type.plan') },
	];
}

function buildProjectGroupBodyId(groupKey: string): string {
	const safeKey = encodeURIComponent(groupKey || 'uncategorized').replace(
		/%/g,
		'_',
	);
	return `ioto-tasks-center-project-group-${safeKey}`;
}

const PROJECT_LIST_SORT_MODE_ORDER: ProjectListSortMode[] = [
	'incomplete-count',
	'incomplete-count-asc',
	'name',
	'name-desc',
];

const PROJECT_LIST_GROUP_MODE_ORDER: ProjectListGroupMode[] = [
	'none',
	'category',
];

const TASK_LIST_SORT_MODE_ORDER: TaskListSortMode[] = [
	'created-desc',
	'created-asc',
	'updated-desc',
	'updated-asc',
	'name-asc',
	'name-desc',
	'priority-desc',
	'priority-asc',
];

const TASK_LIST_GROUP_MODE_ORDER: TaskListGroupMode[] = [
	'none',
	'status',
	'priority',
];
function getTaskPriorityVisibilityOptions() {
	return [
		{ show: true, label: t('menu.priority.show') },
		{ show: false, label: t('menu.priority.hide') },
	] as const;
}

function formatPriorityMenuTitle(priority: number, active: boolean): string {
	const label = `P${priority}`;
	return active
		? `${label}${t('view.taskPriorityMenu.currentSuffix')}`
		: label;
}

function formatMenuOptionTitle(
	category: string,
	label: string,
	active: boolean,
): string {
	return active
		? `${category}: ${label}${t('menu.currentSuffix')}`
		: `${category}: ${label}`;
}

function getTaskPriorityClassName(priority: number): string {
	if (priority === 0) {
		return 'ioto-tasks-center__task-priority--p0';
	}

	if (priority === 1) {
		return 'ioto-tasks-center__task-priority--p1';
	}

	if (priority === 2) {
		return 'ioto-tasks-center__task-priority--p2';
	}

	return 'ioto-tasks-center__task-priority--p3-plus';
}

function getWorkspaceLeafId(leaf: WorkspaceLeaf | null): string | null {
	if (!leaf) {
		return null;
	}

	const candidate = leaf as WorkspaceLeaf & { id?: unknown };
	return typeof candidate.id === 'string' ? candidate.id : null;
}

function parseViewState(state: unknown): IOTOTasksCenterViewState {
	if (!state || typeof state !== 'object') {
		return {};
	}

	const candidate = state as Record<string, unknown>;
	return {
		selectedProject:
			typeof candidate.selectedProject === 'string'
				? candidate.selectedProject
				: undefined,
		taskSearchQuery:
			typeof candidate.taskSearchQuery === 'string'
				? candidate.taskSearchQuery
				: undefined,
		taskSearchInputValue:
			typeof candidate.taskSearchInputValue === 'string'
				? candidate.taskSearchInputValue
				: undefined,
		openedTaskPath:
			typeof candidate.openedTaskPath === 'string'
				? candidate.openedTaskPath
				: undefined,
		previewLeafId:
			typeof candidate.previewLeafId === 'string'
				? candidate.previewLeafId
				: undefined,
		activeTaskFilterTab: isTaskFilterTab(candidate.activeTaskFilterTab)
			? candidate.activeTaskFilterTab
			: undefined,
	};
}

function isIncompleteTaskStatus(
	statusKey: TaskFileEntry['status']['key'],
): boolean {
	return statusKey === 'todo' || statusKey === 'in-progress';
}

function getTaskDropValidationMessage(
	reason: 'self' | 'descendant' | 'missing',
): string {
	switch (reason) {
		case 'self':
			return t('view.notice.invalidDropSelf');
		case 'descendant':
			return t('view.notice.invalidDropDescendant');
		case 'missing':
			return t('view.notice.invalidDropUnavailable');
	}
}
