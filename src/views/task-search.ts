import type { TaskFileEntry } from '../tasks-center/types';
import {
	buildTaskSearchDoc,
	buildTaskSearchDocs,
	matchesTaskSearchDoc,
	normalizeTaskSearchQuery,
	orderTasksBySearchHits,
	searchTaskIndex,
} from './tasks-center/task-search-index';

export { normalizeTaskSearchQuery };
export type { TaskSearchHit } from './tasks-center/task-search-index';

export function matchesTaskSearchQuery(
	task: Pick<TaskFileEntry, 'title' | 'basename' | 'content'>,
	query: string,
): boolean {
	const normalizedQuery = normalizeTaskSearchQuery(query);
	if (!normalizedQuery) {
		return true;
	}

	return matchesTaskSearchDoc(
		buildTaskSearchDoc({
			path: '',
			title: task.title,
			content: task.content,
		}),
		normalizedQuery,
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

	const hits = searchTaskIndex(buildTaskSearchDocs(tasks), normalizedQuery);
	return orderTasksBySearchHits(tasks, hits);
}
