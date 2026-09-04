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
export const NARROW_LAYOUT_BREAKPOINT = 480;
export const HOVER_PREVIEW_REFRESH_RETRY_MS = 150;

// 移动端 / 紧凑布局下的统一手势引擎参数（见 touch-gesture.ts）。
// 长按超过该时长且手指未移动 → 弹出任务属性菜单（替代桌面右键）。
export const TASK_ROW_LONG_PRESS_MS = 400;
// 手指位移超过该阈值（px）→ 判定为拖拽（重设父任务），并取消菜单定时器。
export const TASK_ROW_DRAG_MOVE_THRESHOLD = 10;

export interface IOTOTasksCenterViewState {
	selectedProject?: string;
	activeTaskFilterTab?: TaskFilterTab;
	taskSearchQuery?: string;
	taskSearchInputValue?: string;
	openedTaskPath?: string;
	previewLeafId?: string;
	taskListHeaderExpanded?: boolean;
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
		taskListHeaderExpanded:
			typeof candidate.taskListHeaderExpanded === 'boolean'
				? candidate.taskListHeaderExpanded
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
