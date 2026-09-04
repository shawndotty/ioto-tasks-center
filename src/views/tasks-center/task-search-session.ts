import type { TaskFileEntry } from '../../tasks-center/types';
import { getObsidianTaskFuzzyMatcher } from './fuzzy-match';
import {
	buildTaskSearchStamp,
	createTaskSearchIndexCache,
	normalizeTaskSearchQuery,
	searchTaskIndex,
	type TaskSearchFuzzyMatcher,
	type TaskSearchHit,
} from './task-search-index';

export interface TaskSearchSessionOptions {
	fuzzyMatch?: () => TaskSearchFuzzyMatcher | null;
}

export interface TaskSearchSession {
	/**
	 * 基于全量任务与当前查询解析命中结果。索引与命中都会缓存，
	 * 因此同一帧内多次调用（可见任务 / 筛选计数）只计算一次。
	 */
	resolve(
		tasks: readonly TaskFileEntry[],
		query: string,
	): ReadonlyMap<string, TaskSearchHit> | null;
	invalidate(): void;
}

export function createTaskSearchSession(
	options: TaskSearchSessionOptions = {},
): TaskSearchSession {
	const resolveFuzzyMatch =
		options.fuzzyMatch ?? (() => getObsidianTaskFuzzyMatcher());
	const indexCache = createTaskSearchIndexCache();
	let hits: Map<string, TaskSearchHit> | null = null;
	let hitsKey = '';

	return {
		resolve(
			tasks: readonly TaskFileEntry[],
			query: string,
		): ReadonlyMap<string, TaskSearchHit> | null {
			const normalizedQuery = normalizeTaskSearchQuery(query);
			const key = `${buildTaskSearchStamp(tasks)}::${normalizedQuery}`;
			if (!normalizedQuery) {
				hits = null;
				hitsKey = key;
				return null;
			}

			if (hits && hitsKey === key) {
				return hits;
			}

			hits = searchTaskIndex(indexCache.get(tasks), normalizedQuery, {
				fuzzyMatch: resolveFuzzyMatch(),
			});
			hitsKey = key;
			return hits;
		},
		invalidate(): void {
			indexCache.invalidate();
			hits = null;
			hitsKey = '';
		},
	};
}
