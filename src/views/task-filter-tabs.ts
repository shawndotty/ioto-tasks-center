import { t } from '../lang/helpter';
import type { TaskFileEntry } from '../tasks-center/types';

export type TaskFilterTab =
	| 'today'
	| 'incomplete'
	| 'completed'
	| 'all'
	| 'core';

/** tab 的注册顺序：所有可见性计算与回退都只认这一份顺序。 */
const TASK_FILTER_TAB_ORDER: TaskFilterTab[] = [
	'core',
	'today',
	'incomplete',
	'completed',
	'all',
];

export interface TaskFilterTabDefinition {
	id: TaskFilterTab;
	kind: 'builtin';
	label: string;
}

/**
 * tab 注册表。本期全为内置 tab；未来自定义 tab 只需在此追加并放开 `kind`。
 */
export function getTaskFilterTabDefinitions(): TaskFilterTabDefinition[] {
	return TASK_FILTER_TAB_ORDER.map((id) => ({
		id,
		kind: 'builtin' as const,
		label: t(`task.filter.${id}`),
	}));
}

export function getTaskFilterTabs(): Array<{
	key: TaskFilterTab;
	label: string;
}> {
	return getTaskFilterTabDefinitions().map((definition) => ({
		key: definition.id,
		label: definition.label,
	}));
}

/**
 * 按注册表顺序返回可见 tab。隐藏名单覆盖全部时兜底首个 tab（`core`），
 * 保证调用方永远拿到非空列表、不会渲染出没有激活项的 tab 栏。
 */
export function resolveVisibleTaskFilterTabs(
	hiddenIds: readonly string[],
): Array<{ key: TaskFilterTab; label: string }> {
	const hiddenSet = new Set<string>(hiddenIds);
	const allTabs = getTaskFilterTabs();
	const visibleTabs = allTabs.filter((tab) => !hiddenSet.has(tab.key));
	if (visibleTabs.length > 0) {
		return visibleTabs;
	}

	const fallbackTab = allTabs[0];
	return fallbackTab ? [fallbackTab] : [];
}

/**
 * 归一化持久化的隐藏名单：非数组 → `[]`，非法项丢弃、去重，
 * 并按注册表顺序输出（与用户勾选顺序无关，便于相等比较）。
 * 覆盖全部 tab 的非法状态整体回落成 `[]`（全显示）。
 */
export function normalizeHiddenTaskFilterTabs(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const hiddenSet = new Set<TaskFilterTab>();
	for (const item of value) {
		if (isTaskFilterTab(item)) {
			hiddenSet.add(item);
		}
	}

	if (hiddenSet.size >= TASK_FILTER_TAB_ORDER.length) {
		return [];
	}

	return TASK_FILTER_TAB_ORDER.filter((id) => hiddenSet.has(id));
}

/**
 * 切换单个 tab 的可见性，返回新的隐藏名单（按注册表顺序）。
 * 关闭最后一个可见 tab 时原样返回，供 updater 判「未变更」而跳过写盘。
 */
export function setTaskFilterTabVisible(
	hiddenIds: readonly string[],
	id: TaskFilterTab,
	visible: boolean,
): string[] {
	const hiddenSet = new Set<TaskFilterTab>();
	for (const item of hiddenIds) {
		if (isTaskFilterTab(item)) {
			hiddenSet.add(item);
		}
	}

	if (!visible && !hiddenSet.has(id)) {
		const visibleCount = TASK_FILTER_TAB_ORDER.length - hiddenSet.size;
		if (visibleCount <= 1) {
			return TASK_FILTER_TAB_ORDER.filter((tabId) => hiddenSet.has(tabId));
		}
	}

	if (visible) {
		hiddenSet.delete(id);
	} else {
		hiddenSet.add(id);
	}

	return TASK_FILTER_TAB_ORDER.filter((tabId) => hiddenSet.has(tabId));
}

/**
 * 激活项被隐藏时回退到可见列表首项。只在 `render()` 单点调用，
 * 避免各消费点各自写一遍兜底逻辑。
 */
export function resolveActiveTaskFilterTab(
	active: TaskFilterTab,
	visible: ReadonlyArray<{ key: TaskFilterTab }>,
): TaskFilterTab {
	if (visible.some((tab) => tab.key === active)) {
		return active;
	}

	return visible[0]?.key ?? 'core';
}

export function isTaskFilterTab(value: unknown): value is TaskFilterTab {
	return (
		value === 'today' ||
		value === 'incomplete' ||
		value === 'completed' ||
		value === 'all' ||
		value === 'core'
	);
}

export function getTaskFilterCounts(
	tasks: TaskFileEntry[],
	now: Date = new Date(),
): Record<TaskFilterTab, number> {
	return {
		today: tasks.filter((task) => matchesTaskFilterTab(task, 'today', now))
			.length,
		incomplete: tasks.filter((task) =>
			matchesTaskFilterTab(task, 'incomplete', now),
		).length,
		completed: tasks.filter((task) =>
			matchesTaskFilterTab(task, 'completed', now),
		).length,
		all: tasks.length,
		core: tasks.filter((task) => matchesTaskFilterTab(task, 'core', now))
			.length,
	};
}

export function matchesTaskFilterTab(
	task: TaskFileEntry,
	tab: TaskFilterTab,
	now: Date = new Date(),
): boolean {
	if (tab === 'all') {
		return true;
	}

	if (tab === 'today') {
		return isTaskCreatedToday(task, now);
	}

	if (tab === 'completed') {
		return task.status.key === 'completed';
	}

	if (tab === 'core') {
		return task.starred;
	}

	return isIncompleteTaskStatus(task.status.key);
}

export function isTaskCreatedToday(
	task: TaskFileEntry,
	now: Date = new Date(),
): boolean {
	return isSameLocalDate(new Date(task.ctime), now);
}

export function isSameLocalDate(left: Date, right: Date): boolean {
	return (
		left.getFullYear() === right.getFullYear() &&
		left.getMonth() === right.getMonth() &&
		left.getDate() === right.getDate()
	);
}

function isIncompleteTaskStatus(
	statusKey: TaskFileEntry['status']['key'],
): boolean {
	return statusKey === 'todo' || statusKey === 'in-progress';
}
