/**
 * 续写区折叠控制器（[[Plan-20261022-232148]] S2）。
 *
 * 状态真源是 `TaskViewHost.continuationCollapsed`（`Set<string>`，键 = 续写正文哈希），
 * **内存真源**；跨会话镜像落在 localStorage，存取收口在 `task-view-fold-store.ts`
 * （[[Plan-20261023-001403]]）。`getState` / `setState` 仅作一次性迁移来源。
 * 控制器只做「查 / 切换」，DOM 应用交给纯模块 `applyContinuationFoldState`。
 */

import {
	applyContinuationFoldState,
	collectContinuationFoldKeys,
} from './continuation-fold';
import {
	createFoldStorage,
	resolveContinuationFolds,
	saveContinuationFolds,
} from './task-view-fold-store';
import type { TaskContinuationFold } from './render-note-types';
import type { TaskViewHost } from './task-view-host';

export function buildContinuationFoldController(
	view: TaskViewHost,
): TaskContinuationFold {
	return {
		isCollapsed: (key) => view.continuationCollapsed.has(key),
		toggle: (key, continuationEl) => {
			const collapsed = !view.continuationCollapsed.has(key);
			if (collapsed) {
				view.continuationCollapsed.add(key);
			} else {
				view.continuationCollapsed.delete(key);
			}
			applyContinuationFoldState(continuationEl, collapsed);
			persistContinuationFolds(view);
		},
	};
}

/**
 * 进续行编辑前调用：删键（写回状态）+ 由调用方摘 DOM 类。
 *
 * 🔴 必须删键而不只是摘类：续行提交走整树重建，只摘类会在重绘后按陈旧键重新折回去，
 * 用户看到的是「一进编辑就展开、一提交又收起」。
 *
 * 🔴 也必须落盘：不落盘时「进编辑 → `Esc`（内容没改）→ 重载」会把折叠态复活
 * （键还是原来那个哈希，而 store 里仍记着它）。
 */
export function forgetContinuationFold(view: TaskViewHost, key: string): void {
	view.continuationCollapsed.delete(key);
	persistContinuationFolds(view);
}

/** 当前文件是否有任何续写区（命令门禁用；只读 `view.data`，不扫 DOM）。 */
export function hasContinuationFolds(view: TaskViewHost): boolean {
	return collectContinuationFoldKeys(view.data ?? '').length > 0;
}

/**
 * 二态切换**全文件**的全部续写区（[[Plan-20261024-060243]] S2）。
 *
 * - 作用域取 `view.data` 而非 DOM：被过滤 / 被放大隐藏的卡也要进集合，
 *   否则关掉过滤后它们仍是旧态（计划 §3.2 场景 4）。
 * - 二态判据：全部已折叠 → 展开，否则折叠；空集短路返回 `false`。
 * - 逐键 `add` / `delete`，**不** `clear()` 重写：保留历史死键（D4）。
 * - 只对**已渲染**节点应用，跳过 `data-cont-force`（编辑中 / 续写命中搜索）；
 *   这些节点连键都不 add —— 否则提交后整树重建会把刚编辑完的卡折上。
 * - 落盘在循环外只调一次；不重绘（D9）。
 *
 * @returns 是否真的改了（`false` = 该笔记没有任何续写区）
 */
export function toggleAllContinuationFolds(view: TaskViewHost): boolean {
	const keys = collectContinuationFoldKeys(view.data ?? '');
	if (keys.length === 0) {
		return false;
	}
	const collapse = !keys.every((key) => view.continuationCollapsed.has(key));
	const nodes = view.contentEl.querySelectorAll<HTMLElement>(
		'.ioto-task-view__card-continuation[data-cont-key]',
	);
	// 强制展开的卡（编辑中 / 续写命中搜索）连键都不 add：键一旦落进集合，提交后的
	// 整树重建会立刻把刚编辑完的卡折上（计划 §5 风险 4 / 验收「不污染集合」）。
	const forcedKeys = new Set<string>();
	for (const el of Array.from(nodes)) {
		const key = el.dataset.contKey;
		if (el.dataset.contForce === '1' && key) {
			forcedKeys.add(key);
		}
	}
	for (const key of keys) {
		if (!collapse) {
			view.continuationCollapsed.delete(key);
			continue;
		}
		if (!forcedKeys.has(key)) {
			view.continuationCollapsed.add(key);
		}
	}
	for (const el of Array.from(nodes)) {
		if (el.dataset.contForce === '1') {
			continue;
		}
		applyContinuationFoldState(el, collapse);
	}
	persistContinuationFolds(view);
	return true;
}
/**
 * 装载时调用（`setViewData` 的 `clear === true` 分支、`renderNote` 之前）。
 *
 * 顺序有讲究：先取走 `setState` 暂存的 legacy 键、再归零集合、最后按路径从 store 灌回。
 * 集合归零后再灌是幂等的（`clear()` 已清过一次，这里覆盖「clear 被绕过」的调用方）。
 *
 * `pending` 用**默认参数**：`setViewData` 里与 `hydrateSectionFolds` 共用同一份
 * （`takePendingLeafFolds()` 取走即清空，各 take 一次会有一个拿到 `null`）。
 */
export function hydrateContinuationFolds(
	view: TaskViewHost,
	pending = view.takePendingLeafFolds(),
): void {
	const storage = createFoldStorage(view.app);
	const path = view.file?.path ?? '';
	// 认领范围限定「同一文件」（或 path 缺失的老状态），防叶子复用把 A 的键串给 B。
	view.continuationCollapsed.clear();
	const legacy =
		pending && (pending.path === '' || pending.path === path)
			? pending.continuations
			: [];
	if (!storage || !path) {
		// 老客户端（无 localStorage API）/ 尚未绑定文件 → 退化为今天的行为。
		for (const key of legacy) {
			view.continuationCollapsed.add(key);
		}
		return;
	}
	for (const key of resolveContinuationFolds(storage, path, legacy)) {
		view.continuationCollapsed.add(key);
	}
}

/**
 * 显式折叠 / 展开 / 进编辑删键之后调用：整份镜像落盘（不 debounce，量级只有几次点击）。
 *
 * 空集合也写 `[]`：这是「展开后重载仍是展开」的凭据（区别于「从没记录」）。
 */
export function persistContinuationFolds(view: TaskViewHost): void {
	const storage = createFoldStorage(view.app);
	const path = view.file?.path;
	if (!storage || !path) {
		return;
	}
	saveContinuationFolds(storage, path, [...view.continuationCollapsed]);
}
