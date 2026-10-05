/**
 * 「卡片动作区」锚定弹窗的视口避让（[[Plan-20261005-233822]]，承 [[Plan-20261003-165927]]）。
 *
 * 卡片动作区派发的两个弹窗共用同一套「锚定 = 同源几何」逻辑：
 *   - 「条目控制」面板：`ioto-settings` 的 `positionPanel()` 无条件放在锚点下方
 *     （`top = anchor.bottom + 8`），垂直方向零视口判断 → 卡片贴近视口底部时面板
 *     溢出屏幕；且面板打开后立即 `registerCloseOnLeave()`，任何「目标不在面板内」的
 *     滚动都会关闭它 → 被裁掉的部分滚不到也点不到。
 *   - 「插入出链」建议器：核心 `.prompt { position:absolute; top:80px }` + 水平居中
 *     → 停在屏幕顶部中央，与卡片脱节。
 *
 * 修法（不改 `ioto-settings`，只在桥接层补一拍定位）：弹窗在文档中之后，按真实
 * 高度做「先试下方 → 放不下翻上方 → 都放不下夹到视口内」的经典翻转逻辑，只写
 * `style.top` / `style.left`（条目控制超高时附 `maxHeight` / `overflowY`），
 * **不调用任何 scroll API**，因此不会踩到 `registerCloseOnLeave`。
 *
 * 本文件不 import 运行期的 `obsidian`（宿主类型走 type-only），纯函数可被 jiti 单测。
 */

import type { ItemControlBridgeHost } from '../iotoTaskView';

/** 「条目控制」面板根节点：`ioto-settings` 的 Modal 容器带 `ioto-item-control-modal`，被定位的是其子 `.modal`。 */
export const ITEM_CONTROL_PANEL_SELECTOR = '.ioto-item-control-modal .modal';

/**
 * 「插入出链」建议器根节点：`FuzzySuggestModal.onOpen` 会把 `modal` 类改名为
 * `prompt`，ioto-settings 在其上显式加 `ioto-outgoing-link-modal`
 * （`outgoing-link-suggest-modal.ts:155`）→ 该选择器即弹窗本体。
 */
export const TASK_OUTLINK_POPOVER_SELECTOR = '.ioto-outgoing-link-modal';

/** 条目控制面板比视口还高时挂上的内部滚动类（规则见 styles.css）。 */
const ITEM_CONTROL_SCROLL_CLASS = 'ioto-item-control-modal--fit-scroll';

/** 视口四周留白。 */
const MARGIN = 8;
/** 卡片与弹窗间距（与 ioto-settings 一致）。 */
const GAP = 8;
/** 水平夹取右留白（与 ioto-settings 一致）。 */
const EDGE_GAP = 16;

export interface PopupPlacementInput {
	/** 卡片 top（window 坐标） */
	anchorTop: number;
	/** 卡片 bottom（window 坐标） */
	anchorBottom: number;
	/** 卡片 left（window 坐标） */
	anchorLeft: number;
	/** 弹窗 offsetHeight */
	popupHeight: number;
	/** 弹窗 offsetWidth */
	popupWidth: number;
	/** window.innerHeight */
	viewportHeight: number;
	/** window.innerWidth */
	viewportWidth: number;
	/** 视口四周留白，默认 8 */
	margin?: number;
	/** 卡片与弹窗间距，默认 8 */
	gap?: number;
	/** 水平夹取右留白，默认 16 */
	edgeGap?: number;
}

export interface PopupPlacement {
	top: number;
	left: number;
	/** 是否翻转到卡片上方（供真机/调试断言） */
	flipped: boolean;
}

/**
 * 纯几何：默认仍在卡片下方；下方放不下则翻到上方；上下都放不下则夹到视口内。
 * 无 DOM、无副作用、幂等。
 */
