/**
 * Task View 任务卡片拖拽排序（含跨章节移动、跨层级挂载）。
 *
 * - 手势骨架与 `task-view-section-drag.ts` 完全同款：Pointer Events 单实现
 * （鼠标按下即拖；触摸须先长按再移动，未长按的滑动交还原生滚动）、8px 阈值、
 * 400ms 长按、指针捕获、48px 边缘自动滚动、Esc 取消、悬浮 ghost。
 * - 拖拽过程是纯 DOM 瞬态（ghost / 落点线 / 源块整树半透明），**不写盘、不重绘**；
 *   松手才经 `moveTaskBlock`（domain 纯函数）+ `commitBlockRange` 一次原子区间
 *   重写，随后迁移折叠态 / 选中行并整树重建。
 * - 落点两类：① 任务卡（卡上缘 before / 下缘 after，成为该卡同级兄弟）；
 *   ② 章节（header → section-start；body 空白 → section-end；空章节也能接收）。
 *
 * 监听全部挂在每次 render 新建的 grip / 卡片 DOM 上（pointer capture 续传），
 * 随整树重建自然销毁，无需 register*。
 */

import {
	moveTaskBlock,
	parseChecklistItems,
} from '../../tasks-center/note-structure';
import { taskBlockRange } from '../../tasks-center/note-task-swap';
import { commitBlockRange } from './commit-task-line';
import { remapTrackedLines } from './task-view-tracked-lines';
import type {
	TaskDropPosition,
	TaskDropTarget,
	TaskMoveResult,
} from '../../tasks-center/note-structure';
import type { TaskCardDrag } from './render-note-types';
import type { TaskViewHost } from './task-view-host';

/** 鼠标 / 长按后移动超过该距离才进入拖拽（与 section-drag 同档）。 */
const CARD_DRAG_MOVE_THRESHOLD_PX = 8;
/** 触摸进入拖拽前的长按时长（与 section-drag 同档）。 */
const CARD_DRAG_LONG_PRESS_MS = 400;
/** 距滚动容器上下边缘多少 px 内开始自动滚动。 */
const EDGE_AUTO_SCROLL_ZONE_PX = 48;
/** 边缘自动滚动速度（px / 帧）。 */
const EDGE_AUTO_SCROLL_SPEED_PX = 14;
/** ghost 相对指针的偏移，避免遮挡落点横线。 */
const GHOST_OFFSET_PX = 12;
/** 卡片上下缘多少 px 内强制吸附 before / after（中线之外的命中带）。 */
const CARD_EDGE_BAND_PX = 14;

const CARD_SELECTOR = '.ioto-task-view__card';
const SECTION_SELECTOR = '.ioto-task-view__section';
const SECTION_HEADER_SELECTOR = '.ioto-task-view__section-header';
const CARD_TEXT_SELECTOR = '.ioto-task-view__card-text';

type DropTarget =
	| {
			kind: 'task';
			cardEl: HTMLElement;
			line: number;
			position: TaskDropPosition;
	  }
	| {
			kind: 'section-start';
			sectionEl: HTMLElement;
			sectionStartLine: number;
	  }
	| {
			kind: 'section-end';
			sectionEl: HTMLElement;
			sectionStartLine: number;
	  };

/** 落点稳定签名：指针移动时只在落点真的变化时才重刷指示线。 */
function dropSignature(drop: DropTarget | null): string {
	if (!drop) {
		return '';
	}
	if (drop.kind === 'task') {
		return `task:${drop.line}:${drop.position}`;
	}
	return `section:${drop.kind}:${drop.sectionStartLine}`;
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
	/** 源任务块（含整棵子树）的原文件行范围，用于排除「落进自身」。 */
	sourceStartLine: number;
	sourceEndLine: number;
	/** 拖拽中被打半透明标记的源块卡片（复位时逐张清类）。 */
	sourceCardEls: HTMLElement[];
}

/** 视图侧控制器：渲染层建好 grip 后调用 `attachHandle`。 */
export function buildCardDragController(view: TaskViewHost): TaskCardDrag {
	return {
		attachHandle(handleEl, cardEl, scrollEl) {
			attachCardDragHandle(view, handleEl, cardEl, scrollEl);
		},
	};
}

