/**
 * 优先级四象限的纯模型（[[Plan-20261115-201917]] §3.2）。
 *
 * 只做分桶 / 过滤 / 计数 / 排序 / 菜单描述，零 DOM、零 i18n，便于单测。
 * 依赖约束：只允许 `import type` 宿主类型 + 同层纯模块，禁止导入 `views/**`
 * 或 `obsidian` 运行时，否则会新增值级环（`npm run dep:check` 把关）。
 */

import { TASK_PRIORITY_VALUES, type TaskPriorityValue } from './task-priority';
import { getTaskProjectNameFromPath } from './task-display-title';
import type { TaskFileEntry } from './types';

export const QUADRANT_KEYS = ['p0', 'p1', 'p2', 'p3'] as const;

export type QuadrantKey = (typeof QUADRANT_KEYS)[number];

export type QuadrantBucketKey = QuadrantKey | 'unlabeled';

/** 过滤 chip 的三态；`empty` 在模型入口折进 `todo`。 */
export type QuadrantStatusKey = 'completed' | 'in-progress' | 'todo';

export interface QuadrantProjectScope {
	kind: 'all' | 'unarchived' | 'project';
	/** `kind === 'project'` 时必填 */
	projectName?: string;
}

export interface QuadrantFilterState {
	statusKeys: ReadonlySet<QuadrantStatusKey>;
	projectScope: QuadrantProjectScope;
	hiddenProjectNames: ReadonlySet<string>;
}

export interface QuadrantModel {
	buckets: Record<QuadrantKey, TaskFileEntry[]>;
	unlabeled: TaskFileEntry[];
	/** 当前状态过滤下的各桶计数（象限标题 / 侧栏标题用） */
	counts: Record<QuadrantBucketKey, number>;
	/** 项目范围后、状态过滤前的三态计数（chip 用） */
	statusCounts: Record<QuadrantStatusKey, number>;
	/** 项目范围后、状态过滤前的总数 */
	scopedTotal: number;
	/** 最终参与象限 + 侧栏的任务数 */
	total: number;
}

/** 优先级 → 桶。非法值（非整数 / 负数）防御性归入 unlabeled（解析层本就会给 undefined）。 */
export function quadrantKeyForPriority(
	priority: number | undefined,
): QuadrantBucketKey {
	if (
		priority === undefined ||
		!Number.isInteger(priority) ||
		priority < 0
	) {
		return 'unlabeled';
	}
	if (priority === 0) return 'p0';
	if (priority === 1) return 'p1';
	if (priority === 2) return 'p2';
	return 'p3';
}

export function toQuadrantStatusKey(
	statusKey: TaskFileEntry['status']['key'],
): QuadrantStatusKey {
	return statusKey === 'empty' ? 'todo' : statusKey;
}

/** 项目范围判定：未归档 = 不在 `hiddenProjectNames`；指定项目含存档仍可查看。 */
export function matchesQuadrantProjectScope(
	taskPath: string,
	scope: QuadrantProjectScope,
	hiddenProjectNames: ReadonlySet<string>,
): boolean {
	if (scope.kind === 'all') return true;
	const projectName = getTaskProjectNameFromPath(taskPath);
	if (scope.kind === 'project') return projectName === scope.projectName;
	return !hiddenProjectNames.has(projectName);
}

const QUADRANT_NAME_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

function compareQuadrantTasks(
	left: TaskFileEntry,
	right: TaskFileEntry,
): number {
	const byMtime = right.mtime - left.mtime;
	if (byMtime !== 0) return byMtime;
	return QUADRANT_NAME_COLLATOR.compare(left.basename, right.basename);
}

export function buildQuadrantModel(
	tasks: readonly TaskFileEntry[],
	filter: QuadrantFilterState,
): QuadrantModel {
	const buckets: Record<QuadrantKey, TaskFileEntry[]> = {
		p0: [],
		p1: [],
		p2: [],
		p3: [],
	};
	const unlabeled: TaskFileEntry[] = [];
	const statusCounts: Record<QuadrantStatusKey, number> = {
		completed: 0,
		'in-progress': 0,
		todo: 0,
	};
	let scopedTotal = 0;

	for (const task of tasks) {
		if (
			!matchesQuadrantProjectScope(
				task.path,
				filter.projectScope,
				filter.hiddenProjectNames,
			)
		) {
			continue;
		}
		scopedTotal += 1;
		const statusKey = toQuadrantStatusKey(task.status.key);
		statusCounts[statusKey] += 1;
		if (!filter.statusKeys.has(statusKey)) {
			continue;
		}
		const bucketKey = quadrantKeyForPriority(task.priority);
		if (bucketKey === 'unlabeled') unlabeled.push(task);
		else buckets[bucketKey].push(task);
	}

	for (const key of QUADRANT_KEYS) buckets[key].sort(compareQuadrantTasks);
	unlabeled.sort(compareQuadrantTasks);

	const counts: Record<QuadrantBucketKey, number> = {
		p0: buckets.p0.length,
		p1: buckets.p1.length,
		p2: buckets.p2.length,
		p3: buckets.p3.length,
		unlabeled: unlabeled.length,
	};

	return {
		buckets,
		unlabeled,
		counts,
		statusCounts,
		scopedTotal,
		total:
			counts.p0 + counts.p1 + counts.p2 + counts.p3 + counts.unlabeled,
	};
}

/** 菜单条目的纯描述（文案映射留给视图层，保证本模块零 i18n / 零 DOM）。 */
export type QuadrantPriorityMenuItem =
	| { kind: 'clear' }
	| { kind: 'priority'; value: TaskPriorityValue; active: boolean };

export function buildQuadrantPriorityMenuItems(
	priority: number | undefined,
): QuadrantPriorityMenuItem[] {
	const items: QuadrantPriorityMenuItem[] = [];
	if (priority !== undefined) items.push({ kind: 'clear' });
	for (const value of TASK_PRIORITY_VALUES) {
		items.push({ kind: 'priority', value, active: priority === value });
	}
	return items;
}
