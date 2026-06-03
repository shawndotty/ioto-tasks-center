import type { TaskListGroupMode, TaskListSortMode } from '../settings';
import type { TaskFileEntry, TaskFileStatus } from '../tasks-center/types';

export interface TaskPresentationSection {
	key: string;
	label: string | null;
	tasks: TaskFileEntry[];
}

const STATUS_GROUP_ORDER: TaskFileStatus['key'][] = [
	'todo',
	'in-progress',
	'completed',
	'empty',
];

export function buildTaskPresentationSections(
	tasks: TaskFileEntry[],
	options: {
		sortMode: TaskListSortMode;
		groupMode: TaskListGroupMode;
	},
): TaskPresentationSection[] {
	const sortedTasks = sortTasksForPresentation(tasks, options.sortMode);
	return groupTasksForPresentation(
		sortedTasks,
		options.groupMode,
		options.sortMode,
	);
}

export function sortTasksForPresentation(
	tasks: TaskFileEntry[],
	sortMode: TaskListSortMode,
): TaskFileEntry[] {
	const sortedTasks = [...tasks];
	sortedTasks.sort((left, right) => compareTasks(left, right, sortMode));
	return sortedTasks;
}

export function groupTasksForPresentation(
	tasks: TaskFileEntry[],
	groupMode: TaskListGroupMode,
	sortMode: TaskListSortMode = 'created-desc',
): TaskPresentationSection[] {
	if (groupMode === 'none') {
		return [
			{
				key: 'all',
				label: null,
				tasks: [...tasks],
			},
		];
	}

	if (groupMode === 'priority') {
		return buildPrioritySections(tasks, sortMode);
	}

	const sections: TaskPresentationSection[] = [];
	for (const statusKey of STATUS_GROUP_ORDER) {
		const groupTasks = tasks.filter(
			(task) => task.status.key === statusKey,
		);
		if (groupTasks.length === 0) {
			continue;
		}

		sections.push({
			key: statusKey,
			label: getStatusGroupLabel(statusKey),
			tasks: groupTasks,
		});
	}
	return sections;
}

function compareTasks(
	left: TaskFileEntry,
	right: TaskFileEntry,
	sortMode: TaskListSortMode,
): number {
	switch (sortMode) {
		case 'created-desc':
			return (
				compareNumberDesc(left.ctime, right.ctime) ||
				compareName(left, right)
			);
		case 'created-asc':
			return (
				compareNumberAsc(left.ctime, right.ctime) ||
				compareName(left, right)
			);
		case 'updated-desc':
			return (
				compareNumberDesc(left.mtime, right.mtime) ||
				compareName(left, right)
			);
		case 'updated-asc':
			return (
				compareNumberAsc(left.mtime, right.mtime) ||
				compareName(left, right)
			);
		case 'name-desc':
			return compareName(right, left);
		case 'name-asc':
			return compareName(left, right);
		case 'priority-desc':
			return (
				comparePriority(left, right, 'desc') || compareName(left, right)
			);
		case 'priority-asc':
			return (
				comparePriority(left, right, 'asc') || compareName(left, right)
			);
	}
}

function compareNumberDesc(left: number, right: number): number {
	return right - left;
}

function compareNumberAsc(left: number, right: number): number {
	return left - right;
}

function compareName(left: TaskFileEntry, right: TaskFileEntry): number {
	return (
		left.basename.localeCompare(right.basename, 'zh-Hans-CN') ||
		left.path.localeCompare(right.path, 'zh-Hans-CN')
	);
}

function comparePriority(
	left: TaskFileEntry,
	right: TaskFileEntry,
	direction: 'desc' | 'asc',
): number {
	const leftPriority = left.priority;
	const rightPriority = right.priority;

	if (leftPriority === undefined && rightPriority === undefined) {
		return 0;
	}

	if (leftPriority === undefined) {
		return 1;
	}

	if (rightPriority === undefined) {
		return -1;
	}

	return direction === 'desc'
		? leftPriority - rightPriority
		: rightPriority - leftPriority;
}

function buildPrioritySections(
	tasks: TaskFileEntry[],
	sortMode: TaskListSortMode,
): TaskPresentationSection[] {
	const groupedTasks = new Map<number, TaskFileEntry[]>();
	const unsetTasks: TaskFileEntry[] = [];

	for (const task of tasks) {
		if (task.priority === undefined) {
			unsetTasks.push(task);
			continue;
		}

		const priorityTasks = groupedTasks.get(task.priority);
		if (priorityTasks) {
			priorityTasks.push(task);
			continue;
		}

		groupedTasks.set(task.priority, [task]);
	}

	const orderedPriorities = [...groupedTasks.keys()].sort((left, right) =>
		sortMode === 'priority-asc' ? right - left : left - right,
	);

	const sections = orderedPriorities.map((priority) => ({
		key: `priority-${priority}`,
		label: `P${priority}`,
		tasks: groupedTasks.get(priority) ?? [],
	}));

	if (unsetTasks.length > 0) {
		sections.push({
			key: 'priority-unset',
			label: '未设置优先级',
			tasks: unsetTasks,
		});
	}

	return sections;
}

function getStatusGroupLabel(statusKey: TaskFileStatus['key']): string {
	switch (statusKey) {
		case 'todo':
			return '待开始';
		case 'in-progress':
			return '进行中';
		case 'completed':
			return '已完成';
		case 'empty':
			return '无任务';
	}
}
