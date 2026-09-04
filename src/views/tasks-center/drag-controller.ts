import { Notice, TFile } from 'obsidian';
import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import {
	validateTaskParentDrop,
	type TaskDropValidationResult,
} from '../task-drag';
import { assignUpTaskToFile, removeUpTaskFromFile } from '../../tasks-center/up-task-assignment';
import { t } from '../../lang/helpter';
import type { TaskFileEntry } from '../../tasks-center/types';
import { getTaskDropValidationMessage } from './constants';
import { TASK_LIST_SELECTOR } from '../task-list-scroll';

/**
 * 进入"重设父任务"流程的共享入口，与事件类型无关。
 * 桌面原生拖拽与移动端 Pointer 拖拽都通过它来初始化拖拽状态。
 * 返回 false 表示当前不处于可拖拽状态（如正在更新 UpTask）。
 */
export function beginTaskDragState(
	view: IOTOTasksCenterView,
	task: TaskFileEntry,
	rowEl: HTMLButtonElement,
	options?: { showRemoveDropZone?: boolean },
): boolean {
	if (view.isUpdatingUpTask) {
		return false;
	}

	view.draggingTaskPath = task.path;
	view.dropTargetTaskPath = null;
	view.invalidDropTargetTaskPath = null;
	view.isRemoveUpTaskDropTarget = false;
	if (options?.showRemoveDropZone !== false) {
		view.contentEl
			.querySelector(TASK_LIST_SELECTOR)
			?.addClass('has-remove-up-task-drop-zone');
	}
	rowEl.addClass('is-dragging');
	return true;
}

/**
 * 在指针/拖拽移动到某个目标行时，验证并把该行标记为合法或非法放置目标。
 * 与事件类型无关，供桌面 `dragover` 与移动端 Pointer 手势复用。
 * 返回 null 表示尚未进入拖拽；否则返回校验结果（已同步高亮状态）。
 */
export function updateTaskDropTarget(
	view: IOTOTasksCenterView,
	task: TaskFileEntry,
	rowEl: HTMLButtonElement,
): TaskDropValidationResult | null {
	if (!view.draggingTaskPath || view.isUpdatingUpTask) {
		return null;
	}

	const validation = validateTaskParentDrop(
		view.tasks,
		view.draggingTaskPath,
		task.path,
	);
	if (!validation.valid) {
		setCurrentDropTarget(view, task.path, true, rowEl);
		return validation;
	}

	setCurrentDropTarget(view, task.path, false, rowEl);
	return validation;
}

export function handleTaskDragStart(
	view: IOTOTasksCenterView,
	event: DragEvent,
	task: TaskFileEntry,
	rowEl: HTMLButtonElement,
): void {
	if (view.isUpdatingUpTask) {
		event.preventDefault();
		return;
	}

	const started = beginTaskDragState(view, task, rowEl);
	if (!started) {
		event.preventDefault();
		return;
	}

	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = 'move';
		event.dataTransfer.setData('text/plain', task.path);
	}
}

export function handleTaskDragOver(
	view: IOTOTasksCenterView,
	event: DragEvent,
	task: TaskFileEntry,
	rowEl: HTMLButtonElement,
): void {
	const validation = updateTaskDropTarget(view, task, rowEl);
	if (!validation || !validation.valid) {
		return;
	}

	event.preventDefault();
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = 'move';
	}
}

export function handleTaskDragLeave(
	view: IOTOTasksCenterView,
	event: DragEvent,
	task: TaskFileEntry,
	rowEl: HTMLButtonElement,
): void {
	const nextTarget = event.relatedTarget;
	if (nextTarget instanceof Node && rowEl.contains(nextTarget)) {
		return;
	}

	if (
		view.dropTargetTaskPath === task.path ||
		view.invalidDropTargetTaskPath === task.path
	) {
		rowEl.removeClass('is-drop-target', 'is-drop-invalid');
		view.dropTargetTaskPath = null;
		view.invalidDropTargetTaskPath = null;
	}
}

export async function handleTaskDrop(
	view: IOTOTasksCenterView,
	event: DragEvent,
	targetTask: TaskFileEntry,
	rowEl: HTMLButtonElement,
): Promise<void> {
	event.preventDefault();
	const draggedTaskPath = view.draggingTaskPath;
	if (!draggedTaskPath || view.isUpdatingUpTask) {
		return;
	}

	const validation = validateTaskParentDrop(
		view.tasks,
		draggedTaskPath,
		targetTask.path,
	);
	if (!validation.valid) {
		new Notice(getTaskDropValidationMessage(validation.reason));
		clearTaskDragState(view);
		return;
	}

	await assignDraggedTaskToParent(
		view,
		draggedTaskPath,
		targetTask,
		rowEl,
	);
}

export function setCurrentDropTarget(
	view: IOTOTasksCenterView,
	taskPath: string,
	invalid: boolean,
	rowEl: HTMLButtonElement,
): void {
	if (view.dropTargetTaskPath && view.dropTargetTaskPath !== taskPath) {
		findTaskRowByPath(view, view.dropTargetTaskPath)?.removeClass(
			'is-drop-target',
		);
	}

	if (
		view.invalidDropTargetTaskPath &&
		view.invalidDropTargetTaskPath !== taskPath
	) {
		findTaskRowByPath(view, view.invalidDropTargetTaskPath)?.removeClass(
			'is-drop-invalid',
		);
	}

	view.dropTargetTaskPath = invalid ? null : taskPath;
	view.invalidDropTargetTaskPath = invalid ? taskPath : null;
	rowEl.toggleClass('is-drop-target', !invalid);
	rowEl.toggleClass('is-drop-invalid', invalid);
}

