/**
 * Task View 多选状态模型（[[Plan-20261101-054951]] §四.步骤 1）。
 *
 * 双层状态：`selectedLine`（锚点，既有语义不变）+ `multiLines`（附加成员，
 * **不含锚点**）。本模块是这套状态的唯一迁移点：⌘/Ctrl 点选与空白框选都只
 * 通过 `commitMultiSelection` 落一次真源。
 *
 * 🔴 不变量用「锚点快照」表达，不用「锚点在集合里」：
 * `multiAnchor` 记录这套成员属于哪个锚点，`multiAnchor !== selectedLine` ⇒ 集合
 * 作废（自动收窄为单选）。这样 24 处直写 `selectedLine` 的既有通路（过滤平移、
 * 搜索跳转、节聚焦回退、跨文件搬运…）都不必改，一改锚点就自动收窄。
 *
 * 纯函数部分（`toggleMultiMember` / `collapseMulti` / `pruneMembers` /
 * `resolveMultiMembers`）零 DOM、零 obsidian 值依赖，可 jiti 直导单测；
 * 有 DOM 的一面（`commitMultiSelection` 等）只接触视图契约。
 */

import { collectCardLines } from './card-navigation';
import { hasLiveEditor } from './task-view-editing-state';
import type { TaskViewHost } from './task-view-host';

/** 多选态（成员不含锚点；顺序 = DOM 顺序，锚点顺延要用它）。 */
export interface MultiSelection {
	anchor: number | null;
	members: number[];
}

/** 空态：无锚点、无成员。 */
export const EMPTY_MULTI_SELECTION: MultiSelection = {
	anchor: null,
	members: [],
};

/**
 * 🔴 不变量：集合只在「锚点仍是当初那个」时有效；否则视作空
 * （多选自动收窄为单选）。
 *
 * `members` 里若出现锚点本身（外部脏写），一并剔除——集合按定义不含锚点。
 */
export function resolveMultiMembers(
	anchor: number | null,
	setAnchor: number | null,
	members: ReadonlySet<number>,
): number[] {
	if (anchor === null || setAnchor !== anchor || members.size === 0) {
		return [];
	}
	return [...members].filter((line) => line !== anchor);
}

/** DOM 顺序下的序号；不在可见集里的行排到最后（稳定）。 */
function orderKey(order: readonly number[], line: number): number {
	const index = order.indexOf(line);
	return index < 0 ? Number.POSITIVE_INFINITY : index;
}

/** 按 DOM 顺序重排成员（集合语义，去重）。 */
function sortByOrder(
	lines: readonly number[],
	order: readonly number[],
): number[] {
	const seen = new Set<number>();
	const unique: number[] = [];
	for (const line of lines) {
		if (seen.has(line)) {
			continue;
		}
		seen.add(line);
		unique.push(line);
	}
	return unique.sort((a, b) => orderKey(order, a) - orderKey(order, b));
}

/**
 * ⌘/Ctrl 点选的全部语义（纯函数）。`order` = 当前可见卡的 DOM 顺序
 * （`collectCardLines`）。
 *
 * | 当前态 | 操作 | 结果 |
 * | --- | --- | --- |
 * | 无锚点 | ⌘+点击任意卡 | 该卡成为锚点，集合为空（等价单选） |
 * | 单选 | ⌘+点击**另一张**卡 | 旧锚点转入集合，新卡成为锚点 |
 * | 多选 | ⌘+点击**集合内**成员 | 从集合移除，锚点不变 |
 * | 多选 | ⌘+点击**锚点本身** | 锚点顺延到集合内 DOM 顺序的第一个成员 |
 * | 单选 | ⌘+点击**锚点** | no-op（不允许把选择清成 0——键盘就没有落点了） |
 */
export function toggleMultiMember(
	state: MultiSelection,
	line: number,
	order: readonly number[],
): MultiSelection {
	const anchor = state.anchor;
	if (anchor === null) {
		return { anchor: line, members: [] };
	}

	// 点锚点本身：单选 → no-op；多选 → 锚点顺延到 DOM 顺序的第一个成员
	if (line === anchor) {
		if (state.members.length === 0) {
			return state;
		}
		const [nextAnchor, ...rest] = state.members;
		return { anchor: nextAnchor ?? null, members: rest };
	}

	// 点集合内成员 → 移除（锚点不变）
	if (state.members.includes(line)) {
		return {
			anchor,
			members: state.members.filter((member) => member !== line),
		};
	}

	// 点集合外另一张卡 → 旧锚点转入集合，新卡成为锚点
	return {
		anchor: line,
		members: sortByOrder([...state.members, anchor], order),
	};
}

/** Esc / 普通点击：收窄为锚点单选。 */
export function collapseMulti(state: MultiSelection): MultiSelection {
	if (state.members.length === 0) {
		return state;
	}
	return { anchor: state.anchor, members: [] };
}

/** 可见性剪枝：换节聚焦 / 过滤后清掉看不见的成员（保留锚点）。 */
export function pruneMembers(
	state: MultiSelection,
	visible: readonly number[],
): MultiSelection {
	if (state.members.length === 0) {
		return state;
	}
	const allowed = new Set(visible);
	const members = state.members.filter((line) => allowed.has(line));
	if (members.length === state.members.length) {
		return state;
	}
	return { anchor: state.anchor, members };
}

/* ------------------------------------------------------------------ *
 * 视图侧：唯一写点（`check-view-writes` 白名单登记在这三个字段上）
 * ------------------------------------------------------------------ */

