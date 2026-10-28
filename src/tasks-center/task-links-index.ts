/**
 * 任务链接浏览窗口的纯逻辑：vault 级反向索引、父任务解析、搜索过滤
 * （[[Plan-20261028-154638]] §3.2 / §3.3 / §3.6）。
 *
 * 🔴 本模块**不 import obsidian**（只 `import type`），标题解析器由调用方注入，
 *    这样环 / 同名 / 别名三种边界都能在单测里穷举。
 *
 * 为什么不复用 `buildDirectChildTasksByParentPath`：它的「同名取第一个」正是
 * 本次要修的歧义来源；照它的语义另写一份，列表渲染路径一行不动（零回归）。
 */

import type {
	TaskFileEntry,
	TaskLinkCategory,
	TaskLinkEntry,
	TaskLinksRoots,
	TaskLinksSnapshot,
} from './types';
import { resolveTaskDisplayTitle } from './task-display-title';
import { isPathInsideRoot } from './task-path';

/**
 * 父任务候选解析器：`title` 已归一化（无 `|` / `#`），`sourcePath` 是任务本身路径。
 * 生产环境注入 `metadataCache.getFirstLinkpathDest` 的包装。
 */
export type TaskTitleResolver = (title: string, sourcePath: string) => string | null;

export interface TaskLinksIndex {
	childrenByParentPath: Map<string, TaskFileEntry[]>;
	parentPathByTaskPath: Map<string, string>;
	pathsByTitle: Map<string, string[]>;
	taskByPath: Map<string, TaskFileEntry>;
}

/** Tab 顺序的唯一来源（面板与计数都按它遍历）。 */
export const TASK_LINK_CATEGORIES: readonly TaskLinkCategory[] = [
	'subtask',
	'input',
	'output',
	'outcome',
	'other',
];

function getDirname(path: string): string {
	const index = path.lastIndexOf('/');
	return index < 0 ? '' : path.slice(0, index);
}

function comparePaths(left: string, right: string): number {
	return left.localeCompare(right, undefined, { numeric: true });
}

/**
 * 建索引。`tasks` 的**顺序即子任务顺序**（调用方先按列表 sortMode 排好）。
 *
 * 父任务解析优先级（三级，唯一实现在这里）：
 * 1. 注入的解析器命中且**落在任务集合内**（核心自带「就近优先」）；
 * 2. 同目录（= 同项目，任务文件的项目文件夹就是它的父目录）的候选首个；
 * 3. 全部候选按路径字典序取第一个（确定性，保证同名不会「看刷新顺序」）。
 */
export function buildTaskLinksIndex(
	tasks: readonly TaskFileEntry[],
	resolveTitle?: TaskTitleResolver,
): TaskLinksIndex {
	const taskByPath = new Map<string, TaskFileEntry>();
	const pathsByTitle = new Map<string, string[]>();

	for (const task of tasks) {
		if (taskByPath.has(task.path)) {
			continue;
		}

		taskByPath.set(task.path, task);
		const paths = pathsByTitle.get(task.title) ?? [];
		if (!paths.includes(task.path)) {
			paths.push(task.path);
		}
		pathsByTitle.set(task.title, paths);
	}

	// 先排好字典序：规则 3 直接取 [0]，不需要「先到先得」。
	for (const paths of pathsByTitle.values()) {
		paths.sort(comparePaths);
	}

	const parentPathByTaskPath = new Map<string, string>();
	for (const task of tasks) {
		for (const title of task.upTaskTitles) {
			const resolved = resolveOneParent(
				task.path,
				title,
				taskByPath,
				pathsByTitle,
				resolveTitle,
			);
			if (resolved && resolved !== task.path) {
				parentPathByTaskPath.set(task.path, resolved);
				break;
			}
		}
	}

	// 按 `tasks` 顺序 push → 子任务顺序 = 列表顺序。
	const childrenByParentPath = new Map<string, TaskFileEntry[]>();
	for (const task of tasks) {
		const parentPath = parentPathByTaskPath.get(task.path);
		if (!parentPath) {
			continue;
		}

		const children = childrenByParentPath.get(parentPath) ?? [];
		children.push(task);
		childrenByParentPath.set(parentPath, children);
	}

	return {
		childrenByParentPath,
		parentPathByTaskPath,
		pathsByTitle,
		taskByPath,
	};
}

