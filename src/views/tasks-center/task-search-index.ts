import type { TaskFileEntry } from '../../tasks-center/types';

export type TaskSearchMatchPart = [number, number];

export interface TaskSearchDoc {
	path: string;
	title: string;
	content: string;
	titleLower: string;
	contentLower: string;
	haystack: string;
}

export interface TaskSearchHit {
	path: string;
	score: number;
	titleMatches: TaskSearchMatchPart[] | null;
	snippetText: string;
	snippetMatches: TaskSearchMatchPart[] | null;
}

export interface TaskSearchFuzzyResult {
	score: number;
	matches: TaskSearchMatchPart[];
}

/**
 * 标题模糊匹配器。由 Obsidian 原生 `prepareQuery` / `fuzzySearch` 提供，
 * 取不到时整层退回字面匹配（见 `fuzzy-match.ts`）。
 */
export type TaskSearchFuzzyMatcher = (
	text: string,
	query: string,
) => TaskSearchFuzzyResult | null;

export interface TaskSearchOptions {
	fuzzyMatch?: TaskSearchFuzzyMatcher | null;
	snippetRadius?: number;
}

export const DEFAULT_SNIPPET_RADIUS = 40;

const SCORE_TITLE_EXACT = 600;
const SCORE_TITLE_PREFIX = 500;
const SCORE_TITLE_CONTAINS = 400;
const SCORE_TITLE_FUZZY = 280;
const SCORE_CONTENT_CONTAINS = 180;
const SCORE_CONTENT_TOKEN = 90;

export function normalizeTaskSearchQuery(query: string): string {
	return query.trim().toLocaleLowerCase();
}

export function splitTaskSearchTokens(query: string): string[] {
	return query.split(/\s+/).filter((token) => token.length > 0);
}

export function buildTaskSearchDoc(
	task: Pick<TaskFileEntry, 'path' | 'title' | 'content'>,
): TaskSearchDoc {
	const title = task.title ?? '';
	const content = task.content ?? '';
	const titleLower = title.toLocaleLowerCase();
	const contentLower = content.toLocaleLowerCase();
	return {
		path: task.path,
		title,
		content,
		titleLower,
		contentLower,
		haystack: `${titleLower}\n${contentLower}`,
	};
}

export function buildTaskSearchDocs(
	tasks: readonly TaskFileEntry[],
): TaskSearchDoc[] {
	return tasks.map((task) => buildTaskSearchDoc(task));
}

export function buildTaskSearchStamp(
	tasks: readonly TaskFileEntry[],
): string {
	let maxMtime = 0;
	for (const task of tasks) {
		if (task.mtime > maxMtime) {
			maxMtime = task.mtime;
		}
	}

	return `${tasks.length}:${maxMtime}`;
}

export interface TaskSearchIndexCache {
	get(tasks: readonly TaskFileEntry[]): TaskSearchDoc[];
	invalidate(): void;
}

export function createTaskSearchIndexCache(): TaskSearchIndexCache {
	let cachedTasks: readonly TaskFileEntry[] | null = null;
	let cachedStamp = '';
	let cachedDocs: TaskSearchDoc[] = [];

	return {
		get(tasks: readonly TaskFileEntry[]): TaskSearchDoc[] {
			const stamp = buildTaskSearchStamp(tasks);
			if (cachedTasks === tasks && cachedStamp === stamp) {
				return cachedDocs;
			}

			cachedDocs = buildTaskSearchDocs(tasks);
			cachedTasks = tasks;
			cachedStamp = stamp;
			return cachedDocs;
		},
		invalidate(): void {
			cachedTasks = null;
			cachedStamp = '';
			cachedDocs = [];
		},
	};
}

export interface TaskSearchSnippet {
	text: string;
	matches: TaskSearchMatchPart[];
}

/**
 * 取命中位置所在的整行，并在命中前后各保留 `radius` 个字符，
 * 截断处补省略号（省略号会同步计入高亮偏移）。
 */
export function buildTaskSearchSnippet(
	content: string,
	matchStart: number,
	matchLength: number,
	radius: number = DEFAULT_SNIPPET_RADIUS,
): TaskSearchSnippet {
	const safeStart = Math.max(0, Math.min(matchStart, content.length));
	const safeLength = Math.max(0, matchLength);
	const lineStart = content.lastIndexOf('\n', safeStart - 1) + 1;
	const rawLineEnd = content.indexOf('\n', safeStart + safeLength);
	const lineEnd = rawLineEnd === -1 ? content.length : rawLineEnd;

	let start = Math.max(lineStart, safeStart - radius);
	let end = Math.min(lineEnd, safeStart + safeLength + radius);
	let slice = content.slice(start, end);

	const leadingWhitespace = slice.length - slice.trimStart().length;
	if (leadingWhitespace > 0) {
		start += leadingWhitespace;
		slice = slice.slice(leadingWhitespace);
	}

	const trailingWhitespace = slice.length - slice.trimEnd().length;
	if (trailingWhitespace > 0) {
		end -= trailingWhitespace;
		slice = slice.slice(0, slice.length - trailingWhitespace);
	}

	const prefix = start > lineStart ? '…' : '';
	const suffix = end < lineEnd ? '…' : '';
	const localStart = safeStart - start + prefix.length;

	return {
		text: `${prefix}${slice}${suffix}`,
		matches: [[localStart, localStart + safeLength]],
	};
}

export function matchesTaskSearchDoc(
	doc: TaskSearchDoc,
	normalizedQuery: string,
): boolean {
	if (!normalizedQuery) {
		return true;
	}

	return doc.haystack.includes(normalizedQuery);
}