/** 当前的逻辑多选态（已按不变量收窄）。 */
export function currentMultiSelection(view: TaskViewHost): MultiSelection {
	const anchor = view.selectedLine;
	return {
		anchor,
		members: resolveMultiMembers(anchor, view.multiAnchor, view.multiLines),
	};
}

/** 清空附加成员并卸掉它们的 `.is-selected`（幂等）；**不动**锚点本身。 */
export function clearMultiSelection(view: TaskViewHost): void {
	if (view.multiAnchor === null && view.multiLines.size === 0) {
		return;
	}
	// 先按裸集合卸类（含已被不变量判作废的 stale 成员），避免留下画错的选中态
	for (const line of view.multiLines) {
		view.queryCard(line)?.removeClass('is-selected');
	}
	view.multiLines = new Set();
	view.multiAnchor = null;
}

/**
 * 唯一写点：把 `next` 落到视图状态 + DOM 类（**不整树重绘**——重绘会把
 * `scrollTop` 归零）。
 *
 * ① 卸旧类（旧锚点若易主 + 旧的有效成员）→ ② 写三个字段 → ③ 加新类 →
 * ④ 锚点卡聚焦（`preventScroll`，框选不该跳视口）→ ⑤ 刷新删除按钮。
 */
export function commitMultiSelection(
	view: TaskViewHost,
	next: MultiSelection,
): void {
	const prevAnchor = view.selectedLine;
	const prevMembers = resolveMultiMembers(
		view.selectedLine,
		view.multiAnchor,
		view.multiLines,
	);

	if (prevAnchor !== null && prevAnchor !== next.anchor) {
		view.queryCard(prevAnchor)?.removeClass('is-selected');
	}
	for (const line of prevMembers) {
		if (line !== next.anchor && !next.members.includes(line)) {
			view.queryCard(line)?.removeClass('is-selected');
		}
	}

	view.selectedLine = next.anchor;
	view.multiAnchor = next.anchor;
	view.multiLines = new Set(next.members);

	const anchorCard =
		next.anchor === null ? null : view.queryCard(next.anchor);
	anchorCard?.addClass('is-selected');
	for (const line of next.members) {
		view.queryCard(line)?.addClass('is-selected');
	}
	anchorCard?.focus({ preventScroll: true });

	view.refreshDeleteButtonVisibility();
}

/**
 * 纯函数：按行号映射迁移多选态（[[Plan-20261101-063126]] §四.步骤 2a）。
 *
 * - 成员映射为 `null`（所在行被规范化掉）→ 丢弃；
 * - 锚点映射为 `null`（锚点行没了）→ 整组作废（不变量要求集合必须挂在一个锚点上，
 *   没有锚点就没有键盘落点）。
 */
export function mapMultiState(
	state: MultiSelection,
	mapLine: (line: number) => number | null,
): MultiSelection {
	const anchor = state.anchor === null ? null : mapLine(state.anchor);
	const kept = state.members
		.map((line) => mapLine(line))
		.filter((line): line is number => line !== null);
	return anchor === null ? EMPTY_MULTI_SELECTION : { anchor, members: kept };
}

/**
 * 🔴 迁移多选的两个附加字段（**不碰 `selectedLine`**——那个由 `remapTrackedLines`
 * 负责，这里再写一次会与它抢同一个字段）。
 *
 * 场景：整组拖拽 / 互换 / 缩进等任何「按行号移动块」操作写盘后。只迁锚点会让
 * 不变量 `multiAnchor !== selectedLine` 立刻把集合判作废 → 拖完多选就没了。
 */
export function remapMultiFields(
	view: TaskViewHost,
	mapLine: (line: number) => number | null,
): void {
	if (view.multiAnchor === null && view.multiLines.size === 0) {
		return;
	}
	const next = mapMultiState(currentMultiSelection(view), mapLine);
	view.multiAnchor = next.anchor;
	view.multiLines = new Set(next.members);
}

/**
 * 多选门禁（[[Plan-20261101-054951]] §四.4c）：放大 / 任一编辑器 / 只读态
 * 一律不进入多选。返回 `false` 时调用方应原样放行事件。
 */
export function canMultiSelect(view: TaskViewHost): boolean {
	if (!view.supportsInlineEdit()) {
		return false;
	}
	if (view.zoomLine !== null) {
		return false;
	}
	return !hasLiveEditor(view.editingKind);
}

/** ⌘/Ctrl 点选入口：读 DOM 顺序 → `toggleMultiMember` → commit。 */
export function toggleMulti(view: TaskViewHost, line: number): void {
	if (!canMultiSelect(view)) {
		return;
	}
	const order = collectCardLines(view.contentEl);
	commitMultiSelection(
		view,
		toggleMultiMember(currentMultiSelection(view), line, order),
	);
}

/** 选择数量：1 = 纯单选，0 = 无选中。 */
export function activeMultiCount(view: TaskViewHost): number {
	const { anchor, members } = currentMultiSelection(view);
	return (anchor === null ? 0 : 1) + members.length;
}

/** 该行是否属于当前的附加成员集合（锚点不算）。 */
export function isMultiSelected(view: TaskViewHost, line: number): boolean {
	return currentMultiSelection(view).members.includes(line);
}

/** Esc / 普通点击：收窄为锚点单选；返回是否真的收窄过。 */
export function collapseMultiSelection(view: TaskViewHost): boolean {
	const state = currentMultiSelection(view);
	if (state.members.length === 0) {
		return false;
	}
	commitMultiSelection(view, collapseMulti(state));
	return true;
}
