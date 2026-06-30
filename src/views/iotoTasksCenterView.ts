import {
	FileView,
	type HoverPopover,
	ItemView,
	MarkdownView,
	Menu,
	Notice,
	setIcon,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';

import { getIncompleteChecklistItems } from '../tasks-center/data';
import { PROJECT_METADATA_FILE_NAME } from '../tasks-center/project-metadata';

import {
	countTaskOutlinksByRootPaths,
	groupTaskOutlinksByRootPaths,
} from '../tasks-center/task-outlink-counts';
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
	type TaskOutlinkPopoverItem,
} from '../ui/task-outlink-popover';
import {
	TaskStatusChecklistPopover,
	type TaskStatusChecklistPopoverItem,
	truncateChecklistPreview,
} from '../ui/task-status-checklist-popover';
import { TaskSearchPopover } from '../ui/task-search-popover';
import {
	resolveActiveTaskPath,
	shouldSkipOpeningTask,
} from './task-preview-state';
import { validateTaskParentDrop } from './task-drag';
import {
	handleTaskDragStart,
	handleTaskDragOver,
	handleTaskDragLeave,
	setCurrentDropTarget,
	clearTaskDragState,
	getTaskRowElements,
	findTaskRowByPath,
	assignDraggedTaskToParent,
	handleRemoveUpTaskDragOver,
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
} from './tasks-center/data-loader';
import {
	triggerBatchCreateFromTemplate,
	executeBatchCreate,
	canCreateTask,
	getAddTaskButtonLabel,
	handleCreateProject,
	handleCreateTask,
	handleCreateSubtask,
	applyCreatedTaskSettings,
	updateTaskPriority,
	clearTaskPriority,
	updateTaskStarred,
	clearTaskStarred,
	confirmAndDeleteTask,
} from './tasks-center/task-operations';
import { buildProjectListSections } from './project-list-group';
import {
	captureProjectListScrollTop,
	restoreProjectListScrollTop,
} from './project-list-scroll';
import {
	captureTaskListScrollTop,
	restoreTaskListScrollTop,
} from './task-list-scroll';
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
	getTaskDropValidationMessage,
	getWorkspaceLeafId,
	HOVER_PREVIEW_REFRESH_RETRY_MS,
	parseViewState,
} from './tasks-center/constants';
import {
	isLeafAvailable,
	findLeafByFilePath,
	findLeafById,
} from './tasks-center/preview-leaf';
import {
	getTaskCreationOptions,
	buildProjectGroupBodyId,
	getTaskPriorityClassName,
} from './tasks-center/helpers';
import {
	showProjectContextMenu,
	showProjectPresentationMenu,
	showTaskPresentationMenu,
	showTaskPriorityMenu,
	showTaskSubtaskTypeMenu,
} from './tasks-center/menus';

export const IOTO_TASKS_CENTER_VIEW_TYPE = 'IOTOTasksCenter';

export class IOTOTasksCenterView extends ItemView {
	projects: ProjectFolderEntry[] = [];
	projectIncompleteCounts = new Map<string, number>();
	projectCategoryByName = new Map<string, string>();
	public selectedProject: string | null = null;
	public tasks: TaskFileEntry[] = [];
	private activeTaskFilterTab: TaskFilterTab = 'core';
	public taskSearchQuery = '';
	public taskSearchInputValue = '';
	public isTaskSearchPopoverOpen = false;
	public shouldFocusTaskSearchPopover = false;
	openedTaskPath: string | null = null;
	private openingTaskPath: string | null = null;
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
	private readonly pendingOutlinkBadgeUpdates = new Set<string>();
	private outlinkBadgeUpdateTimer: number | null = null;
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
	private projectListScrollTop = 0;
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
	private readonly getInputRootPath: () => string;
	private readonly getOutputRootPath: () => string;
	private readonly getOutcomeRootPath: () => string;
	private readonly getShowTaskSubtaskCount: () => boolean;
	private readonly getTaskLinkBadgeBackgroundMode: () => TaskLinkBadgeBackgroundMode;
	private readonly getShowTaskOutlinkCounts: () => boolean;
	private readonly getShowTaskInputOutlinkCount: () => boolean;
	private readonly getShowTaskOutputOutlinkCount: () => boolean;
	private readonly getShowTaskOutcomeOutlinkCount: () => boolean;
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
					const countEl = itemEl.createEl('button', {
						cls: 'ioto-tasks-center__project-count',
					});
					countEl.type = 'button';
					countEl.textContent = `${incompleteCount}`;
					countEl.ariaLabel = t('view.incompleteCount');
					countEl.addEventListener('click', (event: MouseEvent) => {
						event.preventDefault();
						event.stopPropagation();

						const switchToIncompleteTab = (): void => {
							if (this.activeTaskFilterTab !== 'incomplete') {
								this.activeTaskFilterTab = 'incomplete';
								this.render();
							}
						};

						if (
							project.name === this.selectedProject ||
							this.isTasksLoading
						) {
							switchToIncompleteTab();
							return;
						}

						void this.selectProject(project.name).then(
							switchToIncompleteTab,
						);
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
				itemEl.addEventListener('contextmenu', (event: MouseEvent) => {
					event.preventDefault();
					event.stopPropagation();
					this.showProjectContextMenu(event, project);
				});
			}
		}

