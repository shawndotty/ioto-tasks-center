/**
 * 「只看本节」：Section 级布局聚焦（[[Research-20261019-131228]] §2/§4）。
 *
 * 与两套既有隔离的区别：
 * - **节聚焦是布局态**（`sectionZoomLine` + `.is-section-zoomed` + CSS `:has()`）：
 *   不改交互、不建浮层、不重绘，节内卡片照常选中 / 编辑 / 搜索。
 * - 节**正文编辑**（`sectionEditLine` + `.is-editing`）是交互态，二者正交；
 * - 卡**片放大**（`zoomLine` + `.is-zoomed`）是更内层的 drill-down，可嵌套。
 *
 * 🔴 类名 / 状态字段必须独立于卡片放大：`exitZoom` 用
 * `querySelectorAll('.is-zoom-hidden, .is-zoomed')` 一次性清类，复用同名会把
 * 节聚焦的隔离一并清掉（§1.3）。
 */

import { setIcon } from 'obsidian';

import { t } from '../../lang/helpter';
import { parseSections, type NoteSection } from '../../tasks-center/note-structure';
import type { TaskViewHost } from './task-view-host';
import { getSectionStateKey } from './render-sections';
import {
	queryCard,
	queryScrollEl,
	querySectionEl,
} from './task-view-helpers';
import { persistSectionFolds } from './task-view-section-fold';

/** 唯一的 DOM 真源类名（导出时按瞬时态摘除）。 */
export const SECTION_ZOOM_CLASS = 'is-section-zoomed';

/** 聚焦锚点：`startLine` + `level > 0`（与编辑链路同口径；改名不改 startLine）。 */
export function resolveSectionZoomTarget(
	sections: NoteSection[],
	startLine: number,
): NoteSection | null {
	return (
		sections.find(
			(section) => section.startLine === startLine && section.level > 0,
		) ?? null
	);
}

