/**
 * IOTOTask 视图的滚动「捕获 / 恢复」护栏（[[Plan-20261003-094145]] §5.1）。
 *
 * 背景：滚动条挂在 `renderNote()` 每次都会**新建**的 `.ioto-task-view__scroll` 上，
 * 任何一次整树重建都会让 `scrollTop` 归零（[[Research-20261003-091331]] §3.1）。
 * 这里照搬 `task-list-scroll.ts` 的范式，但多加一个**卡片锚点**：仅存 `scrollTop`
 * 在「锚点上方插入/删除行」时仍会漂，锚点能一并覆盖。
 *
 * 纯逻辑核心不 import obsidian，所有触 DOM 的点都走结构化最小接口，可被 jiti 单测。
 */

export const IOTO_TASK_SCROLL_SELECTOR = '.ioto-task-view__scroll';
export const IOTO_TASK_CARD_SELECTOR = '.ioto-task-view__card';

interface ScrollableElementLike {
	scrollTop: number;
	scrollHeight?: number;
	clientHeight?: number;
}

interface RectLike {
	top: number;
	bottom: number;
}

interface CardElementLike {
	getAttribute?: (name: string) => string | null;
	getBoundingClientRect?: () => RectLike;
}

interface QueryableContainerLike {
	querySelector?: (selector: string) => unknown;
	querySelectorAll?: (
		selector: string,
	) => ArrayLike<unknown> | null | undefined;
}

export interface IotoTaskScrollSnapshot {
	/** 绝对量（兜底） */
	scrollTop: number;
	/** 视口顶部最近卡片的 `data-line`；无卡片 / 无锚点为 null */
	anchorLine: number | null;
	/** 该卡片顶边相对滚动容器视口顶边的偏移（px） */
	anchorOffset: number;
}

export interface RestoreIotoTaskScrollOptions {
	/**
	 * true：只写绝对 `scrollTop`，跳过卡片锚点纠偏。
	 * 用于「内容结构整体变化」的过滤切换（关闭 `onlyTaskBlocks` 会在锚点上方插入
	 * 整段 Section，此时锚点纠偏会把新显形内容整体顶出视口，[[Plan-20261005-092543]]）。
	 */
	skipAnchor?: boolean;
}

/** 纯函数，唯一需要单测的判断：给一组卡片顶边坐标，返回首个「底边进入视口」的索引。 */
export function pickAnchorIndex(
	cardTops: number[],
	cardBottoms: number[],
	containerTop: number,
): number | null {
	const count = Math.min(cardTops.length, cardBottoms.length);
	for (let index = 0; index < count; index += 1) {
		if ((cardBottoms[index] ?? 0) > containerTop) {
			return index;
		}
	}

	return null;
}

export function captureIotoTaskScroll(
	container: QueryableContainerLike | null | undefined,
	fallbackScrollTop = 0,
): IotoTaskScrollSnapshot {
	const scrollEl = getScrollElement(container);
	if (!scrollEl) {
		return {
			scrollTop: fallbackScrollTop,
			anchorLine: null,
			anchorOffset: 0,
		};
	}

	const cards = getCardElements(container);
	if (cards.length === 0) {
		return {
			scrollTop: fallbackScrollTop,
			anchorLine: null,
			anchorOffset: 0,
		};
	}

	const scrollTop = scrollEl.scrollTop;
	const scrollRect = getRect(scrollEl);
	const cardTops: number[] = [];
	const cardBottoms: number[] = [];
	const cardRects: RectLike[] = [];
	for (const card of cards) {
		const rect = getRect(card);
		cardTops.push(rect.top);
		cardBottoms.push(rect.bottom);
		cardRects.push(rect);
	}

	const anchorIndex = pickAnchorIndex(cardTops, cardBottoms, scrollRect.top);
	if (anchorIndex === null) {
		return { scrollTop, anchorLine: null, anchorOffset: 0 };
	}

	return {
		scrollTop,
		anchorLine: readAnchorLine(cards[anchorIndex]),
		anchorOffset: (cardRects[anchorIndex]?.top ?? 0) - scrollRect.top,
	};
}