		restoreProjectListScrollTop(listEl, this.projectListScrollTop);
	}

	private showProjectContextMenu(
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
		listEl.toggleClass(
			'ioto-tasks-center--task-link-badge-multicolor',
			this.getTaskLinkBadgeBackgroundMode() === 'multicolor',
		);
		listEl.toggleClass(
			'ioto-tasks-center--task-link-badge-monochrome',
			this.getTaskLinkBadgeBackgroundMode() === 'monochrome',
		);
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

		const directChildTasksByParentPath = this.getShowTaskSubtaskCount()
			? this.buildDirectChildTasksForCurrentProject()
			: null;

		for (const section of presentationSections) {
			const sectionEl = listEl.createDiv({
				cls: 'ioto-tasks-center__task-group',
			});
			if (!section.label) {
				this.renderTaskRows(
					sectionEl,
					buildVisibleTaskHierarchy(section.tasks),
					activeTaskPath,
					directChildTasksByParentPath,
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
				directChildTasksByParentPath,
			);
		}

		restoreTaskListScrollTop(listEl, this.taskListScrollTop);
	}

	private renderTaskRows(
		container: HTMLElement,
		tasks: TaskFileEntry[],
		activeTaskPath: string | null,
		directChildTasksByParentPath: ReadonlyMap<
			string,
			TaskFileEntry[]
		> | null,
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
			if (this.getShowTaskSubtaskCount()) {
				const childTasks =
					directChildTasksByParentPath?.get(task.path) ?? [];
				if (childTasks.length > 0) {
					const badgeEl = titleEl.createSpan({
						cls: 'ioto-tasks-center__task-outlink-count ioto-tasks-center__task-subtask-count',
						text: String(childTasks.length),
					});
					badgeEl.ariaLabel = t('task.subtasks.badge', [
						String(childTasks.length),
					]);
					this.bindTaskSubtaskPopover(badgeEl, childTasks);
				}
			}
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
					const badgeEntries: Array<{
						category: TaskOutlinkCategory;
						value: number;
						label: string;
					}> = [];
					if (showInput && counts.input > 0) {
						badgeEntries.push({
							category: 'input',
							value: counts.input,
							label: t('task.outlinks.input', [
								String(counts.input),
							]),
						});
					}
					if (showOutput && counts.output > 0) {
						badgeEntries.push({
							category: 'output',
							value: counts.output,
							label: t('task.outlinks.output', [
								String(counts.output),
							]),
						});
					}
					if (showOutcome && counts.outcome > 0) {
						badgeEntries.push({
							category: 'outcome',
							value: counts.outcome,
							label: t('task.outlinks.outcome', [
								String(counts.outcome),
							]),
						});
					}

					if (badgeEntries.length > 0) {
						const countersEl = titleEl.createSpan({
							cls: 'ioto-tasks-center__task-outlink-counts',
						});
						for (const entry of badgeEntries) {
							const badgeEl = countersEl.createSpan({
								cls: 'ioto-tasks-center__task-outlink-count',
								text: String(entry.value),
							});
							badgeEl.dataset.outlinkCategory = entry.category;
							badgeEl.ariaLabel = entry.label;
							this.bindTaskOutlinkPopover(
								badgeEl,
								task.path,
								entry.category,
							);
						}
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
			if (
				task.status.key === 'todo' ||
				task.status.key === 'in-progress'
			) {
				this.bindTaskStatusChecklistPopover(statusEl, task);
			}

			rowEl.addEventListener('click', () => {
				void this.openTaskFile(task);
			});
			rowEl.addEventListener('mouseover', (event: MouseEvent) => {
				const target = event.target;
				if (
					target instanceof HTMLElement &&
					(target.closest('.ioto-tasks-center__task-outlink-count') ||
						target.closest('.ioto-tasks-center__task-status'))
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

	private buildDirectChildTasksForCurrentProject(): Map<
		string,
		TaskFileEntry[]
	> {
		const orderedTasks = buildVisibleTaskHierarchy(
			sortTasksForPresentation(this.tasks, this.getTaskListSortMode()),
		);
		return buildDirectChildTasksByParentPath(orderedTasks);
	}

	private bindTaskSubtaskPopover(
		badgeEl: HTMLElement,
		childTasks: TaskFileEntry[],
	): void {
		const popover = this.outlinkPopover;
		if (!popover) {
			return;
		}

		badgeEl.addEventListener('mouseenter', (event) => {
			event.stopPropagation();
			const items = this.getTaskSubtaskPopoverItems(childTasks);
			popover.open({
				anchorEl: badgeEl,
				categoryTitle: t('task.subtasks.popover.title'),
				emptyText: t('task.subtasks.popover.empty'),
				items,
				onItemClick: (file) => {
					void this.openFileInPreview(file);
				},
			});
		});
		badgeEl.addEventListener('mouseleave', (event) => {
			event.stopPropagation();
			popover.scheduleClose();
		});
	}

	private getTaskSubtaskPopoverItems(
		childTasks: TaskFileEntry[],
	): TaskOutlinkPopoverItem[] {
		const items: TaskOutlinkPopoverItem[] = [];
		for (const task of childTasks) {
			const file = this.app.vault.getAbstractFileByPath(task.path);
			if (!(file instanceof TFile)) {
				continue;
			}

			items.push({
				path: task.path,
				title: task.title,
				file,
			});
		}

		return items;
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

	private bindTaskStatusChecklistPopover(
		badgeEl: HTMLElement,
		task: TaskFileEntry,
	): void {
		const popover = this.taskStatusChecklistPopover;
		if (!popover) {
			return;
		}

		badgeEl.addEventListener('mouseenter', (event) => {
			event.stopPropagation();
			void this.openTaskStatusChecklistPopover(badgeEl, task, popover);
		});
		badgeEl.addEventListener('mouseleave', (event) => {
			event.stopPropagation();
			popover.scheduleClose();
		});
	}

	private async openTaskStatusChecklistPopover(
		badgeEl: HTMLElement,
		task: TaskFileEntry,
		popover: TaskStatusChecklistPopover,
	): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			return;
		}

		const items = (await getIncompleteChecklistItems(this.app, file)).map(
			(item): TaskStatusChecklistPopoverItem => ({
				...item,
				displayText: truncateChecklistPreview(item.text),
			}),
		);
		popover.open({
			anchorEl: badgeEl,
			title: this.getTaskStatusChecklistPopoverTitle(task.status.key),
			emptyText: t('task.status.popover.empty'),
			items,
			onItemClick: (item) => {
				void this.openTaskFileAtChecklist(task.path, item);
			},
		});
	}

	private getTaskStatusChecklistPopoverTitle(
		statusKey: TaskFileEntry['status']['key'],
	): string {
		switch (statusKey) {
			case 'todo':
				return t('task.status.popover.todoTitle');
			case 'in-progress':
				return t('task.status.popover.inProgressTitle');
			default:
				return t('task.status.popover.empty');
		}
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

		const titleEl = rowEl.querySelector<HTMLElement>(
			'.ioto-tasks-center__task-title',
		);
		if (!titleEl) {
			return;
		}

		const showInput = this.getShowTaskInputOutlinkCount();
		const showOutput = this.getShowTaskOutputOutlinkCount();
		const showOutcome = this.getShowTaskOutcomeOutlinkCount();

		const resolvedLinks = this.app.metadataCache.resolvedLinks?.[taskPath];
		const counts = countTaskOutlinksByRootPaths(resolvedLinks, {
			inputRootPath: this.getInputRootPath(),
			outputRootPath: this.getOutputRootPath(),
			outcomeRootPath: this.getOutcomeRootPath(),
		});
		this.syncTaskOutlinkBadge(
			titleEl,
			taskPath,
			'input',
			showInput,
			counts.input,
		);
		this.syncTaskOutlinkBadge(
			titleEl,
			taskPath,
			'output',
			showOutput,
			counts.output,
		);
		this.syncTaskOutlinkBadge(
			titleEl,
			taskPath,
			'outcome',
			showOutcome,
			counts.outcome,
		);

		this.cleanupTaskOutlinkCountsContainer(titleEl);
	}

	private syncTaskOutlinkBadge(
		titleEl: HTMLElement,
		taskPath: string,
		category: TaskOutlinkCategory,
		enabled: boolean,
		value: number,
	): void {
		const badgeEl = titleEl.querySelector<HTMLElement>(
			`.ioto-tasks-center__task-outlink-count[data-outlink-category="${category}"]`,
		);

		if (!enabled || value <= 0) {
			badgeEl?.remove();
			return;
		}

		const label = this.getTaskOutlinkBadgeLabel(category, value);
		if (badgeEl) {
			badgeEl.textContent = String(value);
			badgeEl.ariaLabel = label;
			badgeEl.removeAttribute('title');
			return;
		}

		const countersEl =
			titleEl.querySelector<HTMLElement>(
				'.ioto-tasks-center__task-outlink-counts',
			) ??
			titleEl.createSpan({
				cls: 'ioto-tasks-center__task-outlink-counts',
			});
		const newBadgeEl = countersEl.createSpan({
			cls: 'ioto-tasks-center__task-outlink-count',
			text: String(value),
		});
		newBadgeEl.dataset.outlinkCategory = category;
		newBadgeEl.ariaLabel = label;
		this.bindTaskOutlinkPopover(newBadgeEl, taskPath, category);
	}

	private cleanupTaskOutlinkCountsContainer(titleEl: HTMLElement): void {
		const countersEl = titleEl.querySelector<HTMLElement>(
			'.ioto-tasks-center__task-outlink-counts',
		);
		if (!countersEl) {
			return;
		}

		if (
			countersEl.querySelector(
				'.ioto-tasks-center__task-outlink-count[data-outlink-category]',
			)
		) {
			return;
		}

		countersEl.remove();
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

	private canCreateTask(): boolean {
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

	private shouldShowTaskSearchIcon(): boolean {
		return SearchController.shouldShowTaskSearchIcon(this);
	}

	private toggleTaskSearchPopover(anchorEl: HTMLElement): void {
		SearchController.toggleTaskSearchPopover(this, anchorEl);
	}

	private openTaskSearchPopover(
		anchorEl: HTMLElement,
		forceFocus: boolean,
	): void {
		SearchController.openTaskSearchPopover(this, anchorEl, forceFocus);
	}

	private closeTaskSearchPopover(): void {
		SearchController.closeTaskSearchPopover(this);
	}

	private applyTaskSearchQuery(): void {
		SearchController.applyTaskSearchQuery(this);
	}

	private clearTaskSearch(): void {
		SearchController.clearTaskSearch(this);
	}

	private handleTaskDragStart(
		event: DragEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		handleTaskDragStart(this, event, task, rowEl);
	}

	private handleTaskDragOver(
		event: DragEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		handleTaskDragOver(this, event, task, rowEl);
	}

	private handleTaskDragLeave(
		event: DragEvent,
		task: TaskFileEntry,
		rowEl: HTMLButtonElement,
	): void {
		handleTaskDragLeave(this, event, task, rowEl);
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
		setCurrentDropTarget(this, taskPath, invalid, rowEl);
	}

	private clearTaskDragState(): void {
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

	private handleRemoveUpTaskDragOver(
		event: DragEvent,
		dropZoneEl: HTMLDivElement,
	): void {
		handleRemoveUpTaskDragOver(this, event, dropZoneEl);
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

	private getAddTaskButtonLabel(): string {
		return getAddTaskButtonLabel(this);
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
		return handleCreateProject(this);
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
		const byTab = this.getTasksForActiveTab();
		const bySearch = filterTasksBySearchQuery(byTab, this.taskSearchQuery);
		return filterTasksByTime(bySearch, this.getTaskListTimeFilter());
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
		showProjectPresentationMenu(this, event);
	}

	private showTaskPresentationMenu(event: MouseEvent): void {
		showTaskPresentationMenu(this, event);
	}

	private showTaskPriorityMenu(event: MouseEvent, task: TaskFileEntry): void {
		showTaskPriorityMenu(this, event, task);
	}

	showTaskSubtaskTypeMenu(
		event: MouseEvent,
		parentTask: TaskFileEntry,
		enabledTypes: TaskCreationType[],
	): void {
		showTaskSubtaskTypeMenu(this, event, parentTask, enabledTypes);
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
		return getCachedTaskPath(this, projectName);
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

	private async openTaskFileAtChecklist(
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

	getPreviewLeafFilePath(): string | null {
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

	ensurePreviewLeaf(): WorkspaceLeaf {
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