export function computePopupPlacement(
	input: PopupPlacementInput,
): PopupPlacement {
	const margin = input.margin ?? MARGIN;
	const gap = input.gap ?? GAP;
	const edgeGap = input.edgeGap ?? EDGE_GAP;
	const vh = input.viewportHeight;
	const vw = input.viewportWidth;
	const h = input.popupHeight;
	const w = input.popupWidth;

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

/** 卡片缺失时 `getLineCoords` 返回全 0 → 判否，避免把弹窗定位到左上角。 */
function hasArea(rect: RectLike): boolean {
	return rect.bottom > rect.top || rect.right > rect.left;
}

interface AnchoredPopupOptions {
	doc: Document;
	win: Window;
	/** 弹窗本体选择器（不同弹窗不同）。 */
	selector: string;
	/** 当前卡片视口坐标（弹窗要锚到它上/下方）。 */
	getAnchor: () => RectLike;
	/** 弹窗比视口还高时挂上的滚动类；出链不需要（核心 `.prompt-results` 已可滚）。 */
	scrollClass?: string;
}

/**
 * 打开后把弹窗夹进视口。命中并重定位返回 true；未找到弹窗 / 锚点无效返回 false。
 *
 * 找不到弹窗时**保持原位置**（比乱定位安全）；只改 `top` / `left`，超高时附
 * `maxHeight` / `overflowY`，绝不触发滚动。
 */
export function fitAnchoredPopup(o: AnchoredPopupOptions): boolean {
	const el = o.doc.querySelector<HTMLElement>(o.selector);
	if (!el) {
		return false;
	}

	const anchor = o.getAnchor();
	if (!hasArea(anchor)) {
		return false;
	}

	const { top, left } = computePopupPlacement({
		anchorTop: anchor.top,
		anchorBottom: anchor.bottom,
		anchorLeft: anchor.left,
		popupHeight: el.offsetHeight,
		popupWidth: el.offsetWidth,
		viewportHeight: o.win.innerHeight,
		viewportWidth: o.win.innerWidth,
		margin: MARGIN,
		gap: GAP,
		edgeGap: EDGE_GAP,
	});
	el.style.top = `${top}px`;
	el.style.left = `${left}px`;

	// 叠加 C（[[Research-20261003-165115]] §五）：弹窗比视口还高时，只夹取会漏底部
	// → 让它内部滚动，保证底部控件可达（`max-height` 随视口变化，走行内；
	// `overflow-y` 是静态样式，按 obsidianmd 规范挂类名，见 styles.css）。
	const maxHeight = o.win.innerHeight - 2 * MARGIN;
	if (el.offsetHeight > maxHeight) {
		el.style.maxHeight = `${maxHeight}px`;
		if (o.scrollClass) {
			el.classList.add(o.scrollClass);
		}
	}
	return true;
}

/** 等弹窗挂载的上限；超时即断开观察者（应对命令被判否 / 无活动文件等「弹窗永不出现」）。 */
const MOUNT_WAIT_LIMIT_MS = 3000;

/**
 * 弹窗不一定在命令同步段内创建：条目控制 `openForActiveLine()` 会先 `await buildContext()`
 * （内部 `await vault.read` + 解析），之后才 `new Modal(...).open()`。
 * 因此 `setTimeout(0)` / 单次 rAF 都会早于弹窗建 DOM（[[Research-20261003-171720]] §二）。
 * 这里用 `MutationObserver` 等选择器真正命中后再量高重定位一次，并设上限兜底
 * （[[Plan-20261003-172455]] §三）。
 *
 * 快路径先量一次，兼容「弹窗已在（或对端未来改回同步）」的情形；命中即返回 true。
 */
export function fitAnchoredPopupWhenMounted(o: AnchoredPopupOptions): boolean {
	if (fitAnchoredPopup(o)) {
		return true; // 快路径：弹窗已挂载，已定位
	}

	let timer: number | null = null;
	const observer = new MutationObserver(() => {
		if (fitAnchoredPopup(o)) {
			observer.disconnect();
			if (timer !== null) {
				o.win.clearTimeout(timer);
			}
		}
	});
	observer.observe(o.doc.body, { childList: true, subtree: true });
	timer = o.win.setTimeout(() => observer.disconnect(), MOUNT_WAIT_LIMIT_MS);
	return true; // 已安排「挂载后定位」
}

/**
 * 取默认文档 / 窗口：弹窗环境用 `activeDocument` / `activeWindow`；
 * **无 DOM 环境（`node --test`）下取 null**，两参数仍可注入，供将来 jsdom 测试。
 */
function resolveDocWin(
	doc: Document | null,
	win: Window | null,
): { doc: Document; win: Window } | null {
	const d =
		doc ?? (typeof activeDocument === 'undefined' ? null : activeDocument);
	const w =
		win ?? (typeof activeWindow === 'undefined' ? null : activeWindow);
	if (!d || !w) {
		return null;
	}
	return { doc: d, win: w };
}

/** 条目控制面板：锚点 = 卡片，超高挂内部滚动类。 */
export function fitItemControlPanel(
	host: ItemControlBridgeHost,
	doc: Document | null = null,
	win: Window | null = null,
): boolean {
	const env = resolveDocWin(doc, win);
	if (!env) {
		return false; // node --test 无 DOM 环境
	}
	return fitAnchoredPopup({
		doc: env.doc,
		win: env.win,
		selector: ITEM_CONTROL_PANEL_SELECTOR,
		getAnchor: () => host.getLineCoords(host.line),
		scrollClass: ITEM_CONTROL_SCROLL_CLASS,
	});
}

/** 条目控制面板：等挂载后再定位（见 `fitAnchoredPopupWhenMounted`）。 */
export function fitItemControlPanelWhenMounted(
	host: ItemControlBridgeHost,
	doc: Document | null = null,
	win: Window | null = null,
): boolean {
	const env = resolveDocWin(doc, win);
	if (!env) {
		return false; // node --test 无 DOM 环境
	}
	return fitAnchoredPopupWhenMounted({
		doc: env.doc,
		win: env.win,
		selector: ITEM_CONTROL_PANEL_SELECTOR,
		getAnchor: () => host.getLineCoords(host.line),
		scrollClass: ITEM_CONTROL_SCROLL_CLASS,
	});
}

/**
 * 「插入出链」建议器：与条目控制**同源几何**（下方优先 / 翻上方 / 夹取）。
 *
 * 出链命令 callback 体内无 `await`，`new OutgoingLinkSuggestModal(...).open()` 在
 * `executeCommand` 的同步段完成建 DOM ⇒ 快路径即可同步测量定位，先于浏览器绘制、无跳动。
 *
 * 手机端不锚定（[[Plan-20261005-233822]] S4）：`.is-phone .prompt` 是核心有意为之的
 * 全宽顶栏，锚定会破坏该布局 → 在 JS 层直接跳过（CSS 侧另有 `:not(.is-phone)` 门控）。
 * 出链弹窗不需要滚动类：核心 `.prompt-results { overflow-y:auto }` + ioto-settings 的
 * `flex:1 1 auto; min-height:0` 已保证结果区可滚。
 */
export function fitTaskOutlinkPopoverWhenMounted(
	host: ItemControlBridgeHost,
	doc: Document | null = null,
	win: Window | null = null,
): boolean {
	const env = resolveDocWin(doc, win);
	if (!env) {
		return false; // node --test 无 DOM 环境
	}
	if (env.doc.body?.classList.contains('is-phone')) {
		return false; // S4：手机端保留核心顶栏
	}
	return fitAnchoredPopupWhenMounted({
		doc: env.doc,
		win: env.win,
		selector: TASK_OUTLINK_POPOVER_SELECTOR,
		getAnchor: () => host.getLineCoords(host.line),
	});
}
