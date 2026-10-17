/**
 * Task View 顶层 Section 拖拽排序。
 *
 * - 手势：Pointer Events 单实现（鼠标按下即拖；触摸须先长按再移动，未长按的
 *   滑动交还原生滚动——口径与 tasks-center 的 `touch-gesture.ts` 一致）。
 * - 拖拽过程是纯 DOM 瞬态（ghost / 指示线 / 半透明源块），**不写盘、不重绘**；
 *   松手才经 `reorderTopLevelSections`（domain 纯函数）+ `commitBlockRange`
 *   一次原子区间重写，随后迁移折叠态 / 选中行并整树重建。
 *
 * 监听全部挂在每次 render 新建的 grip / section DOM 上（pointer capture 续传），
 * 随整树重建自然销毁，无需 register*。
 */

import { reorderTopLevelSections } from '../../tasks-center/note-structure';
import { commitBlockRange } from './commit-task-line';
import { remapTrackedLines } from './task-view-tracked-lines';
import type {
	SectionDropPosition,
	SectionReorderResult,
} from '../../tasks-center/note-structure';
import type { TaskSectionDrag } from './render-note-types';
import type { TaskViewHost } from './task-view-host';

/** 鼠标 / 长按后移动超过该距离才进入拖拽（防误触；触摸口径对齐 tasks-center 10px 一档）。 */
const SECTION_DRAG_MOVE_THRESHOLD_PX = 8;
/** 触摸进入拖拽前的长按时长（与任务行 TASK_ROW_LONG_PRESS_MS 同档）。 */
const SECTION_DRAG_LONG_PRESS_MS = 400;
/** 距滚动容器上下边缘多少 px 内开始自动滚动。 */
const EDGE_AUTO_SCROLL_ZONE_PX = 48;
/** 边缘自动滚动速度（px / 帧）。 */
const EDGE_AUTO_SCROLL_SPEED_PX = 14;
/** ghost 相对指针的偏移，避免遮挡落点横线。 */
const GHOST_OFFSET_PX = 12;

const SECTION_SELECTOR = '.ioto-task-view__section[data-level]';
const SECTION_TITLE_SELECTOR = '.ioto-task-view__section-title';

interface DropTarget {
	sectionEl: HTMLElement;
	position: SectionDropPosition;
}

interface DragGestureState {
	pointerId: number | null;
	pointerType: string;
	startX: number;
	startY: number;
	lastX: number;
	lastY: number;
	longPressTimer: number | null;
	longPressFired: boolean;
	scrollAborted: boolean;
	dragging: boolean;
	ghostEl: HTMLElement | null;
	autoScrollRaf: number | null;
	drop: DropTarget | null;
}

/** 视图侧控制器：渲染层建好 grip 后调用 `attachHandle`。 */
export function buildSectionDragController(
	view: TaskViewHost,
): TaskSectionDrag {
	return {
		attachHandle(handleEl, sectionEl, scrollEl) {
			attachSectionDragHandle(view, handleEl, sectionEl, scrollEl);
		},
	};
}

