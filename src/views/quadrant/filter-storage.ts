/**
 * 四象限过滤的设备级兜底（[[Plan-20261116-102615]] §3.4，来自
 * [[Research-20261116-102038]] 方案 B；`projectScope` 见 [[Plan-20261116-161225]] 步骤 3）。
 * 零 `obsidian` 运行时依赖。
 */

import type {
	QuadrantProjectScope,
	QuadrantStatusKey,
} from '../../tasks-center/quadrant-data';
import {
	encodeQuadrantTimeFilter,
	type QuadrantTimeFilter,
} from '../../tasks-center/task-time-range';
import { parseQuadrantViewState } from './constants';
import { encodeQuadrantScope } from './scope-codec';

export const QUADRANT_FILTER_STORAGE_KEY = 'ioto-pq-filter-v1';

interface FilterStorage {
	loadLocalStorage(key: string): unknown;
	saveLocalStorage(key: string, data: unknown): void;
}

function resolveFilterStorage(app: unknown): FilterStorage | null {
	if (!app || typeof app !== 'object') return null;
	const candidate = app as {
		loadLocalStorage?: unknown;
		saveLocalStorage?: unknown;
	};
	if (
		typeof candidate.loadLocalStorage !== 'function' ||
		typeof candidate.saveLocalStorage !== 'function'
	) {
		return null;
	}
	const storage = candidate as unknown as FilterStorage;
	return {
		loadLocalStorage: (key) => storage.loadLocalStorage(key),
		saveLocalStorage: (key, data) => storage.saveLocalStorage(key, data),
	};
}

export function readQuadrantFilterFallback(app: unknown): {
	statusKeys?: QuadrantStatusKey[];
	timeFilter?: QuadrantTimeFilter;
	projectScope?: QuadrantProjectScope;
} {
	const storage = resolveFilterStorage(app);
	if (!storage) return {};
	try {
		// 记录形状与 leaf state 相同，直接复用白名单 / 解码 / 去重。
		const parsed = parseQuadrantViewState(
			storage.loadLocalStorage(QUADRANT_FILTER_STORAGE_KEY),
		);
		const fallback: {
			statusKeys?: QuadrantStatusKey[];
			timeFilter?: QuadrantTimeFilter;
			projectScope?: QuadrantProjectScope;
		} = {};
		if (parsed.statusKeys) fallback.statusKeys = parsed.statusKeys;
		if (parsed.timeFilter) fallback.timeFilter = parsed.timeFilter;
		// 解析器已承担严格校验，无需二次判断。
		if (parsed.projectScope) fallback.projectScope = parsed.projectScope;
		return fallback;
	} catch {
		return {};
	}
}

export function writeQuadrantFilterFallback(
	app: unknown,
	filter: {
		statusKeys: ReadonlySet<QuadrantStatusKey>;
		timeFilter: QuadrantTimeFilter;
		projectScope: QuadrantProjectScope;
	},
): void {
	const storage = resolveFilterStorage(app);
	if (!storage) return;
	try {
		storage.saveLocalStorage(QUADRANT_FILTER_STORAGE_KEY, {
			statusKeys: [...filter.statusKeys],
			timeFilter: encodeQuadrantTimeFilter(filter.timeFilter),
			projectScope: encodeQuadrantScope(filter.projectScope),
		});
	} catch {
		// localStorage 不可用 / 配额错误：静默降级到 leaf 状态。
	}
}
