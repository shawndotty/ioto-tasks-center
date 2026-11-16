import { setIcon } from 'obsidian';

/** 窄屏过滤控件图标（[[Plan-20261116-095729]] §3.1）；宽屏由 CSS 隐藏。 */
export const QUADRANT_CONTROL_ICONS = {
	status: 'list-checks',
	time: 'calendar-range',
	unlabeled: 'inbox',
} as const;

/** 预置图标：宽屏由 CSS 隐藏，窄屏与文字互换；可访问名仍由按钮 aria-label 提供。 */
export function createQuadrantControlIcon(
	parent: HTMLElement,
	cls: string,
	icon: string,
): HTMLElement {
	const iconEl = parent.createSpan({ cls });
	setIcon(iconEl, icon);
	iconEl.setAttribute('aria-hidden', 'true');
	return iconEl;
}