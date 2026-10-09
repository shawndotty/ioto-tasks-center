import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type { TaskFileEntry } from '../../tasks-center/types';
import { matchesTaskFilterTab } from '../task-filter-tabs';
import { toggleSetMember } from './helpers';
import { filterTasksByTime } from './task-time-filter';
import {
	buildTaskPresentationSections,
	sortTasksForPresentation,
} from '../task-list-presentation';
import {
	buildDirectChildTasksByParentPath,
	buildVisibleTaskHierarchy,
} from '../task-hierarchy';
import {
	getTaskListGroupModeOptions,
	getTaskListSortModeOptions,
	getTaskListTimeFilterOptions,
} from '../../settings';
import { t } from '../../lang/helpter';

export function getTasksForActiveTab(view: IOTOTasksCenterView): TaskFileEntry[] {
	return view.tasks.filter((task) =>
		matchesTaskFilterTab(task, view.activeTaskFilterTab),
	);
}

export function getVisibleTasks(view: IOTOTasksCenterView): TaskFileEntry[] {
	const byTab = view.getTasksForActiveTab();
	const bySearch = view.applyTaskSearch(byTab);
	return filterTasksByTime(bySearch, view.getTaskListTimeFilter());
}

export function getTaskPresentationSections(
	view: IOTOTasksCenterView,
	tasks: TaskFileEntry[],
) {
	return buildTaskPresentationSections(tasks, {
		sortMode: view.taskSearchQuery.trim()
			? 'relevance'
			: view.getTaskListSortMode(),
		groupMode: view.getTaskListGroupMode(),
	});
}

export function isTaskGroupCollapsed(
	view: IOTOTasksCenterView,
	sectionKey: string,
): boolean {
	return view.collapsedTaskGroups.has(sectionKey);
}

export function isProjectGroupCollapsed(
	view: IOTOTasksCenterView,
	groupKey: string,
): boolean {
	return view.collapsedProjectGroups.has(groupKey);
}

export function toggleTaskGroupCollapsed(
	view: IOTOTasksCenterView,
	sectionKey: string,
): void {
	toggleSetMember(view.collapsedTaskGroups, sectionKey);
	view.render();
}

export function toggleProjectGroupCollapsed(
	view: IOTOTasksCenterView,
	groupKey: string,
): void {
	toggleSetMember(view.collapsedProjectGroups, groupKey);
	view.render();
}

export function isSubtasksCollapsed(
	view: IOTOTasksCenterView,
	taskPath: string,
): boolean {
	return view.collapsedSubtaskParents.has(taskPath);
}

export function toggleSubtasksCollapsed(
	view: IOTOTasksCenterView,
	taskPath: string,
): void {
	toggleSetMember(view.collapsedSubtaskParents, taskPath);
	view.render();
}

export function toggleBatchEditMode(view: IOTOTasksCenterView): void {
	view.isBatchEditMode = !view.isBatchEditMode;
	if (!view.isBatchEditMode) {
		view.selectedTaskPaths.clear();
	}
	view.render();
}

export function toggleTaskSelected(
	view: IOTOTasksCenterView,
	taskPath: string,
): void {
	toggleSetMember(view.selectedTaskPaths, taskPath);
	view.render();
}

export function getSelectedTasks(view: IOTOTasksCenterView): TaskFileEntry[] {
	return view.tasks.filter((task) =>
		view.selectedTaskPaths.has(task.path),
	);
}

export function selectAllVisibleTasks(view: IOTOTasksCenterView): void {
	const visibleTasks = view.getVisibleTasks();
	const allSelected = visibleTasks.every((task) =>
		view.selectedTaskPaths.has(task.path),
	);
	view.selectedTaskPaths.clear();
	if (!allSelected) {
		for (const task of visibleTasks) {
			view.selectedTaskPaths.add(task.path);
		}
	}
	view.render();
}

export function clearSelection(view: IOTOTasksCenterView): void {
	view.selectedTaskPaths.clear();
	view.render();
}

export function syncCollapsedTaskGroups(
	view: IOTOTasksCenterView,
	sections: Array<{ key: string; label: string | null }>,
): void {
	const groupMode = view.getTaskListGroupMode();
	if (groupMode === 'none') {
		view.collapsedTaskGroups.clear();
		return;
	}

	const validKeys = new Set(
		sections
			.filter((section) => section.label)
			.map((section) => section.key),
	);
	for (const key of [...view.collapsedTaskGroups]) {
		if (!validKeys.has(key)) {
			view.collapsedTaskGroups.delete(key);
		}
	}
}

export function syncCollapsedProjectGroups(
	view: IOTOTasksCenterView,
	sections: Array<{ groupKey: string }>,
): void {
	const groupMode = view.getProjectListGroupMode();
	if (groupMode === 'none') {
		view.collapsedProjectGroups.clear();
		return;
	}

	const validKeys = new Set(sections.map((section) => section.groupKey));
	for (const key of [...view.collapsedProjectGroups]) {
		if (!validKeys.has(key)) {
			view.collapsedProjectGroups.delete(key);
		}
	}
}

export function getTaskListDescription(view: IOTOTasksCenterView): string {
	const taskListSortModeOptions = getTaskListSortModeOptions();
	const taskListGroupModeOptions = getTaskListGroupModeOptions();
	if (!view.selectedProject) {
		return t('view.description.noneSelected');
	}

	const sortDescription =
		taskListSortModeOptions[view.getTaskListSortMode()];
	const groupMode = view.getTaskListGroupMode();
	const groupDescription =
		groupMode === 'none'
			? ''
			: t('view.description.groupPrefix', [
					taskListGroupModeOptions[groupMode],
				]);
	const priorityDescription = view.getShowTaskPriority()
		? t('view.description.priorityVisible')
		: '';
	const timeFilter = view.getTaskListTimeFilter();
	const timeFilterOpts = getTaskListTimeFilterOptions();
	const timeFilterDescription =
		timeFilter !== 'none'
			? t('view.description.timeFilter', [timeFilterOpts[timeFilter]])
			: '';
	const searchSummary = view.getTaskSearchSummary();
	const searchDescription = searchSummary
		? t('view.description.search', [
				String(searchSummary.matched),
				String(searchSummary.total),
			])
		: '';
	return `${t('view.description.currentProject', [
		view.selectedProject,
		String(view.tasks.length),
		sortDescription,
		groupDescription,
		priorityDescription,
		timeFilterDescription,
	])}${searchDescription}`;
}

export function buildDirectChildTasksForCurrentProject(
	view: IOTOTasksCenterView,
): Map<string, TaskFileEntry[]> {
	const orderedTasks = buildVisibleTaskHierarchy(
		sortTasksForPresentation(view.tasks, view.getTaskListSortMode()),
	);
	return buildDirectChildTasksByParentPath(orderedTasks);
}
