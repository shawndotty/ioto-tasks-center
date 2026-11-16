/**
 * 优先级四象限视图的常量（[[Plan-20261115-201917]] §3.4 / §五 #2）。
 *
 * 视图类型刻意放在独立叶子模块：`task-view-routing` 只依赖常量、不依赖视图类，
 * 避免「routing → view → routing」的值级环。
 */

export const IOTO_PRIORITY_QUADRANT_VIEW_TYPE = 'IOTOPriorityQuadrant';

export const QUADRANT_LOADING_RENDER_DELAY_MS = 120;

export const QUADRANT_BODY_CLASS = 'ioto-pq-body';

export const QUADRANT_CARD_CLASS = 'ioto-pq-card';

/**
 * 叶子视图状态里的显隐位（[[Plan-20261116-060249]] §3.2）。
 * 只认 boolean：老 / 脏 `workspace.json` 里的字符串一律忽略，回到默认隐藏。
 */
export function parseQuadrantViewState(state: unknown): {
	sidebarOpen?: boolean;
} {
	if (!state || typeof state !== 'object') return {};
	const candidate = state as Record<string, unknown>;
	return typeof candidate.sidebarOpen === 'boolean'
		? { sidebarOpen: candidate.sidebarOpen }
		: {};
}
