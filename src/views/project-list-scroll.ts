export const PROJECT_LIST_SELECTOR = '.ioto-tasks-center__project-list';

interface ScrollableElementLike {
	scrollTop: number;
}

interface QueryableContainerLike {
	querySelector?: (selector: string) => unknown;
}

export function captureProjectListScrollTop(
	container: QueryableContainerLike | null | undefined,
	fallbackScrollTop = 0,
): number {
	const listEl = getProjectListElement(container);
	return listEl ? listEl.scrollTop : fallbackScrollTop;
}

export function restoreProjectListScrollTop(
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

function getProjectListElement(
	container: QueryableContainerLike | null | undefined,
): ScrollableElementLike | null {
	if (!container?.querySelector) {
		return null;
	}

	const candidate = container.querySelector(PROJECT_LIST_SELECTOR);
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