function resolveOneParent(
	taskPath: string,
	title: string,
	taskByPath: ReadonlyMap<string, TaskFileEntry>,
	pathsByTitle: ReadonlyMap<string, string[]>,
	resolveTitle?: TaskTitleResolver,
): string | null {
	if (resolveTitle) {
		const resolved = resolveTitle(title, taskPath);
		if (resolved && taskByPath.has(resolved)) {
			return resolved;
		}
	}

	const candidates = pathsByTitle.get(title) ?? [];
	if (candidates.length === 0) {
		return null;
	}

	const sourceDir = getDirname(taskPath);
	const sameDirectory = candidates.find(
		(candidate) => getDirname(candidate) === sourceDir,
	);
	return sameDirectory ?? candidates[0] ?? null;
}

/**
 * 一个任务的全部可解析父级（`UpTask` 是数组）。用于面板的「父级任务」行：
 * 与列表层级只认第一个不同，这里把所有能解析的都展示出来。
 */
export function resolveTaskParentPaths(
	index: TaskLinksIndex,
	task: Pick<TaskFileEntry, 'path' | 'upTaskTitles'>,
	resolveTitle?: TaskTitleResolver,
): string[] {
	const parentPaths: string[] = [];
	for (const title of task.upTaskTitles) {
		const resolved = resolveOneParent(
			task.path,
			title,
			index.taskByPath,
			index.pathsByTitle,
			resolveTitle,
		);
		if (!resolved || resolved === task.path || parentPaths.includes(resolved)) {
			continue;
		}
		parentPaths.push(resolved);
	}

	return parentPaths;
}

/** 标题展示口径与 `IOTOTasksCenterView.getTaskDisplayTitle` 同源。 */
export function toTaskLinkEntry(
	task: Pick<TaskFileEntry, 'title' | 'path'>,
	showProjectNameInTaskList: boolean,
): TaskLinkEntry {
	return {
		path: task.path,
		title: resolveTaskDisplayTitle(task, showProjectNameInTaskList),
		subPath: task.path.replace(/\.md$/i, ''),
		kind: 'task',
	};
}

/**
 * 「其他」= 出链 − 三个根（输入/输出/成果）− 排除集（自身 + 子任务）。
 *
 * 父任务**不排除**：它是 frontmatter 产生的真实出链，单开规则会造成不对称
 * （[[Research-20261029-054453]] 判定 1）。
 */
export function collectOtherOutlinkPaths(
	outlinkPaths: readonly string[],
	roots: TaskLinksRoots,
	excludedPaths: Iterable<string>,
): string[] {
	const excluded = new Set(excludedPaths);
	const seen = new Set<string>();
	const others: string[] = [];
	for (const path of outlinkPaths) {
		if (excluded.has(path) || seen.has(path)) {
			continue;
		}
		if (
			isPathInsideRoot(path, roots.inputRootPath) ||
			isPathInsideRoot(path, roots.outputRootPath) ||
			isPathInsideRoot(path, roots.outcomeRootPath)
		) {
			continue;
		}
		seen.add(path);
		others.push(path);
	}
	return others.sort(comparePaths);
}

export interface TaskLinksFilterResult {
	sections: Record<TaskLinkCategory, TaskLinkEntry[]>;
	counts: Record<TaskLinkCategory, number>;
}

/**
 * 全局搜索过滤（对所有分类同时生效，[[Discuss-20261028-153402]] §3.3）。
 * 空词 = 原样返回；命中 = 标题或正文**大小写不敏感**子串。
 */
export function filterTaskLinks(
	snapshot: Pick<TaskLinksSnapshot, 'sections'>,
	query: string,
	bodies: ReadonlyMap<string, string>,
): TaskLinksFilterResult {
	const normalizedQuery = query.trim().toLowerCase();
	const sections = {
		subtask: [],
		input: [],
		output: [],
		outcome: [],
		other: [],
	} as Record<TaskLinkCategory, TaskLinkEntry[]>;
	const counts = {
		subtask: 0,
		input: 0,
		output: 0,
		outcome: 0,
		other: 0,
	} as Record<TaskLinkCategory, number>;

	for (const category of TASK_LINK_CATEGORIES) {
		const entries = snapshot.sections[category] ?? [];
		const matched = normalizedQuery
			? entries.filter((entry) =>
					matchesTaskLink(entry, normalizedQuery, bodies),
				)
			: entries;
		sections[category] = matched;
		counts[category] = matched.length;
	}

	return { sections, counts };
}

function matchesTaskLink(
	entry: TaskLinkEntry,
	normalizedQuery: string,
	bodies: ReadonlyMap<string, string>,
): boolean {
	if (entry.title.toLowerCase().includes(normalizedQuery)) {
		return true;
	}

	const body = bodies.get(entry.path);
	return body ? body.toLowerCase().includes(normalizedQuery) : false;
}
