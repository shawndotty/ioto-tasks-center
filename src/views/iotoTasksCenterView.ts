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
	clearTaskFilePriority,
	setTaskFilePriority,
	TASK_PRIORITY_VALUES,
	type TaskPriorityValue,
} from '../tasks-center/task-priority';
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
import { buildVisibleTaskHierarchy } from './task-hierarchy';
import {
	buildTaskHoverPreviewPayload,
	hasActiveTaskHoverPopover,
	shouldTriggerTaskHoverPreview,
} from './task-hover-preview';
import { buildTaskPresentationSections } from './task-list-presentation';
import { filterTasksBySearchQuery } from './task-search';

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
	private activeTaskFilterTab: TaskFilterTab = 'today';
	private taskSearchQuery = '';
	private taskSearchInputValue = '';
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
	private pendingVaultRefresh = false;
	private deferredVaultRefreshTimer: number | null = null;
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
	private projectListScrollTop = 0;
	private refreshToken = 0;
	private resizeObserver: ResizeObserver | null = null;
	private readonly getTasksRootPath: () => string;
	private readonly getProjectListSortMode: () => ProjectListSortMode;
	private readonly getProjectListGroupMode: () => ProjectListGroupMode;
	private readonly getTaskListSortMode: () => TaskListSortMode;
	private readonly getTaskListGroupMode: () => TaskListGroupMode;
	private readonly getShowTaskPriority: () => boolean;
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
		this.startResizeObserver();
		await this.refreshFromVaultChange();
	}

	async onClose(): Promise<void> {
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
		this.activeTaskFilterTab = viewState.activeTaskFilterTab ?? 'today';
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
		await this.selectProject(nextProject);
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

	private async selectProject(projectName: string): Promise<void> {
		this.selectedProject = projectName;
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
		this.projectListScrollTop = captureProjectListScrollTop(
			this.contentEl,
			this.projectListScrollTop,
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

		this.renderTaskSearch(container);
		this.renderTaskTabs(container);

		const listEl = container.createDiv({
			cls: 'ioto-tasks-center__task-list',
		});

		if (this.projectResult.status === 'root-missing') {
			this.renderState(
				listEl,
				t('view.state.cannotLoadTasksTitle'),
				t('view.state.cannotLoadTasksDesc', [tasksRootPath]),
				'is-empty',
			);
			return;
		}

		if (!this.selectedProject) {
			this.renderState(
				listEl,
				t('view.state.selectProjectTitle'),
				t('view.state.selectProjectDesc'),
				'is-empty',
			);
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
			return;
		}

		if (!this.taskResult) {
			this.renderState(
				listEl,
				t('view.state.noTaskDataTitle'),
				t('view.state.noTaskDataDesc'),
				'is-empty',
			);
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
			return;
		}

		if (this.taskResult.status === 'empty') {
			this.renderState(
				listEl,
				t('view.state.emptyProjectTitle'),
				t('view.state.emptyProjectDesc', [this.taskResult.projectPath]),
				'is-empty',
			);
			return;
		}

		const tabVisibleTasks = this.getTasksForActiveTab();
		const visibleTasks = this.getVisibleTasks();
		if (visibleTasks.length === 0) {
			if (tabVisibleTasks.length === 0) {
				this.renderTaskFilterEmptyState(listEl);
				return;
			}

			this.renderTaskSearchEmptyState(listEl);
			return;
		}
		const presentationSections =
			this.getTaskPresentationSections(visibleTasks);
		this.syncCollapsedTaskGroups(presentationSections);
		const activeTaskPath = this.getActiveTaskPath();
		const removeZoneEl = listEl.createDiv({
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
	}

	private renderTaskRows(
		container: HTMLElement,
		tasks: TaskFileEntry[],
		activeTaskPath: string | null,
	): void {
		for (const task of tasks) {
			const rowEl = container.createEl('button', {
				cls: 'ioto-tasks-center__task-row',
			});
			rowEl.type = 'button';
			rowEl.draggable = !this.isUpdatingUpTask;
			rowEl.dataset.taskPath = task.path;
			rowEl.style.setProperty(
				'--ioto-task-indent-level',
				`${task.indentLevel ?? 0}`,
			);
			if ((task.indentLevel ?? 0) > 0) {
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

			rowEl.createDiv({
				cls: 'ioto-tasks-center__task-title',
				text: task.title,
			});
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
			const statusEl = rowEl.createSpan({
				cls: `ioto-tasks-center__task-status ioto-tasks-center__task-status--${task.status.key}`,
				text: task.status.label,
			});
			statusEl.ariaLabel = `任务状态：${task.status.label}`;

			rowEl.addEventListener('click', () => {
				void this.openTaskFile(task);
			});
			rowEl.addEventListener('mouseover', (event: MouseEvent) => {
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
		}
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
		return hasActiveTaskHoverPopover(this.hoverPreviewParent);
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

	private applyTaskSearchQuery(): void {
		const nextQuery = this.taskSearchInputValue;
		if (nextQuery === this.taskSearchQuery) {
			return;
		}

		this.taskSearchQuery = nextQuery;
		this.render();
	}

	private clearTaskSearch(): void {
		if (!this.taskSearchInputValue && !this.taskSearchQuery) {
			return;
		}

		this.taskSearchInputValue = '';
		this.taskSearchQuery = '';
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

		menu.showAtMouseEvent(event);
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
