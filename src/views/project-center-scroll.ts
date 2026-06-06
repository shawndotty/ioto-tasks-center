export const PROJECT_CENTER_CONTENT_SELECTOR = '.ioto-project-center__content';

export interface ScrollPosition {
	scrollTop: number;
	scrollLeft: number;
}

interface ScrollableElementLike {
	scrollTop: number;
	scrollLeft: number;
	scrollHeight?: number;
	clientHeight?: number;
}

interface QueryableContainerLike {
	querySelector?: (selector: string) => unknown;
}

export function captureProjectCenterScrollPosition(
	container: QueryableContainerLike | null | undefined,
	fallback: ScrollPosition = { scrollTop: 0, scrollLeft: 0 },
): ScrollPosition {
	const contentEl = getContentElement(container);
	if (!contentEl) {
		return fallback;
	}

	if (
		typeof contentEl.scrollHeight === 'number' &&
		typeof contentEl.clientHeight === 'number' &&
		contentEl.scrollHeight <= contentEl.clientHeight + 1 &&
		contentEl.scrollTop === 0 &&
		contentEl.scrollLeft === 0
	) {
		return fallback;
	}

	return { scrollTop: contentEl.scrollTop, scrollLeft: contentEl.scrollLeft };
}

export function restoreProjectCenterScrollPosition(
	contentEl: ScrollableElementLike | null | undefined,
	position: ScrollPosition,
): void {
	if (!contentEl) {
		return;
	}

	contentEl.scrollTop = position.scrollTop;
	contentEl.scrollLeft = position.scrollLeft;
	const requestAnimationFrameFn = getRequestAnimationFrame();
	if (requestAnimationFrameFn) {
		requestAnimationFrameFn(() => {
			contentEl.scrollTop = position.scrollTop;
			contentEl.scrollLeft = position.scrollLeft;
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

function getContentElement(
	container: QueryableContainerLike | null | undefined,
): ScrollableElementLike | null {
	if (!container?.querySelector) {
		return null;
	}

	const candidate = container.querySelector(PROJECT_CENTER_CONTENT_SELECTOR);
	return isScrollableElement(candidate) ? candidate : null;
}

function isScrollableElement(value: unknown): value is ScrollableElementLike {
	return (
		typeof value === 'object' &&
		value !== null &&
		'scrollTop' in value &&
		typeof value.scrollTop === 'number' &&
		'scrollLeft' in value &&
		typeof value.scrollLeft === 'number'
	);
}
