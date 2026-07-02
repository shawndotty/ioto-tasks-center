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

function getCalendarRangeStart(filter: TaskListTimeFilter, now: Date): number {
	const isWeek = filter.endsWith('calendar-week');
	const year = now.getFullYear();
	const month = now.getMonth();
	const date = now.getDate();

	if (isWeek) {
		const dayOfWeek = now.getDay();
		const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
		return new Date(year, month, date + mondayOffset).getTime();
	}

	return new Date(year, month, 1).getTime();
}

export function filterTasksByTime(
	tasks: TaskFileEntry[],
	filter: TaskListTimeFilter,
): TaskFileEntry[] {
	if (filter === 'none') {
		return tasks;
	}

	const useCTime = filter.startsWith('created');

	if (
		filter === 'created-calendar-week' ||
		filter === 'created-calendar-month' ||
		filter === 'updated-calendar-week' ||
		filter === 'updated-calendar-month'
	) {
		const rangeStart = getCalendarRangeStart(filter, new Date());
		return tasks.filter((task) => {
			const time = useCTime ? task.ctime : task.mtime;
			return time >= rangeStart;
		});
	}

	const threshold = getThreshold(filter);
	return tasks.filter((task) => {
		const time = useCTime ? task.ctime : task.mtime;
		return time >= threshold;
	});
}
