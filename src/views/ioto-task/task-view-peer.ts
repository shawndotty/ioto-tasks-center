/**
 * 「指针落点 → 目标窗格」反查（[[Research-20261031-204852]] §4.2 /
 * [[Plan-20261031-205655]] §三.5）。
 *
 * 比调研版省一步：命中元素先 `closest('.ioto-task-view__scroll')` 就地拿到窗格，
 * 再用 `getLeavesOfType('IOTOTask')` + `view.contentEl.contains(scrollEl)` 定位实例。
 * 归属判定一律用 **scrollEl**（不是原始命中元素），这样即便命中元素在两次
 * `evaluateDrop` 之间被目标窗格重绘摘掉，窗格判定依旧成立。
 *
 * 依赖只有视图类型常量（`item-control-bridge`）、滚动容器的选择器
 * （`ioto-task-scroll`）与 `type-only` 的宿主契约 → 无值级环。
 */

import type { App } from 'obsidian';

import { IOTO_TASK_VIEW_TYPE } from './item-control-bridge';
import { IOTO_TASK_SCROLL_SELECTOR } from './ioto-task-scroll';
import type { TaskViewHost } from './task-view-host';

export interface PeerPane {
	/** 命中窗格的视图实例（鸭子类型窄化，不 instanceof）。 */
	view: TaskViewHost;
	scrollEl: HTMLElement;
}

/**
 * 命中元素 → 窗格。缓存只在**一次拖拽手势内**有效：拖拽开始前调用
 * `resetPeerPaneCache()`，否则 `plugin:reload` 重建叶子后可能拿到旧实例。
 */
const paneCache = new Map<HTMLElement, TaskViewHost | null>();

/** 清空「scrollEl → 视图」缓存（每次拖拽开始时调用）。 */
export function resetPeerPaneCache(): void {
	paneCache.clear();
}

/** `.ioto-task-view__scroll` → 视图实例（树重建期间 / 非本视图 DOM → `null`）。 */
export function viewOfScrollEl(
	app: App,
	scrollEl: HTMLElement,
): TaskViewHost | null {
	if (paneCache.has(scrollEl)) {
		return paneCache.get(scrollEl) ?? null;
	}
	let found: TaskViewHost | null = null;
	for (const leaf of app.workspace.getLeavesOfType(IOTO_TASK_VIEW_TYPE)) {
		const candidate = leaf.view as unknown as
			| (TaskViewHost & { getViewType?: () => string })
			| null;
		if (!candidate || candidate.getViewType?.() !== IOTO_TASK_VIEW_TYPE) {
			continue;
		}
		if (typeof candidate.renderNote !== 'function') {
			continue;
		}
		if (candidate.contentEl?.contains(scrollEl)) {
			found = candidate;
			break;
		}
	}
	paneCache.set(scrollEl, found);
	return found;
}

/**
 * 命中点 → 窗格（含源窗格自己）；不在任何 IOTOTask 窗格里 → `pane: null`。
 * `el` 恒为真实命中元素（供调用方继续做链接 / 任务行 / 卡片判定）。
 */
export function resolvePeerPaneAtPoint(
	app: App,
	doc: Document,
	x: number,
	y: number,
): { el: HTMLElement | null; pane: PeerPane | null } {
	const el = doc.elementFromPoint(x, y) as HTMLElement | null;
	if (!el) {
		return { el: null, pane: null };
	}
	const scrollEl = el.closest<HTMLElement>(IOTO_TASK_SCROLL_SELECTOR);
	if (!scrollEl) {
		return { el, pane: null };
	}
	const view = viewOfScrollEl(app, scrollEl);
	return { el, pane: view ? { view, scrollEl } : null };
}
