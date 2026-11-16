import type { TaskFileEntry } from '../../tasks-center/types';
import {
	isTaskInTimeBounds,
	resolveTaskTimeBounds,
} from '../../tasks-center/task-time-range';
import type { TaskListTimeFilter } from '../../settings-types';

/**
 * 任务中心时间筛选：预设边界统一委托 `tasks-center/task-time-range`，
 * 两处口径只保留一份实现（[[Plan-20261116-083330]] §3.1）。
 */
export function filterTasksByTime(
	tasks: TaskFileEntry[],
	filter: TaskListTimeFilter,
): TaskFileEntry[] {
	if (filter === 'none') {
		return tasks;
	}

	const bounds = resolveTaskTimeBounds(
		{ kind: 'preset', value: filter },
		Date.now(),
	);
	if (!bounds) return tasks;
	return tasks.filter((task) => isTaskInTimeBounds(task, bounds));
}
