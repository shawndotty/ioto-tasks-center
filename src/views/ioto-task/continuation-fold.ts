/**
 * 卡片续写区折叠（[[Plan-20261022-232148]] S1）。
 *
 * 纯函数层 = 键计算 + 强制展开判据；DOM 应用层只动**一个**容器的类 / aria /
 * tooltip，不重建 DOM、不写视图状态（状态在 `IOTOTaskView.continuationCollapsed`）。
 * 组织范式同 `search-highlight.ts`：纯函数零 `obsidian` / 零 DOM，可被 jiti 直接导入单测。
 *
 * 🔴 折叠态**不重绘**：`renderNote` 会重跑滚动快照恢复、选中回填、`restoreZoom`、
 * 命令就绪补偿与进出场动画（`task-view-render.ts`），代价与「切一个显隐」不成比例。
 * 能重绘的场合（续行提交）本来就走整树重建，键随内容变化自然收敛。
 */

import { findMatchRanges } from './search-highlight';

/** 折叠态类名（挂在 `.card-continuation` 上；导出摘的就是它）。 */
export const CONTINUATION_COLLAPSED_CLASS = 'is-continuation-collapsed';
/** 折叠箭头（唯一常驻入口，落在卡片左槽位）。 */
export const CONTINUATION_TOGGLE_CLASS = 'ioto-task-view__continuation-toggle';
/** 折叠后的「续写 · N 行」占位条（第二个展开入口）。 */
export const CONTINUATION_SUMMARY_CLASS = 'ioto-task-view__continuation-summary';

/**
 * 折叠态键 = 续写正文的 FNV-1a 32 位哈希。
 *
 * 🔴 先把 CRLF 归一成 LF：渲染层用 `content.split(/\r?\n/)` 取行，续行编辑入口用
 * `view.data.split('\n')` 取行（`task-view-continuation-edit.ts`），同一个 CRLF 文件
 * 在两侧会差出 `\r` → 键对不上 → 折叠记忆永远失效。
 */
export function continuationFoldKey(markdown: string): string {
	const normalized = markdown.replace(/\r\n?/g, '\n');
	let hash = 0x811c9dc5;
	for (let index = 0; index < normalized.length; index += 1) {
		hash ^= normalized.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return `c${hash.toString(16).padStart(8, '0')}`;
}

/** 本次渲染是否必须展开（只影响本次 DOM，**不改**用户折叠态）。 */
export function shouldForceExpand(input: {
	continuation: string | undefined;
	normalizedQuery: string;
	/** 该卡正在被编辑（标题或续行）→ 内容必须可见 */
	editing?: boolean;
}): boolean {
	if (input.editing === true) {
		return true;
	}
	const { continuation, normalizedQuery } = input;
	if (!continuation || normalizedQuery.length === 0) {
		return false;
	}
	// 与过滤 / 高亮同源：`isCardVisible` 判定「卡可见」用的就是它
	return findMatchRanges(continuation, normalizedQuery).length > 0;
}

/** 只动一个容器的类 / aria / tooltip；不重建 DOM、不写状态。 */
export function applyContinuationFoldState(
	continuationEl: HTMLElement,
	collapsed: boolean,
): void {
	continuationEl.classList.toggle(CONTINUATION_COLLAPSED_CLASS, collapsed);
	const toggleEl = continuationEl.querySelector<HTMLElement>(
		`.${CONTINUATION_TOGGLE_CLASS}`,
	);
	toggleEl?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
	// 文案两条都预先挂在 DOM 上（渲染层写入），纯模块不引 i18n。
	const label = collapsed
		? toggleEl?.dataset.labelCollapsed
		: toggleEl?.dataset.labelExpanded;
	if (toggleEl && label) {
		toggleEl.setAttribute('aria-label', label);
		toggleEl.setAttribute('title', label);
	}
	// 折叠时整块都是「展开」入口：容器 tooltip 必须换掉（否则仍是「点击编辑」）
	const hint = collapsed
		? toggleEl?.dataset.labelCollapsed
		: continuationEl.dataset.hintExpanded;
	if (hint !== undefined) {
		continuationEl.setAttribute('title', hint);
	}
}