function findFuzzyTitleMatch(
	doc: TaskSearchDoc,
	query: string,
	fuzzyMatch: TaskSearchFuzzyMatcher,
): TaskSearchFuzzyResult | null {
	if (!doc.title) {
		return null;
	}

	const result = fuzzyMatch(doc.title, query);
	if (!result) {
		return null;
	}

	const firstMatch = result.matches[0];
	if (!firstMatch) {
		return null;
	}

	const isContiguous =
		result.matches.length === 1 && firstMatch[1] - firstMatch[0] === 1;
	const bonus = isContiguous ? 20 : 0;

	return {
		score: SCORE_TITLE_FUZZY - Math.min(firstMatch[0], 60) + bonus,
		matches: result.matches,
	};
}

function scoreTitleMatch(
	doc: TaskSearchDoc,
	normalizedQuery: string,
	fuzzyMatch: TaskSearchFuzzyMatcher | null | undefined,
): TaskSearchFuzzyResult | null {
	const titleLower = doc.titleLower;
	if (!titleLower || !normalizedQuery) {
		return null;
	}

	if (titleLower === normalizedQuery) {
		return {
			score: SCORE_TITLE_EXACT,
			matches: [[0, doc.title.length]],
		};
	}

	if (titleLower.startsWith(normalizedQuery)) {
		return {
			score: SCORE_TITLE_PREFIX,
			matches: [[0, normalizedQuery.length]],
		};
	}

	const index = titleLower.indexOf(normalizedQuery);
	if (index !== -1) {
		return {
			score: SCORE_TITLE_CONTAINS - Math.min(index, 100),
			matches: [[index, index + normalizedQuery.length]],
		};
	}

	return fuzzyMatch
		? findFuzzyTitleMatch(doc, normalizedQuery, fuzzyMatch)
		: null;
}

interface ContentMatchResult {
	score: number;
	snippet: TaskSearchSnippet | null;
}

function scoreContentMatch(
	doc: TaskSearchDoc,
	normalizedQuery: string,
	tokens: string[],
	radius: number,
): ContentMatchResult {
	if (!doc.contentLower) {
		return { score: 0, snippet: null };
	}

	const queryIndex = doc.contentLower.indexOf(normalizedQuery);
	if (queryIndex !== -1) {
		return {
			score:
				SCORE_CONTENT_CONTAINS -
				Math.min(Math.floor(queryIndex / 10), 80),
			snippet: buildTaskSearchSnippet(
				doc.content,
				queryIndex,
				normalizedQuery.length,
				radius,
			),
		};
	}

	const fallbackToken = tokens.reduce(
		(longest, token) => (token.length > longest.length ? token : longest),
		'',
	);
	if (!fallbackToken) {
		return { score: 0, snippet: null };
	}

	const tokenIndex = doc.contentLower.indexOf(fallbackToken);
	if (tokenIndex === -1) {
		return { score: 0, snippet: null };
	}

	return {
		score:
			SCORE_CONTENT_TOKEN - Math.min(Math.floor(tokenIndex / 20), 40),
		snippet: buildTaskSearchSnippet(
			doc.content,
			tokenIndex,
			fallbackToken.length,
			radius,
		),
	};
}

/**
 * 两阶段匹配：先用最长字面 token 在预拼好的 haystack 上廉价预筛，
 * 再只对候选集打分（标题模糊 / 字面，正文仅字面并取上下文片段）。
 */
export function searchTaskIndex(
	docs: readonly TaskSearchDoc[],
	query: string,
	options: TaskSearchOptions = {},
): Map<string, TaskSearchHit> {
	const hits = new Map<string, TaskSearchHit>();
	const normalizedQuery = normalizeTaskSearchQuery(query);
	if (!normalizedQuery) {
		return hits;
	}

	const tokens = splitTaskSearchTokens(normalizedQuery);
	if (tokens.length === 0) {
		return hits;
	}

	const prescreenToken = tokens.reduce(
		(longest, token) => (token.length > longest.length ? token : longest),
		'',
	);
	const radius = options.snippetRadius ?? DEFAULT_SNIPPET_RADIUS;

	for (const doc of docs) {
		if (!doc.haystack.includes(prescreenToken)) {
			continue;
		}

		if (!tokens.every((token) => doc.haystack.includes(token))) {
			continue;
		}

		const titleMatch = scoreTitleMatch(
			doc,
			normalizedQuery,
			options.fuzzyMatch,
		);
		const contentMatch = scoreContentMatch(
			doc,
			normalizedQuery,
			tokens,
			radius,
		);
		const score = (titleMatch?.score ?? 0) + contentMatch.score;
		if (score <= 0) {
			continue;
		}

		hits.set(doc.path, {
			path: doc.path,
			score,
			titleMatches: titleMatch?.matches ?? null,
			snippetText: contentMatch.snippet?.text ?? '',
			snippetMatches: contentMatch.snippet?.matches ?? null,
		});
	}

	return hits;
}

/**
 * 按命中分数降序排列，分数相同时保持传入顺序（稳定）。
 */
export function orderTasksBySearchHits<T extends { path: string }>(
	tasks: readonly T[],
	hits: ReadonlyMap<string, TaskSearchHit> | null,
): T[] {
	if (!hits) {
		return [...tasks];
	}

	const indexed: Array<{ task: T; index: number; score: number }> = [];
	tasks.forEach((task, index) => {
		const hit = hits.get(task.path);
		if (hit) {
			indexed.push({ task, index, score: hit.score });
		}
	});

	indexed.sort(
		(left, right) => right.score - left.score || left.index - right.index,
	);
	return indexed.map((entry) => entry.task);
}
