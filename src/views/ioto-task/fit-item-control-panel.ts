/**
 * 「条目控制」面板的视口避让（[[Plan-20261003-165927]]，依据 [[Research-20261003-165115]] §五 A）。
 *
 * 问题：`ioto-settings` 的 `positionPanel()` 把面板无条件放在锚点下方
 * （`top = anchor.bottom + 8`），垂直方向零视口判断 → 卡片贴近视口底部时面板
 * 溢出屏幕；且面板打开后立即 `registerCloseOnLeave()`，任何「目标不在面板内」的
 * 滚动都会关闭它 → 被裁掉的部分滚不到也点不到。
 *
 * 修法（不改 `ioto-settings`，只在桥接层补一拍定位）：面板在文档中之后，按真实
 * 高度做「先试下方 → 放不下翻上方 → 都放不下夹到视口内」的经典翻转逻辑，只写
 * `style.top` / `style.left`（超高时附 `maxHeight` / `overflowY`），**不调用任何
 * scroll API**，因此不会踩到 `registerCloseOnLeave`。
 *
 * 本文件不 import 运行期的 `obsidian`（宿主类型走 type-only），纯函数可被 jiti 单测。
 */

import type { ItemControlBridgeHost } from '../iotoTaskView';

/** 面板根节点：`ioto-settings` 的 Modal 容器带 `ioto-item-control-modal`，被定位的是其子 `.modal`。 */
export const PANEL_SELECTOR = '.ioto-item-control-modal .modal';

/** 面板比视口还高时挂上的内部滚动类（规则见 styles.css）。 */
const SCROLL_CLASS = 'ioto-item-control-modal--fit-scroll';

/** 视口四周留白。 */
const MARGIN = 8;
/** 卡片与面板间距（与 ioto-settings 一致）。 */
const GAP = 8;
/** 水平夹取右留白（与 ioto-settings 一致）。 */
const EDGE_GAP = 16;

export interface PanelPlacementInput {
	/** 卡片 top（window 坐标） */
	anchorTop: number;
	/** 卡片 bottom（window 坐标） */
	anchorBottom: number;
	/** 卡片 left（window 坐标） */
	anchorLeft: number;
	/** 面板 offsetHeight */
	panelHeight: number;
	/** 面板 offsetWidth */
	panelWidth: number;
	/** window.innerHeight */
	viewportHeight: number;
	/** window.innerWidth */
	viewportWidth: number;
	/** 视口四周留白，默认 8 */
	margin?: number;
	/** 卡片与面板间距，默认 8 */
	gap?: number;
	/** 水平夹取右留白，默认 16 */
	edgeGap?: number;
}

export interface PanelPlacement {
	top: number;
	left: number;
	/** 是否翻转到卡片上方（供真机/调试断言） */
	flipped: boolean;
}

/**
 * 纯几何：默认仍在卡片下方；下方放不下则翻到上方；上下都放不下则夹到视口内。
 * 无 DOM、无副作用、幂等。
 */
export function computePanelPlacement(
	input: PanelPlacementInput,
): PanelPlacement {
	const margin = input.margin ?? MARGIN;
	const gap = input.gap ?? GAP;
	const edgeGap = input.edgeGap ?? EDGE_GAP;
	const vh = input.viewportHeight;
	const vw = input.viewportWidth;
	const h = input.panelHeight;
	const w = input.panelWidth;

	const maxTop = Math.max(margin, vh - margin - h);

	let top = input.anchorBottom + gap; // 与 ioto-settings 默认一致
	let flipped = false;
	if (top + h > vh - margin) {
		const above = input.anchorTop - gap - h;
		if (above >= margin) {
			top = above; // 下方放不下 → 翻到卡片上方
			flipped = true;
		} else {
			top = maxTop; // 上下都放不下 → 夹到视口内
		}
	}
	top = Math.max(margin, Math.min(top, maxTop)); // 统一夹取（含 h > vh 时 → margin）

	const left = Math.max(
		margin,
		Math.min(input.anchorLeft, Math.max(margin, vw - w - edgeGap)),
	);

	return { top, left, flipped };
}

interface RectLike {
	top: number;
	left: number;
	bottom: number;
	right: number;
}

/** 卡片缺失时 `getLineCoords` 返回全 0 → 判否，避免把面板定位到左上角。 */
function hasArea(rect: RectLike): boolean {
	return rect.bottom > rect.top || rect.right > rect.left;
}

/**
 * 打开后把面板夹进视口。命中并重定位返回 true；未找到面板 / 锚点无效 / 无 DOM 环境
 * 返回 false。
 *
 * 找不到面板时**保持原位置**（比乱定位安全）；只改 `top` / `left`，超高时附
 * `maxHeight` / `overflowY`，绝不触发滚动。
 *
 * `doc` / `win` 默认取全局，但**在无 DOM 的环境（`node --test`）下判否返回 false**，
 * 免得把「非浏览器」误当成「找不到面板」而抛错；两参数仍可注入，供将来 jsdom 测试。
 */
export function fitItemControlPanel(
	host: ItemControlBridgeHost,
	doc: Document | null = typeof activeDocument === 'undefined'
		? null
		: activeDocument,
	win: Window | null = typeof activeWindow === 'undefined'
		? null
		: activeWindow,
): boolean {
	if (!doc || !win) {
		return false;
	}

	const modalEl = doc.querySelector<HTMLElement>(PANEL_SELECTOR);
	if (!modalEl) {
		return false;
	}

	const anchor = host.getLineCoords(host.line);
	if (!hasArea(anchor)) {
		return false;
	}

	const { top, left } = computePanelPlacement({
		anchorTop: anchor.top,
		anchorBottom: anchor.bottom,
		anchorLeft: anchor.left,
		panelHeight: modalEl.offsetHeight,
		panelWidth: modalEl.offsetWidth,
		viewportHeight: win.innerHeight,
		viewportWidth: win.innerWidth,
		margin: MARGIN,
		gap: GAP,
		edgeGap: EDGE_GAP,
	});
	modalEl.style.top = `${top}px`;
	modalEl.style.left = `${left}px`;

	// 叠加 C（[[Research-20261003-165115]] §五）：面板比视口还高时，只夹取会漏底部
	// → 让面板内部滚动，保证底部控件可达（`max-height` 随视口变化，走行内；
	// `overflow-y` 是静态样式，按 obsidianmd 规范挂类名，见 styles.css）。
	const maxHeight = win.innerHeight - 2 * MARGIN;
	if (modalEl.offsetHeight > maxHeight) {
		modalEl.style.maxHeight = `${maxHeight}px`;
		modalEl.classList.add(SCROLL_CLASS);
	}
	return true;
}
