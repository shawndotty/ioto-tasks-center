/**
 * 卡片下方「正在润色…」状态条（Plan-20261125-212649 §四）。
 *
 * 状态真源在视图（`task-polish-status.ts`），本模块只负责：
 * 查卡 → 取权威正文指纹 → 命中判定 → 幂等绘制 / 移除。
 *
 * 落位是卡片**子元素末尾**：`renderCardActions` 在续行容器之前调用，靠 CSS
 * `order: 2` + DOM 在后，视觉上排在续行之后、动作底栏之前（§4.3）。
 * 它不在 `.card-actions` 子树内，`refreshCardActions` 的 `empty()` 碰不到它。
 */

import { setIcon } from 'obsidian';

import { t } from '../../lang/helpter';
import { parseChecklistItems } from '../../tasks-center/note-structure';
import { getPolishTaskKey, isPolishRunningFor } from './task-polish-status';
import { queryCard } from './task-view-helpers';
import type { TaskViewHost } from './task-view-host';

export const POLISH_STATUS_CLASS = 'ioto-task-view__polish-status';
const POLISH_STATUS_ICON_CLASS = 'ioto-task-view__polish-status-icon';
const POLISH_STATUS_TEXT_CLASS = 'ioto-task-view__polish-status-text';

/**
 * 幂等绘制：`running = true` 时创建 / 复用状态条并置 `aria-busy`；
 * `false` 时移除节点并清 `aria-busy`（无记录时的残留清理也走这里）。
 */
export function renderPolishStatus(
	cardEl: HTMLElement,
	running: boolean,
): void {
	const existing = cardEl.querySelector<HTMLElement>(
		`.${POLISH_STATUS_CLASS}`,
	);
	if (!running) {
		existing?.remove();
		cardEl.removeAttribute('aria-busy');
		return;
	}

	cardEl.setAttribute('aria-busy', 'true');
	if (existing) {
		return;
	}

	const statusEl = cardEl.createDiv({
		cls: POLISH_STATUS_CLASS,
		attr: { role: 'status', 'aria-live': 'polite' },
	});
	const iconEl = statusEl.createSpan({
		cls: POLISH_STATUS_ICON_CLASS,
		attr: { 'aria-hidden': 'true' },
	});
	setIcon(iconEl, 'loader');
	statusEl.createSpan({
		cls: POLISH_STATUS_TEXT_CLASS,
		text: t('polish.description.running'),
	});
}

/**
 * 单卡派生重绘：卡片不在 DOM（折叠 / 过滤 / 视口外 / 行漂移）时静默返回，
 * 由后续整树渲染自然补齐；无记录时主动清掉可能残留的节点。
 */
export function refreshPolishStatus(view: TaskViewHost, line: number): void {
	const cardEl = queryCard(view, line);
	if (!cardEl) {
		return;
	}
	if (getPolishTaskKey(view, line) === undefined) {
		renderPolishStatus(cardEl, false);
		return;
	}
	// 权威键必须从 `view.data` 重新解析：`data-task-key` 只在建元素时写入，
	// flush 提交后它就是旧值（§3.3）。
	const currentKey =
		parseChecklistItems(view.data, { includeEmpty: true }).find(
			(entry) => entry.line === line,
		)?.text ?? '';
	renderPolishStatus(cardEl, isPolishRunningFor(view, line, currentKey));
}