export function clearTaskDragState(view: IOTOTasksCenterView): void {
	for (const rowEl of getTaskRowElements(view)) {
		rowEl.removeClass(
			'is-dragging',
			'is-drop-target',
			'is-drop-invalid',
		);
	}
	view.contentEl
		.querySelector('.ioto-tasks-center__remove-up-task-drop-zone')
		?.removeClass('is-drop-target');
	view.contentEl
		.querySelector(TASK_LIST_SELECTOR)
		?.removeClass('has-remove-up-task-drop-zone');

	view.draggingTaskPath = null;
	view.dropTargetTaskPath = null;
	view.invalidDropTargetTaskPath = null;
	view.isRemoveUpTaskDropTarget = false;
}

export function getTaskRowElements(
	view: IOTOTasksCenterView,
): HTMLButtonElement[] {
	return Array.from(
		view.contentEl.querySelectorAll<HTMLButtonElement>(
			'.ioto-tasks-center__task-row',
		),
	);
}

export function findTaskRowByPath(
	view: IOTOTasksCenterView,
	taskPath: string,
): HTMLButtonElement | null {
	for (const rowEl of getTaskRowElements(view)) {
		if (rowEl.dataset.taskPath === taskPath) {
			return rowEl;
		}
	}

	return null;
}

export async function assignDraggedTaskToParent(
	view: IOTOTasksCenterView,
	draggedTaskPath: string,
	targetTask: TaskFileEntry,
	rowEl: HTMLButtonElement,
): Promise<void> {
	const draggedFile =
		view.app.vault.getAbstractFileByPath(draggedTaskPath);
	if (!(draggedFile instanceof TFile)) {
		clearTaskDragState(view);
		new Notice(t('view.notice.draggedTaskMissing'));
		return;
	}

	view.isUpdatingUpTask = true;
	rowEl.removeClass('is-drop-target', 'is-drop-invalid');

	try {
		await assignUpTaskToFile(view.app, draggedFile, targetTask.title);
		if (view.selectedProject) {
			view.isTasksLoading = true;
			view.render();
			await view.loadTasks(view.selectedProject);
		}
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: t('view.notice.updateUpTaskFailed');
		new Notice(message);
	} finally {
		view.isUpdatingUpTask = false;
		clearTaskDragState(view);
		view.render();
	}
}

export function handleRemoveUpTaskDragOver(
	view: IOTOTasksCenterView,
	event: DragEvent,
	dropZoneEl: HTMLDivElement,
): void {
	if (!view.draggingTaskPath || view.isUpdatingUpTask) {
		return;
	}

	event.preventDefault();
	if (event.dataTransfer) {
		event.dataTransfer.dropEffect = 'move';
	}
	clearCurrentTaskDropTargetClasses(view);
	view.isRemoveUpTaskDropTarget = true;
	dropZoneEl.addClass('is-drop-target');
}

export function handleRemoveUpTaskDragLeave(
	view: IOTOTasksCenterView,
	event: DragEvent,
	dropZoneEl: HTMLDivElement,
): void {
	const nextTarget = event.relatedTarget;
	if (nextTarget instanceof Node && dropZoneEl.contains(nextTarget)) {
		return;
	}

	view.isRemoveUpTaskDropTarget = false;
	dropZoneEl.removeClass('is-drop-target');
}

export async function handleRemoveUpTaskDrop(
	view: IOTOTasksCenterView,
	event: DragEvent,
	dropZoneEl: HTMLDivElement,
): Promise<void> {
	event.preventDefault();
	const draggedTaskPath = view.draggingTaskPath;
	if (!draggedTaskPath || view.isUpdatingUpTask) {
		return;
	}

	view.isRemoveUpTaskDropTarget = false;
	dropZoneEl.removeClass('is-drop-target');
	await removeDraggedTaskParent(view, draggedTaskPath);
}

export function clearCurrentTaskDropTargetClasses(
	view: IOTOTasksCenterView,
): void {
	if (view.dropTargetTaskPath) {
		findTaskRowByPath(view, view.dropTargetTaskPath)?.removeClass(
			'is-drop-target',
		);
		view.dropTargetTaskPath = null;
	}

	if (view.invalidDropTargetTaskPath) {
		findTaskRowByPath(view, view.invalidDropTargetTaskPath)?.removeClass(
			'is-drop-invalid',
		);
		view.invalidDropTargetTaskPath = null;
	}

	view.contentEl
		.querySelector('.ioto-tasks-center__remove-up-task-drop-zone')
		?.removeClass('is-drop-target');
	view.isRemoveUpTaskDropTarget = false;
}

export async function removeDraggedTaskParent(
	view: IOTOTasksCenterView,
	draggedTaskPath: string,
): Promise<void> {
	const draggedFile =
		view.app.vault.getAbstractFileByPath(draggedTaskPath);
	if (!(draggedFile instanceof TFile)) {
		clearTaskDragState(view);
		new Notice(t('view.notice.draggedTaskMissing'));
		return;
	}

	view.isUpdatingUpTask = true;
	try {
		await removeUpTaskFromFile(view.app, draggedFile);
		if (view.selectedProject) {
			view.isTasksLoading = true;
			view.render();
			await view.loadTasks(view.selectedProject);
		}
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: t('view.notice.removeUpTaskFailed');
		new Notice(message);
	} finally {
		view.isUpdatingUpTask = false;
		clearTaskDragState(view);
		view.render();
	}
}
