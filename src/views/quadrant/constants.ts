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
import {
	QUADRANT_TASK_TYPES,
	isQuadrantTaskType,
	type QuadrantTaskType,
} from '../../tasks-center/task-type-infer';
import type {
	QuadrantProjectScope,
	QuadrantStatusKey,
} from '../../tasks-center/quadrant-data';
import { parseQuadrantProjectScope } from './scope-codec';

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

/** 类型默认全选（[[Plan-20261117-085118]] §5.6），与创建菜单展示顺序一致。 */
export const DEFAULT_QUADRANT_TYPE_KEYS: readonly QuadrantTaskType[] =
	QUADRANT_TASK_TYPES;

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
	/** 与 `statusKeys` 同语义：空数组合法表示「全不选」。 */
	typeKeys: QuadrantTaskType[];
	projectScope: QuadrantProjectScope;
}

/**
 * 叶子状态合并（[[Plan-20261116-102615]] §3.1、[[Plan-20261116-161225]] §三 步骤 2）：
 * 缺失（undefined）保留当前值；`statusKeys` / `typeKeys` 的 `[]` 是合法「全不选」，必须保留。
 * `projectScope` 以对象引用传递即可（`quadrant-data.ts` 侧只读）。
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
		typeKeys: parsed.typeKeys ? [...parsed.typeKeys] : [...current.typeKeys],
		projectScope: parsed.projectScope ?? current.projectScope,
	};
}

/**
 * 叶子视图状态（[[Plan-20261116-060249]] §3.2、[[Plan-20261116-083330]] §3.6、
 * [[Plan-20261116-091927]] §3.2、[[Plan-20261116-155634]] §5.4、
 * [[Plan-20261117-062052]] §5.5、[[Plan-20261117-085118]] §5.6）。
 * `sidebarOpen` 只认 boolean；`timeFilter` 走白名单解码，脏数据回落「全部时间」；
 * `statusKeys` / `typeKeys` 只收白名单键并去重——键缺失或全脏回落默认，空数组合法表示「全不选」；
 * `projectScope` 走严格解析，缺失 / 脏值一律 `undefined`（**不**回落「未归档」，否则会覆盖兜底值）；
 * `previewLeafId` / `openedTaskPath` 只认非空字符串，且**都不**参与 `mergeQuadrantViewState`
 * （二者描述打开状态而非筛选状态，不能被子模块的筛选合并覆盖或清空）。
 */
export function parseQuadrantViewState(state: unknown): {
	sidebarOpen?: boolean;
	timeFilter?: QuadrantTimeFilter;
	statusKeys?: QuadrantStatusKey[];
	typeKeys?: QuadrantTaskType[];
	projectScope?: QuadrantProjectScope;
	previewLeafId?: string;
	openedTaskPath?: string;
} {
	if (!state || typeof state !== 'object') return {};
	const candidate = state as Record<string, unknown>;
	const parsed: {
		sidebarOpen?: boolean;
		timeFilter?: QuadrantTimeFilter;
		statusKeys?: QuadrantStatusKey[];
		typeKeys?: QuadrantTaskType[];
		projectScope?: QuadrantProjectScope;
		previewLeafId?: string;
		openedTaskPath?: string;
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
	if ('typeKeys' in candidate && Array.isArray(candidate.typeKeys)) {
		const raw = candidate.typeKeys;
		const valid = raw.filter(isQuadrantTaskType);
		if (valid.length > 0 || raw.length === 0) {
			parsed.typeKeys = [...new Set(valid)];
		}
	}
	if ('projectScope' in candidate) {
		const scope = parseQuadrantProjectScope(candidate.projectScope);
		if (scope) parsed.projectScope = scope;
	}
	if (
		typeof candidate.previewLeafId === 'string' &&
		candidate.previewLeafId.length > 0
	) {
		parsed.previewLeafId = candidate.previewLeafId;
	}
	if (
		typeof candidate.openedTaskPath === 'string' &&
		candidate.openedTaskPath.length > 0
	) {
		parsed.openedTaskPath = candidate.openedTaskPath;
	}
	return parsed;
}
