import type { TaskFileEntry } from '../../tasks-center/types';
import type { TaskListTimeFilter } from '../../settings';

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const TWO_WEEKS_MS = 14 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

function getThreshold(filter: TaskListTimeFilter): number {
	const now = Date.now();
	switch (filter) {
		case 'created-week':
		case 'updated-week':
			return now - WEEK_MS;
		case 'created-two-weeks':
		case 'updated-two-weeks':
			return now - TWO_WEEKS_MS;
		case 'created-month':
		case 'updated-month':
			return now - MONTH_MS;
		default:
			return 0;
	}
}

export function filterTasksByTime(
	tasks: TaskFileEntry[],
	filter: TaskListTimeFilter,
): TaskFileEntry[] {
	if (filter === 'none') {
		return tasks;
	}

	const threshold = getThreshold(filter);
	const useCTime = filter.startsWith('created');

	return tasks.filter((task) => {
		const time = useCTime ? task.ctime : task.mtime;
		return time >= threshold;
	});
}
