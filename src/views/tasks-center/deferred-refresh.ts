import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type { TaskFileEntry } from '../../tasks-center/types';
import {
	buildTaskHoverPreviewPayload,
	hasActiveTaskHoverPopover,
	shouldTriggerTaskHoverPreview,
} from '../task-hover-preview';
import { HOVER_PREVIEW_REFRESH_RETRY_MS } from './constants';

export function triggerTaskHoverPreview(
	view: IOTOTasksCenterView,
	event: MouseEvent,
	task: TaskFileEntry,
	rowEl: HTMLButtonElement,
): void {
	if (!shouldTriggerTaskHoverPreview(event, rowEl)) {
		return;
	}

	view.app.workspace.trigger(
		'hover-link',
		buildTaskHoverPreviewPayload({
			event,
			rowEl,
			taskPath: task.path,
			hoverParent: view.hoverPreviewParent,
		}),
	);
}

export function shouldDeferVaultRefresh(view: IOTOTasksCenterView): boolean {
	return (
		hasActiveTaskHoverPopover(view.hoverPreviewParent) ||
		view.deferVaultRefreshForSubtaskCreation
	);
}

export function scheduleDeferredVaultRefresh(view: IOTOTasksCenterView): void {
	if (view.deferredVaultRefreshTimer !== null) {
		return;
	}

	view.deferredVaultRefreshTimer = window.setTimeout(() => {
		view.deferredVaultRefreshTimer = null;
		if (!view.pendingVaultRefresh) {
			return;
		}

		if (view.shouldDeferVaultRefresh()) {
			view.scheduleDeferredVaultRefresh();
			return;
		}

		void refreshAfterDeferredHoverPreview(view);
	}, HOVER_PREVIEW_REFRESH_RETRY_MS);
}

export function clearDeferredVaultRefreshState(view: IOTOTasksCenterView): void {
	view.pendingVaultRefresh = false;
	if (view.deferredVaultRefreshTimer !== null) {
		window.clearTimeout(view.deferredVaultRefreshTimer);
		view.deferredVaultRefreshTimer = null;
	}
}

async function refreshAfterDeferredHoverPreview(
	view: IOTOTasksCenterView,
): Promise<void> {
	view.pendingVaultRefresh = false;
	if (view.selectedProject) {
		await refreshCurrentProjectTasks(view);
		return;
	}

	await view.refreshFromVaultChange();
}

async function refreshCurrentProjectTasks(
	view: IOTOTasksCenterView,
): Promise<void> {
	if (!view.selectedProject) {
		return;
	}

	view.isTasksLoading = true;
	view.render();
	await view.loadTasks(view.selectedProject);
}