function attachCardDragHandle(
	view: TaskViewHost,
	handleEl: HTMLElement,
	cardEl: HTMLElement,
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
		sourceStartLine: -1,
		sourceEndLine: -1,
		sourceCardEls: [],
	};

	const clearLongPressTimer = (): void => {
		if (state.longPressTimer !== null) {
			window.clearTimeout(state.longPressTimer);
			state.longPressTimer = null;
		}
	};

	const clearDropClasses = (): void => {
		scrollEl
			.querySelectorAll(
				'.is-drop-before, .is-drop-after, .is-section-drop-start, .is-section-drop-end',
			)
			.forEach((el) => {
				el.classList.remove(
					'is-drop-before',
					'is-drop-after',
					'is-section-drop-start',
					'is-section-drop-end',
				);
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
		clearLongPressTimer();
		stopAutoScroll();
		destroyGhost();
		clearDropClasses();
		for (const el of state.sourceCardEls) {
			el.classList.remove('is-dragging');
		}
		state.sourceCardEls = [];
		state.sourceStartLine = -1;
		state.sourceEndLine = -1;
		scrollEl.classList.remove('is-card-dragging');
		handleEl.setAttribute('aria-grabbed', 'false');
		window.removeEventListener('keydown', onKeydown);
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
		state.dragging = false;
		state.drop = null;
	};

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			resetGesture();
		}
	}

	const isSourceBlockCard = (el: HTMLElement): boolean => {
		const line = Number.parseInt(el.dataset.line ?? '', 10);
		if (Number.isNaN(line)) {
			return false;
		}
		return line >= state.sourceStartLine && line <= state.sourceEndLine;
	};

	const beginDrag = (): boolean => {
		// 放大态不排序（提交侧也有守卫，这里拦在视觉发生之前）。
		if (view.zoomLine !== null || !view.file) {
			return false;
		}
		const fromLine = Number.parseInt(cardEl.dataset.line ?? '', 10);
		if (Number.isNaN(fromLine) || !view.data) {
			return false;
		}
		// 源块 = 任务行 + 整块更深子树（domain 同一口径）；用来①整树半透明
		// ②排除「落进自身」的落点（domain 另有成环保护，这里先消除误导指示线）。
		const lines = view.data.split('\n');
		const items = parseChecklistItems(view.data, { includeEmpty: true });
		const fromIndex = items.findIndex((item) => item.line === fromLine);
		if (fromIndex < 0) {
			return false;
		}
		const range = taskBlockRange(items, lines, fromIndex);
		if (range.end < range.start) {
			return false;
		}
		state.sourceStartLine = range.start;
		state.sourceEndLine = range.end;

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
		scrollEl.classList.add('is-card-dragging');
		handleEl.setAttribute('aria-grabbed', 'true');
		window.addEventListener('keydown', onKeydown, { capture: true });

		scrollEl
			.querySelectorAll<HTMLElement>(CARD_SELECTOR)
			.forEach((el) => {
				if (isSourceBlockCard(el)) {
					el.classList.add('is-dragging');
					state.sourceCardEls.push(el);
				}
			});

		const label =
			cardEl.querySelector(CARD_TEXT_SELECTOR)?.textContent?.trim() ||
			cardEl.dataset.taskKey ||
			'';
		const ghostEl = activeDocument.createElement('div');
		ghostEl.className = 'ioto-task-view__card-drag-ghost';
		ghostEl.textContent = label;
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
		evaluateDrop();
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

	/** 盒内空白（底部加号行 / 章节留白）的兜底落点：末章节 section-end。 */
	const resolveFallbackDrop = (): DropTarget | null => {
		const rect = scrollEl.getBoundingClientRect();
		const inside =
			state.lastX >= rect.left &&
			state.lastX <= rect.right &&
			state.lastY >= rect.top &&
			state.lastY <= rect.bottom;
		if (!inside) {
			return null;
		}
		const sections = scrollEl.querySelectorAll<HTMLElement>(SECTION_SELECTOR);
		const last = sections[sections.length - 1];
		if (!last) {
			return null;
		}
		const sectionStartLine = Number.parseInt(
			last.dataset.startLine ?? '',
			10,
		);
		if (Number.isNaN(sectionStartLine)) {
			return null;
		}
		return {
			kind: 'section-end',
			sectionEl: last,
			sectionStartLine,
		};
	};

	const evaluateDrop = (): void => {
		const hitEl = activeDocument.elementFromPoint(
			state.lastX,
			state.lastY,
		) as HTMLElement | null;

		let next: DropTarget | null = null;

		// ① 命中非源块任务卡：上缘 before / 下缘 after（边缘 14px 吸附带，
		// 其余按卡中线分），语义 = 成为该卡的同级兄弟。
		const cardHit = hitEl?.closest(CARD_SELECTOR) as HTMLElement | null;
		if (
			cardHit &&
			scrollEl.contains(cardHit) &&
			!isSourceBlockCard(cardHit)
		) {
			const line = Number.parseInt(cardHit.dataset.line ?? '', 10);
			if (!Number.isNaN(line)) {
				const rect = cardHit.getBoundingClientRect();
				const offset = state.lastY - rect.top;
				let position: TaskDropPosition;
				if (offset <= CARD_EDGE_BAND_PX) {
					position = 'before';
				} else if (rect.height - offset <= CARD_EDGE_BAND_PX) {
					position = 'after';
				} else {
					position = offset < rect.height / 2 ? 'before' : 'after';
				}
				next = { kind: 'task', cardEl: cardHit, line, position };
			}
		}

		// ② 命中章节：header → section-start；正文空白（含源块自身、续行、
		// markdown chunk）→ section-end。空 / 折叠章节也能接收（折叠态只有
		// header，仍可命中 start；end 与 start 同缝，domain 幂等）。
		if (!next) {
			const sectionHit = hitEl?.closest(
				SECTION_SELECTOR,
			) as HTMLElement | null;
			if (sectionHit && scrollEl.contains(sectionHit)) {
				const sectionStartLine = Number.parseInt(
					sectionHit.dataset.startLine ?? '',
					10,
				);
				if (!Number.isNaN(sectionStartLine)) {
					const headerHit = hitEl?.closest(
						SECTION_HEADER_SELECTOR,
					) as HTMLElement | null;
					const overHeader =
						headerHit !== null &&
						sectionHit.contains(headerHit);
					next = overHeader
						? {
								kind: 'section-start',
								sectionEl: sectionHit,
								sectionStartLine,
							}
						: {
								kind: 'section-end',
								sectionEl: sectionHit,
								sectionStartLine,
							};
				}
			}
		}

		// ③ 盒内、所有 section 之外的空白（底部加号行等）→ 文末。
		if (!next) {
			next = resolveFallbackDrop();
		}

		if (dropSignature(next) === dropSignature(state.drop)) {
			return;
		}
		clearDropClasses();
		state.drop = next;
		if (!next) {
			return;
		}
		if (next.kind === 'task') {
			next.cardEl.classList.add(
				next.position === 'before'
					? 'is-drop-before'
					: 'is-drop-after',
			);
		} else {
			next.sectionEl.classList.add(
				next.kind === 'section-start'
					? 'is-section-drop-start'
					: 'is-section-drop-end',
			);
		}
	};

	const finishDrag = (): void => {
		const drop = state.drop;
		const fromLine = Number.parseInt(cardEl.dataset.line ?? '', 10);
		// 先复位视觉，再做异步写盘（写盘后整树重建，旧 DOM 必已弃用）。
		resetGesture();
		if (!drop || Number.isNaN(fromLine)) {
			return;
		}
		const target: TaskDropTarget =
			drop.kind === 'task'
				? {
						kind: 'task',
						line: drop.line,
						position: drop.position,
					}
				: {
						kind: 'section',
						sectionStartLine: drop.sectionStartLine,
						position:
							drop.kind === 'section-start' ? 'start' : 'end',
					};
		void commitCardMove(view, fromLine, target);
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
		clearLongPressTimer();
		// 触摸 / 触控笔需要「先长按」；鼠标直接按下移动即可拖。
		if (event.pointerType !== 'mouse') {
			state.longPressTimer = window.setTimeout(() => {
				state.longPressTimer = null;
				state.longPressFired = true;
			}, CARD_DRAG_LONG_PRESS_MS);
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
			if (dist < CARD_DRAG_MOVE_THRESHOLD_PX) {
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

	// 拖拽进行中拦截原生滚动（必须 non-passive；同 section-drag 口径）。
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
 * 松手后的写盘编排（口径对齐 `commitSectionReorder` / `swapSelectedTask`）：
 * 守卫 → 落盘在册编辑器 → 纯函数移动 → 原子区间写 → 状态行号迁移 → 整树重建。
 */
async function commitCardMove(
	view: TaskViewHost,
	fromLine: number,
	target: TaskDropTarget,
): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit() || !view.data) {
		return;
	}

	// 先落盘在册编辑器（卡片 / 续写 / Section），否则按行号取块会取到旧字节。
	await view.flushInlineEdits();
	if (view.zoomLine !== null) {
		view.exitZoom();
	}
	view.cancelPendingDelete(false);

	const result: TaskMoveResult | null = moveTaskBlock(
		view.data,
		fromLine,
		target,
	);
	if (!result) {
		// 等价槽位 / 成环 / 参数无效：纯函数未产出变化，按当前数据重建复原视觉。
		view.renderNote(view.data);
		return;
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

	remapTrackedLines(view, (line) => result.mapLine(line));
	view.renderNote(view.data);
}