function attachSectionDragHandle(
	view: TaskViewHost,
	handleEl: HTMLElement,
	sectionEl: HTMLElement,
	scrollEl: HTMLElement,
): void {
	const state: DragGestureState = {
		pointerId: null,
		pointerType: '',
		startX: 0,
		startY: 0,
		lastX: 0,
		lastY: 0,
		longPressTimer: null,
		longPressFired: false,
		scrollAborted: false,
		dragging: false,
		ghostEl: null,
		autoScrollRaf: null,
		drop: null,
	};

	const clearLongPressTimer = (): void => {
		if (state.longPressTimer !== null) {
			window.clearTimeout(state.longPressTimer);
			state.longPressTimer = null;
		}
	};

	const clearDropClasses = (): void => {
		scrollEl
			.querySelectorAll('.is-drop-before, .is-drop-after')
			.forEach((el) => {
				el.classList.remove('is-drop-before', 'is-drop-after');
			});
	};

	const destroyGhost = (): void => {
		state.ghostEl?.remove();
		state.ghostEl = null;
	};

	const stopAutoScroll = (): void => {
		if (state.autoScrollRaf !== null) {
			window.cancelAnimationFrame(state.autoScrollRaf);
			state.autoScrollRaf = null;
		}
	};

	const resetGesture = (): void => {
		// 先置 false 再释放捕获：release 会触发 lostpointercapture，
		// 若此时 dragging 仍为 true 会重入本函数。
		state.dragging = false;
		clearLongPressTimer();
		stopAutoScroll();
		destroyGhost();
		clearDropClasses();
		sectionEl.classList.remove('is-dragging');
		scrollEl.classList.remove('is-section-dragging');
		handleEl.setAttribute('aria-grabbed', 'false');
		// 🔴 必须带 capture:true，与 `beginDrag` 的注册参数逐项一致：
		// `removeEventListener` 按 (type, listener, capture) 三元组匹配，省略第三参
		// 等于 `capture:false` → 摘不掉，每次拖 Section 都会在 window 捕获阶段留下
		// 一个永久吞掉 Esc 的监听器（[[Research-20261017-150117]]）。
		window.removeEventListener('keydown', onKeydown, true);
		if (
			state.pointerId !== null &&
			typeof handleEl.releasePointerCapture === 'function'
		) {
			try {
				handleEl.releasePointerCapture(state.pointerId);
			} catch {
				// 指针已释放时 releasePointerCapture 会抛错，忽略。
			}
		}
		state.pointerId = null;
		state.longPressFired = false;
		state.scrollAborted = false;
		state.drop = null;
		// 注销「就地收尸」入口（仅在仍指向自己时清，避免踩掉别的 Section 的登记）。
		if (view.cancelActiveDrag === resetGesture) {
			view.cancelActiveDrag = undefined;
		}
	};

	function onKeydown(event: KeyboardEvent): void {
		// 兜底：本监听器挂在 window 捕获阶段，一旦因任何原因没被摘掉，只要手势
		// 已结束就必须保持沉默——否则它会在全局吃掉所有 Esc（回归事故的形态）。
		if (!state.dragging) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			resetGesture();
		}
	}

	const beginDrag = (): boolean => {
		// 放大态不排序（提交侧也有守卫，这里拦在视觉发生之前）。
		if (view.zoomLine !== null || !view.file) {
			return false;
		}
		if (
			state.pointerId !== null &&
			typeof handleEl.setPointerCapture === 'function'
		) {
			try {
				handleEl.setPointerCapture(state.pointerId);
			} catch {
				// 某些环境 setPointerCapture 可能抛错，忽略即可。
			}
		}
		state.dragging = true;
		sectionEl.classList.add('is-dragging');
		scrollEl.classList.add('is-section-dragging');
		handleEl.setAttribute('aria-grabbed', 'true');
		window.addEventListener('keydown', onKeydown, { capture: true });

		const title =
			sectionEl.querySelector(SECTION_TITLE_SELECTOR)?.textContent?.trim() ||
			'';
		const ghostEl = activeDocument.createElement('div');
		ghostEl.className = 'ioto-task-view__section-drag-ghost';
		ghostEl.textContent = title;
		ghostEl.style.maxWidth = `${Math.round(scrollEl.clientWidth * 0.8)}px`;
		activeDocument.body.appendChild(ghostEl);
		state.ghostEl = ghostEl;
		moveGhost(state.lastX, state.lastY);

		const autoScrollLoop = (): void => {
			if (!state.dragging) {
				state.autoScrollRaf = null;
				return;
			}
			const rect = scrollEl.getBoundingClientRect();
			if (state.lastY - rect.top < EDGE_AUTO_SCROLL_ZONE_PX) {
				scrollEl.scrollBy(0, -EDGE_AUTO_SCROLL_SPEED_PX);
				evaluateDrop();
			} else if (
				rect.bottom - state.lastY <
				EDGE_AUTO_SCROLL_ZONE_PX
			) {
				scrollEl.scrollBy(0, EDGE_AUTO_SCROLL_SPEED_PX);
				evaluateDrop();
			}
			state.autoScrollRaf = window.requestAnimationFrame(autoScrollLoop);
		};
		state.autoScrollRaf = window.requestAnimationFrame(autoScrollLoop);
		// 登记「就地收尸」入口：整树重建 / 关笔记前由 renderNote / clear 调用。
		view.cancelActiveDrag = resetGesture;
		return true;
	};

	const moveGhost = (clientX: number, clientY: number): void => {
		const ghostEl = state.ghostEl;
		if (!ghostEl) {
			return;
		}
		ghostEl.style.transform = `translate(${clientX + GHOST_OFFSET_PX}px, ${
			clientY + GHOST_OFFSET_PX
		}px)`;
	};

	const evaluateDrop = (): void => {
		const hit = activeDocument
			.elementFromPoint(state.lastX, state.lastY)
			?.closest(SECTION_SELECTOR) as HTMLElement | null;

		let next: DropTarget | null = null;
		if (hit && hit !== sectionEl) {
			const level = Number(hit.dataset.level ?? '0');
			if (level <= 0) {
				// 引导区 → 第一个标题块之前。
				const firstHeading = scrollEl.querySelector<HTMLElement>(
					'.ioto-task-view__section[data-level]:not([data-level="0"])',
				);
				if (firstHeading && firstHeading !== sectionEl) {
					next = { sectionEl: firstHeading, position: 'before' };
				}
			} else {
				const rect = hit.getBoundingClientRect();
				const position: SectionDropPosition =
					state.lastY < rect.top + rect.height / 2 ? 'before' : 'after';
				next = { sectionEl: hit, position };
			}
		} else if (!hit) {
			// 命中空白（底部加号行 / 容器留白）且指针仍在滚动容器内 → 移到最后。
			const rect = scrollEl.getBoundingClientRect();
			const inside =
				state.lastX >= rect.left &&
				state.lastX <= rect.right &&
				state.lastY >= rect.top &&
				state.lastY <= rect.bottom;
			if (inside) {
				const headings = scrollEl.querySelectorAll<HTMLElement>(
					'.ioto-task-view__section[data-level]:not([data-level="0"])',
				);
				const last = headings[headings.length - 1];
				if (last && last !== sectionEl) {
					next = { sectionEl: last, position: 'after' };
				}
			}
		}

		const changed =
			next?.sectionEl !== state.drop?.sectionEl ||
			next?.position !== state.drop?.position;
		if (!changed) {
			return;
		}
		clearDropClasses();
		state.drop = next;
		if (next) {
			next.sectionEl.classList.add(
				next.position === 'before' ? 'is-drop-before' : 'is-drop-after',
			);
		}
	};

	const finishDrag = (): void => {
		const drop = state.drop;
		// 先复位视觉，再做异步写盘（写盘后整树重建，旧 DOM 必已弃用）。
		resetGesture();
		if (!drop) {
			return;
		}
		const from = Number.parseInt(sectionEl.dataset.startLine ?? '', 10);
		const target = Number.parseInt(
			drop.sectionEl.dataset.startLine ?? '',
			10,
		);
		if (Number.isNaN(from) || Number.isNaN(target)) {
			return;
		}
		void commitSectionReorder(view, from, target, drop.position);
	};

	handleEl.addEventListener('pointerdown', (event: PointerEvent) => {
		if (event.pointerType === 'mouse' && event.button !== 0) {
			return;
		}
		state.pointerId = event.pointerId;
		state.pointerType = event.pointerType;
		state.startX = event.clientX;
		state.startY = event.clientY;
		state.lastX = event.clientX;
		state.lastY = event.clientY;
		state.longPressFired = false;
		state.scrollAborted = false;
		state.drop = null;
		// 🔴 起手的 8px 必须在手柄盒内走完，否则指针先离开图标 →
		// 本元素再也收不到 pointermove（[[Research-20261017-112730]] §三：0 次起拖）。
		// 捕获提前到 pointerdown：阈值退回纯防抖，不再受手柄几何限制。
		try {
			handleEl.setPointerCapture(event.pointerId);
		} catch {
			// 指针已失效 / 环境不支持时抛错，忽略（pointerup 另有兜底）。
		}
		clearLongPressTimer();
		// 触摸 / 触控笔需要「先长按」；鼠标直接按下移动即可拖。
		if (event.pointerType !== 'mouse') {
			state.longPressTimer = window.setTimeout(() => {
				state.longPressTimer = null;
				state.longPressFired = true;
			}, SECTION_DRAG_LONG_PRESS_MS);
		}
	});

	handleEl.addEventListener('pointermove', (event: PointerEvent) => {
		if (
			state.pointerId === null ||
			event.pointerId !== state.pointerId
		) {
			return;
		}
		if (state.scrollAborted) {
			return;
		}
		state.lastX = event.clientX;
		state.lastY = event.clientY;

		if (!state.dragging) {
			const dist = Math.hypot(
				event.clientX - state.startX,
				event.clientY - state.startY,
			);
			if (dist < SECTION_DRAG_MOVE_THRESHOLD_PX) {
				return;
			}
			// 触摸：未触发长按的位移视为列表滚动，整次触摸放弃拖拽。
			if (state.pointerType !== 'mouse' && !state.longPressFired) {
				state.scrollAborted = true;
				clearLongPressTimer();
				return;
			}
			clearLongPressTimer();
			if (!beginDrag()) {
				state.scrollAborted = true;
				return;
			}
		}

		event.preventDefault();
		moveGhost(event.clientX, event.clientY);
		evaluateDrop();
	});

	handleEl.addEventListener('pointerup', (event: PointerEvent) => {
		if (
			state.pointerId === null ||
			event.pointerId !== state.pointerId
		) {
			return;
		}
		state.lastX = event.clientX;
		state.lastY = event.clientY;
		if (state.dragging) {
			finishDrag();
		} else {
			resetGesture();
		}
	});

	handleEl.addEventListener('pointercancel', () => {
		resetGesture();
	});

	// 手柄被移出文档 / display:none / 系统回收指针时捕获会静默丢失，
	// 这一路必定收不到 pointerup → 不收尸就永久冻住 ghost（只能 Esc）。
	handleEl.addEventListener('lostpointercapture', () => {
		if (state.dragging) {
			resetGesture();
		}
	});

	// 拖拽进行中拦截原生滚动（必须 non-passive；同 touch-gesture 口径）。
	handleEl.addEventListener(
		'touchmove',
		(event: TouchEvent) => {
			if (state.dragging) {
				event.preventDefault();
			}
		},
		{ passive: false },
	);
}

