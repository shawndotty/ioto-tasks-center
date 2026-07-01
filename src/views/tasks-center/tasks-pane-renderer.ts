import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { restoreTaskListScrollTop } from '../task-list-scroll';
import { buildVisibleTaskHierarchy } from '../task-hierarchy';
import { t } from '../../lang/helpter';
import { setIcon } from 'obsidian';

export function renderTasksPane(
	view: IOTOTasksCenterView,
	container: HTMLElement,
): void {
	const tasksRootPath = view.getTasksRootPath();
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
	const shouldShowSearchIcon = view.shouldShowTaskSearchIcon();
	let searchToggleButtonEl: HTMLButtonElement | null = null;
	if (shouldShowSearchIcon) {
		const keyword = view.taskSearchQuery.trim();
		if (!view.isTaskSearchPopoverOpen && keyword) {
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
				view.clearTaskSearch();
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

			view.toggleTaskSearchPopover(anchorEl);
		});
	} else {
		view.closeTaskSearchPopover();
	}
	const addTaskButtonEl = actionsEl.createEl('button', {
		cls: 'ioto-tasks-center__add-task-button',
		text: view.isCreatingTask
			? t('view.tasksPane.addTaskCreating')
			: t('view.tasksPane.addTask'),
	});
	addTaskButtonEl.type = 'button';
	addTaskButtonEl.disabled = !view.canCreateTask();
	addTaskButtonEl.ariaLabel = view.getAddTaskButtonLabel();
	addTaskButtonEl.title = view.getAddTaskButtonLabel();
	addTaskButtonEl.addEventListener('click', (event) => {
		void view.showTaskCreationMenu(event);
	});

	const currentProjectText = view.getTaskListDescription();
	container.createDiv({
		cls: 'ioto-tasks-center__section-desc',
		text: currentProjectText,
	});

	if (shouldShowSearchIcon && view.isTaskSearchPopoverOpen) {
		if (searchToggleButtonEl) {
			view.openTaskSearchPopover(searchToggleButtonEl, false);
		}
	}
	view.renderTaskTabs(container);

	const listEl = container.createDiv({
		cls: 'ioto-tasks-center__task-list',
	});
	listEl.toggleClass(
		'ioto-tasks-center--task-link-badge-multicolor',
		view.getTaskLinkBadgeBackgroundMode() === 'multicolor',
	);
	listEl.toggleClass(
		'ioto-tasks-center--task-link-badge-monochrome',
		view.getTaskLinkBadgeBackgroundMode() === 'monochrome',
	);
	listEl.addEventListener('scroll', () => {
		view.taskListScrollTop = listEl.scrollTop;
	});
	listEl.toggleClass(
		'has-remove-up-task-drop-zone',
		Boolean(view.draggingTaskPath),
	);

	if (view.projectResult.status === 'root-missing') {
		view.renderState(
			listEl,
			t('view.state.cannotLoadTasksTitle'),
			t('view.state.cannotLoadTasksDesc', [tasksRootPath]),
			'is-empty',
		);
		restoreTaskListScrollTop(listEl, view.taskListScrollTop);
		return;
	}

	if (!view.selectedProject) {
		view.renderState(
			listEl,
			t('view.state.selectProjectTitle'),
			t('view.state.selectProjectDesc'),
			'is-empty',
		);
		restoreTaskListScrollTop(listEl, view.taskListScrollTop);
		return;
	}

	if (view.isTasksLoading) {
		view.renderState(
			listEl,
			t('view.state.loadingTasksTitle'),
			t('view.state.loadingTasksDesc', [
				tasksRootPath,
				view.selectedProject,
			]),
			'is-loading',
		);
		restoreTaskListScrollTop(listEl, view.taskListScrollTop);
		return;
	}

	if (!view.taskResult) {
		view.renderState(
			listEl,
			t('view.state.noTaskDataTitle'),
			t('view.state.noTaskDataDesc'),
			'is-empty',
		);
		restoreTaskListScrollTop(listEl, view.taskListScrollTop);
		return;
	}

	if (view.taskResult.status === 'project-missing') {
		view.renderState(
			listEl,
			t('view.state.projectMissingTitle'),
			t('view.state.projectMissingDesc', [
				view.taskResult.projectPath,
			]),
			'is-empty',
		);
		restoreTaskListScrollTop(listEl, view.taskListScrollTop);
		return;
	}

	if (view.taskResult.status === 'empty') {
		view.renderState(
			listEl,
			t('view.state.emptyProjectTitle'),
			t('view.state.emptyProjectDesc', [view.taskResult.projectPath]),
			'is-empty',
		);
		restoreTaskListScrollTop(listEl, view.taskListScrollTop);
		return;
	}

	const tabVisibleTasks = view.getTasksForActiveTab();
	const visibleTasks = view.getVisibleTasks();
	if (visibleTasks.length === 0) {
		if (tabVisibleTasks.length === 0) {
			view.renderTaskFilterEmptyState(listEl);
			restoreTaskListScrollTop(listEl, view.taskListScrollTop);
			return;
		}

		view.renderTaskSearchEmptyState(listEl);
		restoreTaskListScrollTop(listEl, view.taskListScrollTop);
		return;
	}
	const presentationSections =
		view.getTaskPresentationSections(visibleTasks);
	view.syncCollapsedTaskGroups(presentationSections);
	const activeTaskPath = view.getActiveTaskPath();
	const removeZoneWrapperEl = listEl.createDiv({
		cls: 'ioto-tasks-center__remove-up-task-drop-zone-wrapper',
	});
	const removeZoneEl = removeZoneWrapperEl.createDiv({
		cls: 'ioto-tasks-center__remove-up-task-drop-zone',
	});
	if (view.isRemoveUpTaskDropTarget) {
		removeZoneEl.addClass('is-drop-target');
	}
	removeZoneEl.setText(t('view.removeParentDropZone'));
	removeZoneEl.addEventListener('dragover', (event) => {
		view.handleRemoveUpTaskDragOver(event, removeZoneEl);
	});
	removeZoneEl.addEventListener('dragleave', (event) => {
		view.handleRemoveUpTaskDragLeave(event, removeZoneEl);
	});
	removeZoneEl.addEventListener('drop', (event) => {
		void view.handleRemoveUpTaskDrop(event, removeZoneEl);
	});

	const directChildTasksByParentPath = view.getShowTaskSubtaskCount()
		? view.buildDirectChildTasksForCurrentProject()
		: null;

	for (const section of presentationSections) {
		const sectionEl = listEl.createDiv({
			cls: 'ioto-tasks-center__task-group',
		});
		if (!section.label) {
			view.renderTaskRows(
				sectionEl,
				buildVisibleTaskHierarchy(section.tasks),
				activeTaskPath,
				directChildTasksByParentPath,
			);
			continue;
		}

		const collapsed = view.isTaskGroupCollapsed(section.key);
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
			view.toggleTaskGroupCollapsed(section.key);
		});

		const groupBodyEl = sectionEl.createDiv({
			cls: 'ioto-tasks-center__task-group-body',
		});
		groupBodyEl.id = groupBodyId;
		groupBodyEl.toggleClass('is-hidden', collapsed);
		if (collapsed) {
			continue;
		}

		view.renderTaskRows(
			groupBodyEl,
			buildVisibleTaskHierarchy(section.tasks),
			activeTaskPath,
			directChildTasksByParentPath,
		);
	}

	restoreTaskListScrollTop(listEl, view.taskListScrollTop);
}