export function restoreIotoTaskScroll(
	container: QueryableContainerLike | null | undefined,
	snapshot: IotoTaskScrollSnapshot,
	options: RestoreIotoTaskScrollOptions = {},
): void {
	const scrollEl = getScrollElement(container);
	if (!scrollEl) {
		return;
	}

	const skipAnchor = options.skipAnchor === true;
	applySnapshot(container, scrollEl, snapshot, skipAnchor);

	// 与 `restoreTaskListScrollTop` 的 rAF 口径一致（`task-list-scroll.ts:43`）：
	// 核心渲染完成后布局可能再变一次，下一帧再纠一次。
	const requestAnimationFrameFn = getRequestAnimationFrame();
	if (requestAnimationFrameFn) {
		requestAnimationFrameFn(() => {
			const nextScrollEl = getScrollElement(container);
			if (nextScrollEl) {
				applySnapshot(container, nextScrollEl, snapshot, skipAnchor);
			}
		});
	}
}

/** 先写绝对 `scrollTop`，再按锚点纠偏一次（仅当偏移 > 1px 才动，避免抖动）。 */
function applySnapshot(
	container: QueryableContainerLike | null | undefined,
	scrollEl: ScrollableElementLike,
	snapshot: IotoTaskScrollSnapshot,
	skipAnchor: boolean,
): void {
	scrollEl.scrollTop = snapshot.scrollTop;

	if (skipAnchor) {
		return;
	}

	if (snapshot.anchorLine === null || !container?.querySelector) {
		return;
	}

	const card = container.querySelector(
		`${IOTO_TASK_CARD_SELECTOR}[data-line="${snapshot.anchorLine}"]`,
	);
	if (!isCardElement(card)) {
		// 锚点卡片被折叠 / 移除：退回纯 scrollTop。
		return;
	}

	const delta =
		getRect(card).top - getRect(scrollEl).top - snapshot.anchorOffset;
	if (Math.abs(delta) > 1) {
		scrollEl.scrollTop += delta;
	}
}

function readAnchorLine(card: CardElementLike | undefined): number | null {
	const raw = card?.getAttribute?.('data-line');
	if (raw === undefined || raw === null) {
		return null;
	}

	const parsed = Number.parseInt(raw, 10);
	return Number.isNaN(parsed) ? null : parsed;
}

function getRect(element: unknown): RectLike {
	const candidate = element as {
		getBoundingClientRect?: () => RectLike;
	} | null;
	if (candidate && typeof candidate.getBoundingClientRect === 'function') {
		return candidate.getBoundingClientRect();
	}

	return { top: 0, bottom: 0 };
}

function getScrollElement(
	container: QueryableContainerLike | null | undefined,
): ScrollableElementLike | null {
	if (!container?.querySelector) {
		return null;
	}

	const candidate = container.querySelector(IOTO_TASK_SCROLL_SELECTOR);
	return isScrollableElement(candidate) ? candidate : null;
}

function getCardElements(
	container: QueryableContainerLike | null | undefined,
): CardElementLike[] {
	if (!container?.querySelectorAll) {
		return [];
	}

	const nodes = container.querySelectorAll(IOTO_TASK_CARD_SELECTOR);
	if (!nodes) {
		return [];
	}

	return Array.from(nodes).filter(isCardElement);
}

function isScrollableElement(value: unknown): value is ScrollableElementLike {
	return (
		typeof value === 'object' &&
		value !== null &&
		'scrollTop' in value &&
		typeof value.scrollTop === 'number'
	);
}

function isCardElement(value: unknown): value is CardElementLike {
	return typeof value === 'object' && value !== null;
}

function getRequestAnimationFrame(): ((callback: () => void) => number) | null {
	// 用 `window` 而非 `globalThis`：Obsidian 的 popout 窗口下 `globalThis` 指向错窗口
	// （obsidianmd/no-global-this）。真实环境里 window 即渲染进程全局。
	if (typeof window !== 'undefined' && window.requestAnimationFrame) {
		return window.requestAnimationFrame.bind(window);
	}

	return null;
}
