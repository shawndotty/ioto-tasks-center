/**
 * Task View 空白框选（[[Plan-20261101-054951]] §四.步骤 5）。
 *
 * 手势口径（与调研略有不同，见 §三 口径修正 5 / 6）：
 * - `pointerdown` **不** `preventDefault`、**不** `setPointerCapture`：否则事件全部改投到
 *   `scrollEl`，`section-body` 的 `dblclick`（进节编辑）被彻底打断；
 * - 位移过阈值才真正进入框选，此后才捕获指针；
 * - 手势期间只用**本地状态 + 直接刷类**，`pointerup` 才落一次真源
 *   （`view.setMultiSelection`）——`pointermove` 里改 `selectedLine` 会触发
 *   删除按钮刷新与焦点抖动，几百张卡时可感知；
 * - 卡片矩形在手势开始时**快照成内容坐标**：之后每帧纯数学求交，不在
 *   `pointermove` 里反复强制布局（自动滚动只改 `scrollTop`，卡片矩形不重算）。
 *
 * 命中语义：**相交**即选中（不做「完全包含」）；命中集按 DOM 顺序，第一张成为锚点
 * （与 Finder 一致）；命中为空 → 保持手势开始前的选择（不清空，避免「划一下没了」）。
 */

import type { TaskViewHost } from './task-view-host';
import { canMultiSelect } from './task-view-multi-selection';

