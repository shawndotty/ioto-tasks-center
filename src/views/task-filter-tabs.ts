import type { TaskFileEntry } from '../tasks-center/types';

export type TaskFilterTab = 'today' | 'incomplete' | 'completed' | 'all';

export const TASK_FILTER_TABS: Array<{ key: TaskFilterTab; label: string }> = [
	{ key: 'today', label: '今天' },
	{ key: 'incomplete', label: '未完成' },
	{ key: 'completed', label: '已完成' },
	{ key: 'all', label: '全部' },
];

export function isTaskFilterTab(value: unknown): value is TaskFilterTab {
	return (
		value === 'today' ||
		value === 'incomplete' ||
		value === 'completed' ||
		value === 'all'
	);
}

export function getTaskFilterCounts(
	tasks: TaskFileEntry[],
	now: Date = new Date(),
): Record<TaskFilterTab, number> {
	return {
		today: tasks.filter((task) => matchesTaskFilterTab(task, 'today', now))
			.length,
		incomplete: tasks.filter((task) =>
			matchesTaskFilterTab(task, 'incomplete', now),
		).length,
		completed: tasks.filter((task) =>
			matchesTaskFilterTab(task, 'completed', now),
		).length,
		all: tasks.length,
	};
}

export function matchesTaskFilterTab(
	task: TaskFileEntry,
	tab: TaskFilterTab,
	now: Date = new Date(),
): boolean {
	if (tab === 'all') {
		return true;
	}

	if (tab === 'today') {
		return isTaskCreatedToday(task, now);
	}

	if (tab === 'completed') {
		return task.status.key === 'completed';
	}

	return isIncompleteTaskStatus(task.status.key);
}

export function isTaskCreatedToday(
	task: TaskFileEntry,
	now: Date = new Date(),
): boolean {
	return isSameLocalDate(new Date(task.ctime), now);
}

export function isSameLocalDate(left: Date, right: Date): boolean {
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}

function isIncompleteTaskStatus(
	statusKey: TaskFileEntry['status']['key'],
): boolean {
	return statusKey === 'todo' || statusKey === 'in-progress';
}