/**
 * 松手后的写盘编排（口径对齐 `swapSelectedTask`）：
 * 守卫 → 纯函数重排 → 原子区间写 → 状态行号迁移 → 整树重建。
 */
async function commitSectionReorder(
	view: TaskViewHost,
	fromStartLine: number,
	targetStartLine: number,
	position: SectionDropPosition,
): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) {
		return;
	}

	// 先落盘在册编辑器（卡片 / 续写 / Section），否则按行号取块会取到旧字节。
	await view.flushInlineEdits();
	if (view.zoomLine !== null) {
		view.exitZoom();
	}
	view.cancelPendingDelete(false);

	const result: SectionReorderResult | null = reorderTopLevelSections(
		view.data ?? '',
		fromStartLine,
		targetStartLine,
		position,
	);
	if (!result) {
		return; // 等价槽位 / 参数无效：静默 no-op
	}

	const outcome = await commitBlockRange(view.app, file, {
		startLine: result.startLine,
		endLine: result.endLine,
		originalLines: result.originalLines,
		nextText: result.nextLines.join('\n'),
	});
	// 🔴 红线：data / lastLoadedText 同步（conflict 会弹 Notice）。
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}
	if (outcome.status !== 'ok') {
		return; // unchanged：无写入、跟踪态不动
	}

	// 箭头包一层：直接传方法引用会触发 unbound-method（this 脱离对象）。
	remapTrackedLines(view, (line) =>
		line === null ? null : result.mapLine(line),
	);
	view.renderNote(view.data);
}
