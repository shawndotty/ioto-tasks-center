export const TASK_LIST_SELECTOR = '.ioto-tasks-center__task-list';

interface ScrollableElementLike {
	scrollTop: number;
	scrollHeight?: number;
	clientHeight?: number;
}

interface QueryableContainerLike {
	querySelector?: (selector: string) => unknown;
}

export function captureTaskListScrollTop(
	container: QueryableContainerLike | null | undefined,
	fallbackScrollTop = 0,
): number {
	const listEl = getTaskListElement(container);
	if (!listEl) {
		return fallbackScrollTop;
	}

	if (
		typeof listEl.scrollHeight === 'number' &&
		typeof listEl.clientHeight === 'number' &&
		listEl.scrollHeight <= listEl.clientHeight + 1 &&
		listEl.scrollTop === 0
	) {
		return fallbackScrollTop;
	}

	return listEl.scrollTop;
}

export function restoreTaskListScrollTop(
	listEl: ScrollableElementLike | null | undefined,
	scrollTop: number,
): void {
	if (!listEl) {
		return;
	}

	listEl.scrollTop = scrollTop;
	const requestAnimationFrameFn = getRequestAnimationFrame();
	if (requestAnimationFrameFn) {
		requestAnimationFrameFn(() => {
			listEl.scrollTop = scrollTop;
		});
	}
}

function getRequestAnimationFrame():
	| ((callback: FrameRequestCallback) => number)
	| null {
	if (typeof window !== 'undefined' && window.requestAnimationFrame) {
		return window.requestAnimationFrame.bind(window);
	}

	return null;
}

function getTaskListElement(
	container: QueryableContainerLike | null | undefined,
): ScrollableElementLike | null {
	if (!container?.querySelector) {
		return null;
	}

	const candidate = container.querySelector(TASK_LIST_SELECTOR);
	return isScrollableElement(candidate) ? candidate : null;
}

function isScrollableElement(value: unknown): value is ScrollableElementLike {
	return (
		typeof value === 'object' &&
		value !== null &&
		'scrollTop' in value &&
		typeof value.scrollTop === 'number'
	);
}
