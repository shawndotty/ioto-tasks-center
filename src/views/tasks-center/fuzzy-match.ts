import * as obsidian from 'obsidian';

import type {
	TaskSearchFuzzyMatcher,
	TaskSearchMatchPart,
} from './task-search-index';

interface ObsidianFuzzySearchApi {
	prepareQuery?: (query: string) => unknown;
	fuzzySearch?: (
		preparedQuery: unknown,
		text: string,
	) => { score: number; matches: Array<[number, number]> } | null;
}

const PREPARED_QUERY_CACHE_LIMIT = 64;

let cachedMatcher: TaskSearchFuzzyMatcher | null | undefined;

/**
 * Obsidian 运行时导出了 `prepareQuery` / `fuzzySearch`，但 typings 未声明，
 * 且 `minAppVersion` 是 1.1.0 —— 取不到时返回 null，由搜索索引层退回字面匹配。
 */
export function getObsidianTaskFuzzyMatcher(): TaskSearchFuzzyMatcher | null {
	if (cachedMatcher !== undefined) {
		return cachedMatcher;
	}

	cachedMatcher = createObsidianTaskFuzzyMatcher();
	return cachedMatcher;
}

function createObsidianTaskFuzzyMatcher(): TaskSearchFuzzyMatcher | null {
	const api = obsidian as unknown as ObsidianFuzzySearchApi;
	const prepareQuery = api?.prepareQuery;
	const fuzzySearch = api?.fuzzySearch;
	if (typeof prepareQuery !== 'function' || typeof fuzzySearch !== 'function') {
		return null;
	}

	const preparedQueryCache = new Map<string, unknown>();

	return (text: string, query: string): ReturnType<TaskSearchFuzzyMatcher> => {
		try {
			let preparedQuery = preparedQueryCache.get(query);
			if (preparedQuery === undefined) {
				preparedQuery = prepareQuery(query);
				if (preparedQueryCache.size >= PREPARED_QUERY_CACHE_LIMIT) {
					preparedQueryCache.clear();
				}

				preparedQueryCache.set(query, preparedQuery);
			}

			const result = fuzzySearch(preparedQuery, text);
			if (!result || !Array.isArray(result.matches)) {
				return null;
			}

			const matches: TaskSearchMatchPart[] = [];
			for (const part of result.matches) {
				if (!Array.isArray(part) || part.length < 2) {
					continue;
				}

				matches.push([Number(part[0]), Number(part[1])]);
			}

			if (matches.length === 0) {
				return null;
			}

			return {
				score: typeof result.score === 'number' ? result.score : 0,
				matches,
			};
		} catch {
			return null;
		}
	};
}
