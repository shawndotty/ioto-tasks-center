import type { TaskFileEntry } from '../tasks-center/types';

export function normalizeTaskSearchQuery(query: string): string {
	return query.trim().toLocaleLowerCase();
}

export function matchesTaskSearchQuery(
	task: Pick<TaskFileEntry, 'title' | 'basename' | 'content'>,
	query: string,
): boolean {
	const normalizedQuery = normalizeTaskSearchQuery(query);
	if (!normalizedQuery) {
		return true;
	}

	return [task.title, task.basename, task.content].some((value) =>
		value.toLocaleLowerCase().includes(normalizedQuery),
	);
}

export function filterTasksBySearchQuery(
	tasks: TaskFileEntry[],
	query: string,
): TaskFileEntry[] {
	const normalizedQuery = normalizeTaskSearchQuery(query);
	if (!normalizedQuery) {
		return tasks;
	}

	return tasks.filter((task) =>
		matchesTaskSearchQuery(task, normalizedQuery),
	);
}
