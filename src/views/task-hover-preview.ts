import type { HoverPopover } from 'obsidian';

export const IOTO_TASKS_CENTER_TASK_HOVER_SOURCE_ID =
	'ioto-tasks-center-task-list';

/** `IOTOTask` 视图（任务笔记视图）自己的 hover 源，与任务中心列表互不干扰。 */
export const IOTO_TASK_VIEW_HOVER_SOURCE_ID = 'ioto-task-view';

export interface TaskHoverPreviewPayload {
	event: MouseEvent;
	source: string;
	hoverParent: { hoverPopover: HoverPopover | null };
	targetEl: HTMLElement;
	linktext: string;
	sourcePath: string;
	state?: unknown;
}

export function shouldTriggerTaskHoverPreview(
	event: MouseEvent,
	rowEl: HTMLElement,
): boolean {
	const relatedTarget = event.relatedTarget;
	return !(
		relatedTarget &&
		typeof rowEl.contains === 'function' &&
		rowEl.contains(relatedTarget as Node)
	);
}

export function buildTaskHoverPreviewPayload(options: {
	event: MouseEvent;
	rowEl: HTMLElement;
	taskPath: string;
	hoverParent: { hoverPopover: HoverPopover | null };
}): TaskHoverPreviewPayload {
	return {
		event: options.event,
		source: IOTO_TASKS_CENTER_TASK_HOVER_SOURCE_ID,
		hoverParent: options.hoverParent,
		targetEl: options.rowEl,
		linktext: options.taskPath,
		sourcePath: options.taskPath,
	};
}

export function hasActiveTaskHoverPopover(hoverParent: {
	hoverPopover: HoverPopover | null;
}): boolean {
	return Boolean(hoverParent.hoverPopover?.hoverEl.isConnected);
}
