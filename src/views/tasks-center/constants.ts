import type { WorkspaceLeaf } from 'obsidian';
import type {
	ProjectListGroupMode,
	ProjectListSortMode,
	TaskListGroupMode,
	TaskListSortMode,
} from '../../settings';
import type { TaskFileEntry } from '../../tasks-center/types';
import type { TaskFilterTab } from '../task-filter-tabs';
import { isTaskFilterTab } from '../task-filter-tabs';
import { t } from '../../lang/helpter';

export const COMPACT_LAYOUT_BREAKPOINT = 720;
export const HOVER_PREVIEW_REFRESH_RETRY_MS = 150;

export interface IOTOTasksCenterViewState {
	selectedProject?: string;
	activeTaskFilterTab?: TaskFilterTab;
	taskSearchQuery?: string;
	taskSearchInputValue?: string;
	openedTaskPath?: string;
	previewLeafId?: string;
}

export const PROJECT_LIST_SORT_MODE_ORDER: ProjectListSortMode[] = [
	'incomplete-count',
	'incomplete-count-asc',
	'name',
	'name-desc',
];

export const PROJECT_LIST_GROUP_MODE_ORDER: ProjectListGroupMode[] = [
	'none',
	'category',
];

export const TASK_LIST_SORT_MODE_ORDER: TaskListSortMode[] = [
	'created-desc',
	'created-asc',
	'updated-desc',
	'updated-asc',
	'name-asc',
	'name-desc',
	'priority-desc',
	'priority-asc',
];

export const TASK_LIST_GROUP_MODE_ORDER: TaskListGroupMode[] = [
	'none',
	'status',
	'priority',
];

export function getWorkspaceLeafId(leaf: WorkspaceLeaf | null): string | null {
	if (!leaf) {
		return null;
	}

	const candidate = leaf as WorkspaceLeaf & { id?: unknown };
	return typeof candidate.id === 'string' ? candidate.id : null;
}

export function parseViewState(state: unknown): IOTOTasksCenterViewState {
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

export function isIncompleteTaskStatus(
	statusKey: TaskFileEntry['status']['key'],
): boolean {
	return statusKey === 'todo' || statusKey === 'in-progress';
}

export function getTaskDropValidationMessage(
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