/** 读卡片所属 Section 的 `data-start-line`（非 DOM / 未命中返回 `null`）。 */
export function readCardSectionStartLine(
	cardEl: HTMLElement | null,
): number | null {
	const sectionEl =
		cardEl?.closest<HTMLElement>('.ioto-task-view__section') ?? null;
	const raw = sectionEl?.dataset.startLine;
	if (raw === undefined) {
		return null;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

/** 卡片是否属于**当前聚焦**的节；未聚焦时恒为 `true`（调用方无需先判空）。 */
export function isCardInZoomedSection(
	view: TaskViewHost,
	cardEl: HTMLElement | null,
): boolean {
	if (view.sectionZoomLine === null) {
		return true;
	}
	return readCardSectionStartLine(cardEl) === view.sectionZoomLine;
}

/** 幂等开关：同一节再次触发 = 退出。 */
export function toggleSectionZoom(
	view: TaskViewHost,
	startLine: number,
): void {
	if (view.sectionZoomLine === startLine) {
		exitSectionZoom(view);
		return;
	}
	enterSectionZoom(view, startLine);
}

/**
 * 进入聚焦：**纯 DOM 开关**，不重绘、不新建浮层、不动编辑器。
 *
 * 顺序有讲究：
 * 1. 先收内层卡片放大（`zoomLine` 在更内层，进节聚焦要回到「整节」面）；
 * 2. 再记「之前的状态」（滚动位置 / 选中行）——必须在任何重绘前取旧 DOM 的值；
 * 3. 折叠节先展开（走整树重建，类由 `restoreSectionZoom` 回填）。
 */
export function enterSectionZoom(
	view: TaskViewHost,
	startLine: number,
): void {
	if (!view.supportsInlineEdit() || !view.file) {
		return;
	}
	if (view.zoomLine !== null) {
		view.exitZoom();
	}

	// 防御：UI 上聚焦态只有一节可见，切不到另一节；若经 API 直接换目标，
	// 先摘掉旧节的类，保证「同时最多一节聚焦」这条不变量。
	const previous = view.sectionZoomLine;
	if (previous !== null && previous !== startLine) {
		querySectionEl(view, previous)?.removeClass(SECTION_ZOOM_CLASS);
	}

	const section = resolveSectionZoomTarget(
		parseSections(view.data ?? ''),
		startLine,
	);
	if (!section) {
		return;
	}

	view.sectionZoomScrollTop = queryScrollEl(view)?.scrollTop ?? null;
	const prev = view.selectedLine;
	view.sectionZoomPrevSelectedLine = prev;
	// 真源先置：渲染层据此画 minimize 图标。
	view.sectionZoomLine = startLine;

	// 选中卡在别的节 → 清掉可见选中类（退出时尽力回填，见 `restorePrevSelection`）。
	if (prev !== null && !isCardInZoomedSection(view, queryCard(view, prev))) {
		view.selectedLine = null;
		queryCard(view, prev)?.removeClass('is-selected');
		view.refreshDeleteButtonVisibility();
	}

	const key = getSectionStateKey(section);
	if (view.collapsedSections.has(key)) {
		view.collapsedSections.delete(key);
		// 隐式展开也要落盘（[[Plan-20261023-062616]] S5）：否则「只看本节 → 退出 →
		// 重载」会把折叠态复活。🔴 必须在 `return` 之前写。
		persistSectionFolds(view);
		// 跨「全部可见 → 单节」两种布局，滚动快照必然失真 → 跳过并归顶。
		view.renderNote(view.data, { resetScroll: true });
		return;
	}

	applySectionZoomDom(view, startLine);
	// 只看本节 = 从本节顶部看起。
	const scrollEl = queryScrollEl(view);
	if (scrollEl) {
		scrollEl.scrollTop = 0;
	}
}

/**
 * 退出聚焦（幂等）：摘类 → 恢复进入前滚动位置 → 尽力回填选中。
 *
 * 滚动用 setter 写回（浏览器自带 clamp）；选中只在「聚焦期间没重新选过」时回填，
 * 且不 focus / 不滚动，避免打断用户当前操作。
 */
export function exitSectionZoom(view: TaskViewHost): void {
	const line = view.sectionZoomLine;
	if (line === null) {
		return;
	}
	// 内层先收：卡片放大在节聚焦之内。
	if (view.zoomLine !== null) {
		view.exitZoom();
	}

	view.sectionZoomLine = null;
	const sectionEl = querySectionEl(view, line);
	sectionEl?.removeClass(SECTION_ZOOM_CLASS);
	syncSectionZoomButton(view, sectionEl);

	const scrollEl = queryScrollEl(view);
	if (scrollEl && view.sectionZoomScrollTop !== null) {
		scrollEl.scrollTop = view.sectionZoomScrollTop;
	}

	restorePrevSelection(view);

	view.sectionZoomScrollTop = null;
	view.sectionZoomPrevSelectedLine = null;
}

/**
 * 重绘后回填：目标仍存在才上类，否则静默清除状态（不弹 Notice）。
 *
 * 🔴 必须在 `restoreIotoTaskScroll` **之前**调用：滚动锚点取「第一张底边越过视口
 * 顶的卡」，先上类才能让快照与「单节」布局一致（§4.5）。
 */
export function restoreSectionZoom(view: TaskViewHost): void {
	const line = view.sectionZoomLine;
	if (line === null) {
		return;
	}

	const section = resolveSectionZoomTarget(
		parseSections(view.data ?? ''),
		line,
	);
	const sectionEl = querySectionEl(view, line);
	if (!section || !sectionEl) {
		resetSectionZoomState(view);
		return;
	}

	applySectionZoomDom(view, line);
}

/** 静默清零聚焦状态（不碰 DOM：调用方要么已重建，要么正在重建）。 */
export function resetSectionZoomState(view: TaskViewHost): void {
	view.sectionZoomLine = null;
	view.sectionZoomScrollTop = null;
	view.sectionZoomPrevSelectedLine = null;
}

/** 唯一真源 = `<section>` 上的 `.is-section-zoomed`（不重建 → 只此一处上类）。 */
function applySectionZoomDom(view: TaskViewHost, startLine: number): void {
	const sectionEl = querySectionEl(view, startLine);
	if (!sectionEl) {
		return;
	}
	sectionEl.addClass(SECTION_ZOOM_CLASS);
	syncSectionZoomButton(view, sectionEl);
}

/**
 * 就地翻面按钮图标与文案：切换是纯 DOM 开关，不重建动作区，故须手动同步
 * （同 `syncZoomButton` 口径）。
 */
export function syncSectionZoomButton(
	view: TaskViewHost,
	sectionEl: HTMLElement | null,
): void {
	const btn = sectionEl?.querySelector<HTMLElement>(
		'[data-action="toggle-section-zoom"]',
	);
	if (!btn) {
		return;
	}
	const zoomed = view.sectionZoomLine !== null;
	const label = t(
		zoomed
			? 'view.iotoTaskView.sectionZoomOut'
			: 'view.iotoTaskView.sectionZoomIn',
	);
	setIcon(btn, zoomed ? 'minimize-2' : 'maximize-2');
	btn.setAttribute('aria-label', label);
	btn.setAttribute('title', label);
	btn.setAttribute('aria-pressed', zoomed ? 'true' : 'false');
}

function restorePrevSelection(view: TaskViewHost): void {
	const prev = view.sectionZoomPrevSelectedLine;
	if (prev === null) {
		return;
	}
	// 聚焦期间用户已重新选中 → 以当前选中为准，不覆盖。
	if (view.selectedLine !== null) {
		return;
	}
	const cardEl = queryCard(view, prev);
	if (!cardEl) {
		return;
	}
	view.selectedLine = prev;
	cardEl.addClass('is-selected');
	view.refreshDeleteButtonVisibility();
}
