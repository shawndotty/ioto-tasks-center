/**
 * 优先级四象限视图的常量（[[Plan-20261115-201917]] §3.4 / §五 #2）。
 *
 * 视图类型刻意放在独立叶子模块：`task-view-routing` 只依赖常量、不依赖视图类，
 * 避免「routing → view → routing」的值级环。
 */

import {
	decodeQuadrantTimeFilter,
	type QuadrantTimeFilter,
} from '../../tasks-center/task-time-range';
import type { QuadrantStatusKey } from '../../tasks-center/quadrant-data';

export const IOTO_PRIORITY_QUADRANT_VIEW_TYPE = 'IOTOPriorityQuadrant';

export const QUADRANT_LOADING_RENDER_DELAY_MS = 120;

export const QUADRANT_BODY_CLASS = 'ioto-pq-body';

export const QUADRANT_CARD_CLASS = 'ioto-pq-card';

const QUADRANT_STATUS_KEYS: readonly QuadrantStatusKey[] = [
	'completed',
	'in-progress',
	'todo',
];

export const DEFAULT_QUADRANT_STATUS_KEYS: readonly QuadrantStatusKey[] = [
	'in-progress',
	'todo',
];

function isQuadrantStatusKey(value: unknown): value is QuadrantStatusKey {
	return (
		typeof value === 'string' &&
		(QUADRANT_STATUS_KEYS as readonly string[]).includes(value)
	);
}

export interface QuadrantViewFilterState {
	sidebarOpen: boolean;
	timeFilter: QuadrantTimeFilter;
	statusKeys: QuadrantStatusKey[];
}

/**
 * 叶子状态合并（[[Plan-20261116-102615]] §3.1）：
 * 缺失（undefined）保留当前值；`statusKeys: []` 是合法「全不选」，必须保留。
 */
export function mergeQuadrantViewState(
	current: QuadrantViewFilterState,
	parsed: ReturnType<typeof parseQuadrantViewState>,
): QuadrantViewFilterState {
	return {
		sidebarOpen: parsed.sidebarOpen ?? current.sidebarOpen,
		timeFilter: parsed.timeFilter ?? current.timeFilter,
		statusKeys: parsed.statusKeys
			? [...parsed.statusKeys]
			: [...current.statusKeys],
	};
}

/**
 * 叶子视图状态（[[Plan-20261116-060249]] §3.2、[[Plan-20261116-083330]] §3.6、
 * [[Plan-20261116-091927]] §3.2）。
 * `sidebarOpen` 只认 boolean；`timeFilter` 走白名单解码，脏数据回落「全部时间」；
 * `statusKeys` 只收白名单键并去重——键缺失或全脏回落默认，空数组合法表示「全不选」。
 */
export function parseQuadrantViewState(state: unknown): {
	sidebarOpen?: boolean;
	timeFilter?: QuadrantTimeFilter;
	statusKeys?: QuadrantStatusKey[];
} {
	if (!state || typeof state !== 'object') return {};
	const candidate = state as Record<string, unknown>;
	const parsed: {
		sidebarOpen?: boolean;
		timeFilter?: QuadrantTimeFilter;
		statusKeys?: QuadrantStatusKey[];
	} = {};
	if (typeof candidate.sidebarOpen === 'boolean') {
		parsed.sidebarOpen = candidate.sidebarOpen;
	}
	if ('timeFilter' in candidate) {
		parsed.timeFilter = decodeQuadrantTimeFilter(candidate.timeFilter);
	}
	if ('statusKeys' in candidate && Array.isArray(candidate.statusKeys)) {
		const raw = candidate.statusKeys;
		const valid = raw.filter(isQuadrantStatusKey);
		if (valid.length > 0 || raw.length === 0) {
			parsed.statusKeys = [...new Set(valid)];
		}
	}
	return parsed;
}
