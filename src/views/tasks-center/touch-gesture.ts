import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type { TaskFileEntry } from '../../tasks-center/types';
import {
	assignDraggedTaskToParent,
	beginTaskDragState,
	clearCurrentTaskDropTargetClasses,
	clearTaskDragState,
	findTaskRowByPath,
	updateTaskDropTarget,
} from './drag-controller';
import {
	TASK_ROW_DRAG_MOVE_THRESHOLD,
	TASK_ROW_LONG_PRESS_MS,
} from './constants';

interface TouchGestureState {
	pointerId: number | null;
	startX: number;
	startY: number;
	longPressTimer: number | null;
	longPressFired: boolean;
	dragging: boolean;
	scrollAborted: boolean;
	ghostEl: HTMLElement | null;
	lastTargetPath: string | null;
}

/**
 * 移动端 / 紧凑布局下的统一手势引擎（Pointer Events）。
 *
 * 判定规则（见优化方案）：
 * - 任务属性菜单由行尾"⋯"按钮负责，不再通过长按弹出，避免与拖拽设父任务冲突。
 * - 按住不动超过阈值：仅作为"预留拖拽"手势，吞掉随后的 click，不再弹菜单。
 * - 按住并位移超过阈值 → 进入拖拽（重设父任务），并取消定时器。
 * - 没到阈值、几乎没动 → 视为普通点击（沿用既有 click 打开任务文件）。
 * - 列表原生滚动 / pointercancel → 取消手势、清理拖拽态。
 *
 * 该函数仅在 `view.isMobileTaskListLayout()` 为 true 时由 `task-row-renderer` 调用，
 * 桌面端（非紧凑）继续走原生 `draggable` + `contextmenu`，互不影响。
 */