/** 卡片矩形（**内容坐标**：相对滚动容器内容原点）。 */
export interface MarqueeRect {
	line: number;
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/** 框选矩形（内容坐标）。 */
export interface MarqueeBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

const CARD_SELECTOR = '.ioto-task-view__card';
/** 起点落在这些元素上 = 有主交互，直接放行（不进入框选）。 */
const OWNED_TARGET_SELECTOR = [
	'.ioto-task-view__card',
	'.ioto-task-view__section-header',
	'.ioto-task-view__delete-confirm',
	'button',
	'a',
	'input',
	'textarea',
	'select',
	'[contenteditable]',
].join(', ');

/** 进入框选的位移阈值（px）。 */
const DRAG_THRESHOLD = 4;
/** 自动滚动触发带 / 每帧步长（px）。 */
const AUTO_SCROLL_EDGE = 24;
const AUTO_SCROLL_STEP = 14;

/**
 * 命中判据：**相交**即选中（只碰边不算），零面积卡不入表。
 * 返回按入参顺序（= DOM 顺序），不含重复行号。
 */
export function marqueeHits(
	rects: readonly MarqueeRect[],
	box: MarqueeBox,
): number[] {
	const left = Math.min(box.left, box.right);
	const right = Math.max(box.left, box.right);
	const top = Math.min(box.top, box.bottom);
	const bottom = Math.max(box.top, box.bottom);
	if (right <= left || bottom <= top) {
		return [];
	}

	const hits: number[] = [];
	const seen = new Set<number>();
	for (const rect of rects) {
		// 零面积卡（隐藏 / 未布局）不参与
		if (rect.right <= rect.left || rect.bottom <= rect.top) {
			continue;
		}
		const intersect =
			rect.right > left &&
			rect.left < right &&
			rect.bottom > top &&
			rect.top < bottom;
		if (!intersect || seen.has(rect.line)) {
			continue;
		}
		seen.add(rect.line);
		hits.push(rect.line);
	}
	return hits;
}

/** 手势期状态（本地；`pointerup` 前绝不写视图状态）。 */
interface MarqueeGesture {
	pointerId: number;
	/** 起点（内容坐标快照；自动滚动时框的原点跟着内容走）。 */
	startX: number;
	startY: number;
	/** 起点（视口坐标；只用于算位移阈值）。 */
	startClientX: number;
	startClientY: number;
	clientX: number;
	clientY: number;
	started: boolean;
	box: MarqueeBox | null;
	/** 手势开始时的可见卡内容坐标矩形。 */
	snapshot: MarqueeRect[];
	/** 手势开始前的选中集（取消 / 空命中时还原）。 */
	initialSelected: number[];
	overlay: HTMLElement | null;
	frame: number | null;
	abort: AbortController | null;
}

/**
 * 挂到新建的 `scrollEl` 上：旧监听随 DOM 一起丢弃，不做显式解绑
 * （与卡片 / Section 拖拽同口径）。
 *
 * 移动端**不调用**（Q4：触摸拖动已是滚动语义，且没有修饰键）——门禁在挂载点
 * （`task-view-render.ts`），本模块保持零 `obsidian` 值依赖以便 jiti 单测。
 */
export function attachMarqueeSelection(
	scrollEl: HTMLElement,
	view: TaskViewHost,
): void {
	let gesture: MarqueeGesture | null = null;
	/** 尾随 `click` 抑制器：`pointerdown` 时无条件换新（旧的一次性监听随之作废）。 */
	let clickGuard: AbortController | null = null;

	const selectedCards = (): HTMLElement[] =>
		Array.from(
			scrollEl.querySelectorAll<HTMLElement>(
				`${CARD_SELECTOR}.is-selected`,
			),
		);

	const readCardLine = (card: HTMLElement): number | null => {
		const raw = card.getAttribute('data-line');
		if (raw === null) {
			return null;
		}
		const parsed = Number.parseInt(raw, 10);
		return Number.isNaN(parsed) ? null : parsed;
	};

	/** 手势开始前的选中集（DOM 顺序，供取消 / 空命中还原）。 */
	const captureInitialSelected = (): number[] =>
		selectedCards()
			.map(readCardLine)
			.filter((line): line is number => line !== null);

	/** 直接刷类（不碰视图状态）：命中集 ∪ 手势前选中集。 */
	const paint = (hits: readonly number[], initial: readonly number[]): void => {
		const hitSet = new Set(hits);
		const keep = new Set(initial);
		for (const card of Array.from(
			scrollEl.querySelectorAll<HTMLElement>(CARD_SELECTOR),
		)) {
			const line = readCardLine(card);
			if (line === null) {
				continue;
			}
			card.toggleClass('is-selected', hitSet.has(line) || keep.has(line));
		}
	};

	/** 可见卡的内容坐标矩形快照（`getClientRects` 为空 = 隐藏，跳过）。 */
	const snapshotCards = (): MarqueeRect[] => {
		const rect = scrollEl.getBoundingClientRect();
		const origin: MarqueeRect[] = [];
		for (const card of Array.from(
			scrollEl.querySelectorAll<HTMLElement>(CARD_SELECTOR),
		)) {
			if (card.getClientRects().length === 0) {
				continue;
			}
			const line = readCardLine(card);
			if (line === null) {
				continue;
			}
			const box = card.getBoundingClientRect();
			origin.push({
				line,
				left: box.left - rect.left + scrollEl.scrollLeft,
				top: box.top - rect.top + scrollEl.scrollTop,
				right: box.right - rect.left + scrollEl.scrollLeft,
				bottom: box.bottom - rect.top + scrollEl.scrollTop,
			});
		}
		return origin;
	};

	const contentPoint = (clientX: number, clientY: number): MarqueeBox => {
		const rect = scrollEl.getBoundingClientRect();
		const x = clientX - rect.left + scrollEl.scrollLeft;
		const y = clientY - rect.top + scrollEl.scrollTop;
		return { left: x, top: y, right: x, bottom: y };
	};

	const renderBox = (current: MarqueeGesture): void => {
		if (!current.overlay || !current.box) {
			return;
		}
		const left = Math.min(current.box.left, current.box.right);
		const top = Math.min(current.box.top, current.box.bottom);
		current.overlay.style.left = `${left}px`;
		current.overlay.style.top = `${top}px`;
		current.overlay.style.width = `${Math.abs(current.box.right - current.box.left)}px`;
		current.overlay.style.height = `${Math.abs(current.box.bottom - current.box.top)}px`;
	};

	const step = (current: MarqueeGesture): void => {
		current.frame = null;
		if (!current.started) {
			return;
		}
		// ① 自动滚动：指针进入上下边缘带时按帧推进 scrollTop
		let needNext = false;
		const rect = scrollEl.getBoundingClientRect();
		if (current.clientY < rect.top + AUTO_SCROLL_EDGE) {
			const before = scrollEl.scrollTop;
			scrollEl.scrollTop = Math.max(0, before - AUTO_SCROLL_STEP);
			needNext = scrollEl.scrollTop !== before;
		} else if (current.clientY > rect.bottom - AUTO_SCROLL_EDGE) {
			const before = scrollEl.scrollTop;
			scrollEl.scrollTop = Math.min(
				scrollEl.scrollHeight - scrollEl.clientHeight,
				before + AUTO_SCROLL_STEP,
			);
			needNext = scrollEl.scrollTop !== before;
		}

		// ② 框（内容坐标）→ 求交 → 直接刷类（每帧一次纯数学，不读布局）
		const end = contentPoint(current.clientX, current.clientY);
		current.box = {
			left: current.startX,
			top: current.startY,
			right: end.right,
			bottom: end.bottom,
		};
		// `startX` / `startY` 存的是内容坐标快照，随 scrollTop 变化需保持原点
		renderBox(current);
		const hits = marqueeHits(current.snapshot, current.box);
		paint(hits, current.initialSelected);

		if (needNext) {
			current.frame = window.requestAnimationFrame(() => step(current));
		}
	};

	const cleanup = (
		current: MarqueeGesture,
		mode: 'commit' | 'cancel',
	): void => {
		if (current.frame !== null) {
			window.cancelAnimationFrame(current.frame);
			current.frame = null;
		}
		current.overlay?.remove();
		current.overlay = null;
		scrollEl.removeClass('is-marquee');
		current.abort?.abort();
		current.abort = null;
		try {
			if (scrollEl.hasPointerCapture(current.pointerId)) {
				scrollEl.releasePointerCapture(current.pointerId);
			}
		} catch {
			// 捕获早已随 DOM 失效：忽略
		}

		const hits = current.box
			? marqueeHits(current.snapshot, current.box)
			: [];
		if (mode === 'cancel' || hits.length === 0) {
			// 取消 / 空命中：还原成手势开始前的选中集（不清空，避免「划一下没了」）
			paint([], current.initialSelected);
			return;
		}
		const [anchor, ...members] = hits;
		if (anchor === undefined) {
			return;
		}
		// 命中集第一张 = 锚点，其余进集合（与 Finder 一致）
		view.setMultiSelection(anchor, members);
	};

	const endGesture = (mode: 'commit' | 'cancel'): void => {
		const current = gesture;
		if (!current) {
			return;
		}
		gesture = null;
		if (!current.started) {
			current.abort?.abort();
			return; // 未过阈值 = 普通点击，什么都不做
		}
		cleanup(current, mode);
	};

	const beginGesture = (current: MarqueeGesture): void => {
		current.started = true;
		scrollEl.addClass('is-marquee');
		activeWindow.getSelection()?.removeAllRanges();
		current.snapshot = snapshotCards();
		current.initialSelected = captureInitialSelected();
		current.overlay = scrollEl.createDiv({
			cls: 'ioto-task-view__marquee',
		});
		// T4：多选与待删除遮罩不并存
		view.cancelPendingDelete(false);
		try {
			scrollEl.setPointerCapture(current.pointerId);
		} catch {
			// 合成事件 / 已释放：无捕获也能靠 scrollEl 上的监听收尾
		}

		// 尾随 `click` 必须吞（否则松手会进编辑态）；下一次 `pointerdown` 无条件换新。
		clickGuard?.abort();
		clickGuard = new AbortController();
		scrollEl.addEventListener(
			'click',
			(event) => {
				event.preventDefault();
				event.stopPropagation();
			},
			{ capture: true, once: true, signal: clickGuard.signal },
		);

		// `Esc` 取消（还原成手势前的选中集）
		activeWindow.addEventListener(
			'keydown',
			(event: KeyboardEvent) => {
				if (event.key !== 'Escape') {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				endGesture('cancel');
			},
			{ capture: true, signal: current.abort?.signal },
		);
	};

	scrollEl.addEventListener('pointerdown', (event: PointerEvent) => {
		// 新的一次按下：上一次的尾随 click 抑制器作废
		clickGuard?.abort();
		clickGuard = null;
		if (gesture) {
			return;
		}
		if (event.button !== 0 || event.isPrimary === false) {
			return;
		}
		const target = event.target;
		if (!(target instanceof HTMLElement)) {
			return;
		}
		// 起点必须是空白：命中卡片 / 节标题 / 按钮 / 链接 / 输入 / 编辑器 → 放行原主
		if (target.closest(OWNED_TARGET_SELECTOR)) {
			return;
		}
		// 放大 / 任一编辑器 / 只读态：不进入框选
		if (!canMultiSelect(view)) {
			return;
		}
		const origin = contentPoint(event.clientX, event.clientY);
		gesture = {
			pointerId: event.pointerId,
			startX: origin.left,
			startY: origin.top,
			startClientX: event.clientX,
			startClientY: event.clientY,
			clientX: event.clientX,
			clientY: event.clientY,
			started: false,
			box: null,
			snapshot: [],
			initialSelected: [],
			overlay: null,
			frame: null,
			abort: new AbortController(),
		};
		// 🔴 不 preventDefault、不 setPointerCapture（保住 `dblclick`）
	});

	scrollEl.addEventListener('pointermove', (event: PointerEvent) => {
		const current = gesture;
		if (!current || event.pointerId !== current.pointerId) {
			return;
		}
		current.clientX = event.clientX;
		current.clientY = event.clientY;
		if (!current.started) {
			const dx = event.clientX - current.startClientX;
			const dy = event.clientY - current.startClientY;
			if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
				return;
			}
			beginGesture(current);
		}
		if (current.frame === null) {
			current.frame = window.requestAnimationFrame(() => step(current));
		}
	});

	scrollEl.addEventListener('pointerup', (event: PointerEvent) => {
		if (gesture && event.pointerId === gesture.pointerId) {
			endGesture('commit');
		}
	});
	scrollEl.addEventListener('pointercancel', () => endGesture('cancel'));
	// 捕获被动丢失（滚动容器被整树重建摘掉等）：宁可还原也不按旧快照落选
	// ——「宁可少选不可错选」（[[Plan-20261101-054951]] §六.T14）。
	// 正常 `pointerup` 会先走到上面的 commit 分支，此处随即因 `gesture === null` 空转。
	scrollEl.addEventListener('lostpointercapture', () => {
		if (gesture) {
			endGesture('cancel');
		}
	});
}