export function attachTouchGesture(
	view: IOTOTasksCenterView,
	rowEl: HTMLButtonElement,
	task: TaskFileEntry,
): void {
	const state: TouchGestureState = {
		pointerId: null,
		startX: 0,
		startY: 0,
		longPressTimer: null,
		longPressFired: false,
		dragging: false,
		scrollAborted: false,
		ghostEl: null,
		lastTargetPath: null,
	};

	const clearTimer = (): void => {
		if (state.longPressTimer !== null) {
			window.clearTimeout(state.longPressTimer);
			state.longPressTimer = null;
		}
	};

	const destroyGhost = (): void => {
		state.ghostEl?.remove();
		state.ghostEl = null;
	};

	const resetGesture = (cancelDrag: boolean): void => {
		clearTimer();
		if (cancelDrag && state.dragging) {
			clearTaskDragState(view);
		}
		destroyGhost();
		state.longPressFired = false;
		state.dragging = false;
		state.scrollAborted = false;
		state.lastTargetPath = null;
		rowEl.removeClass('is-pointer-dragging');
	};

	const moveGhost = (clientX: number, clientY: number): void => {
		if (!state.ghostEl) {
			return;
		}
		state.ghostEl.style.transform = `translate(${clientX}px, ${clientY}px)`;
	};

	const beginDrag = (): boolean => {
		// 真正进入拖拽时才捕获指针，保证拖到行外仍能续传事件，
		// 同时不影响正常滑动时的原生滚动。
		if (state.pointerId !== null && typeof rowEl.setPointerCapture === 'function') {
			try {
				rowEl.setPointerCapture(state.pointerId);
			} catch {
				// 某些环境下 setPointerCapture 可能抛错，忽略即可。
			}
		}
		const started = beginTaskDragState(view, task, rowEl, {
			showRemoveDropZone: false,
		});
		if (!started) {
			resetGesture(false);
			return false;
		}
		state.dragging = true;
		rowEl.addClass('is-pointer-dragging');
		rowEl.dataset.iotoSuppressClick = '1';
		const ghostEl = activeDocument.createElement('div');
		ghostEl.className = 'ioto-tasks-center__drag-ghost';
		ghostEl.textContent = task.title;
		activeDocument.body.appendChild(ghostEl);
		state.ghostEl = ghostEl;
		return true;
	};

	const evaluateDropTarget = (clientX: number, clientY: number): void => {
		const hit = activeDocument
			.elementFromPoint(clientX, clientY)
			?.closest('.ioto-tasks-center__task-row') as
			| HTMLButtonElement
			| null;
		if (!hit || hit === rowEl || !hit.dataset.taskPath) {
			clearCurrentTaskDropTargetClasses(view);
			state.lastTargetPath = null;
			return;
		}
		const targetPath = hit.dataset.taskPath;
		const targetTask = view.tasks.find((t) => t.path === targetPath);
		if (!targetTask) {
			clearCurrentTaskDropTargetClasses(view);
			state.lastTargetPath = null;
			return;
		}
		updateTaskDropTarget(view, targetTask, hit);
		state.lastTargetPath = targetPath;
	};

	rowEl.addEventListener('pointerdown', (event: PointerEvent) => {
		if (view.isBatchEditMode) {
			return;
		}
		if (event.pointerType === 'mouse' && event.button !== 0) {
			return;
		}
		state.pointerId = event.pointerId;
		state.startX = event.clientX;
		state.startY = event.clientY;
		state.longPressFired = false;
		state.dragging = false;
		state.scrollAborted = false;
		state.lastTargetPath = null;
		rowEl.dataset.iotoSuppressClick = '';
		// 注意：此处不再立即 setPointerCapture，保留默认 touch-action，
		// 让正常滑动时列表可原生滚动；仅在真正进入 beginDrag 时再捕获。
		clearTimer();
		state.longPressTimer = window.setTimeout(() => {
			state.longPressTimer = null;
			state.longPressFired = true;
			// 行尾已有"⋯"按钮负责属性菜单，长按不再弹菜单，仅吞掉随后的
			// click，把"按住不动"保留为拖拽手势的一部分，避免与 drag 冲突。
			rowEl.dataset.iotoSuppressClick = '1';
		}, TASK_ROW_LONG_PRESS_MS);
	});

	rowEl.addEventListener('pointermove', (event: PointerEvent) => {
		if (state.pointerId === null || event.pointerId !== state.pointerId) {
			return;
		}
		// 本次触摸已判定为"滑动滚动"，整次触摸不再尝试拖拽，交还原生滚动。
		if (state.scrollAborted) {
			return;
		}
		const dist = Math.hypot(
			event.clientX - state.startX,
			event.clientY - state.startY,
		);

		if (!state.dragging) {
			if (dist < TASK_ROW_DRAG_MOVE_THRESHOLD) {
				// 仍在"按住中"，尚未超过位移阈值，不做任何处理（允许滚动）。
				return;
			}
			// 超过位移阈值。设计约定：必须"先长按再移动"才进入拖拽。
			// 未触发长按即为正常的列表滑动 → 放弃本次手势、交还原生滚动。
			if (!state.longPressFired) {
				state.scrollAborted = true;
				clearTimer();
				if (typeof rowEl.releasePointerCapture === 'function') {
					try {
						rowEl.releasePointerCapture(event.pointerId);
					} catch {
						// 忽略释放失败。
					}
				}
				return;
			}
			// 已触发长按 → 取消菜单定时器，进入拖拽。
			clearTimer();
			if (view.isUpdatingUpTask) {
				resetGesture(false);
				return;
			}
			if (!beginDrag()) {
				return;
			}
		}

		// 拖拽进行中：跟随手指、命中测试、阻止列表滚动。
		event.preventDefault();
		moveGhost(event.clientX, event.clientY);
		evaluateDropTarget(event.clientX, event.clientY);
	});

	const finishPointer = (event: PointerEvent): void => {
		if (state.pointerId === null || event.pointerId !== state.pointerId) {
			return;
		}
		state.pointerId = null;
		clearTimer();

		if (state.dragging) {
			const targetPath = state.lastTargetPath;
			if (targetPath) {
				const targetTask = view.tasks.find(
					(t) => t.path === targetPath,
				);
				const targetRow = findTaskRowByPath(view, targetPath);
				if (targetTask && targetRow) {
					void assignDraggedTaskToParent(
						view,
						view.draggingTaskPath as string,
						targetTask,
						targetRow,
					);
				} else {
					clearTaskDragState(view);
				}
			} else {
				clearTaskDragState(view);
			}
		}
		// 若长按已弹菜单（手指没动）则不额外处理；菜单已展示。
		resetGesture(state.dragging);
	};

	rowEl.addEventListener('pointerup', finishPointer);
	rowEl.addEventListener('pointercancel', () => {
		state.pointerId = null;
		clearTimer();
		resetGesture(true);
	});

	// 抑制移动端长按合成的 contextmenu，避免菜单弹出两次。
	rowEl.addEventListener('contextmenu', (event: MouseEvent) => {
		if (view.isMobileTaskListLayout()) {
			event.preventDefault();
		}
	});

	// 拖拽进行中拦截原生滚动（touchmove 的 preventDefault 才能阻止滚动，
	// 仅 preventDefault pointermove 无效）。
	rowEl.addEventListener(
		'touchmove',
		(event: TouchEvent) => {
			if (state.dragging) {
				event.preventDefault();
			}
		},
		{ passive: false },
	);
}
