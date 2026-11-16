/**
 * 四象限拖拽改优先级的手势引擎（[[Plan-20261116-112945]] §4.2）。
 *
 * 手势挂在 `gridEl` / `sidebarEl` 容器上做事件委托：`render()` 每次重建象限与卡片，
 * 容器本身不变。拖动结束复用视图既有 `setPriority()` 写盘链路，本模块不碰文件。
 *
 * 状态机要点：
 * - 单手势互斥（`active`），`finish()` 幂等；
 * - 触屏必须先长按 400ms，未长按的滑动直接放弃、交还原生滚动；
 * - 拖拽期间吞掉 Esc / contextmenu / touchmove，结束后按注册参数逐项摘监听。
 */

import {
	QUADRANT_KEYS,
	type QuadrantBucketKey,
	type QuadrantKey,
} from '../../tasks-center/quadrant-data';
import {
	isSameQuadrantDrop,
	priorityForQuadrantDrop,
	resolveQuadrantDragIntent,
} from '../../tasks-center/quadrant-drag';
import type { TaskPriorityValue } from '../../tasks-center/task-priority';

const LONG_PRESS_MS = 400;
const MOVE_THRESHOLD = 8;

export interface QuadrantDragDeps {
	gridEl: HTMLElement;
	sidebarEl: HTMLElement;
	isCardBusy(path: string): boolean;
	setPriority(path: string, priority: TaskPriorityValue | undefined): void;
	/** P0 固定返回 false（侧栏不作为落点）；P1 换成真实可见性。 */
	isSidebarDropEnabled(): boolean;
}

/** 返回幂等 dispose；视图 `clearShell()` / `onClose()` 各调一次。 */
export function attachQuadrantDrag(deps: QuadrantDragDeps): () => void {
	const { gridEl, sidebarEl } = deps;

	let disposed = false;
	let active = false;
	let dragging = false;
	let pointerId: number | null = null;
	let startX = 0;
	let startY = 0;
	let offsetX = 0;
	let offsetY = 0;
	let longPressFired = false;
	let longPressTimer: number | null = null;
	let cardEl: HTMLElement | null = null;
	let taskPath = '';
	let sourceBucketKey: string | undefined;
	let ghostEl: HTMLElement | null = null;
	let dropTargetEl: HTMLElement | null = null;
	let doc: Document | null = null;

	function clearLongPressTimer(): void {
		if (longPressTimer !== null) {
			window.clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function setDropTarget(el: HTMLElement | null): void {
		if (el === dropTargetEl) return;
		dropTargetEl?.classList.remove('is-drop-target');
		dropTargetEl = el;
		dropTargetEl?.classList.add('is-drop-target');
	}

	function positionGhost(clientX: number, clientY: number): void {
		if (!ghostEl) return;
		ghostEl.style.transform = `translate(${clientX - offsetX}px, ${clientY - offsetY}px)`;
	}

	function finish(): void {
		if (!active) return;
		// 先置 false 再释放捕获：release 会触发 lostpointercapture，
		// 此时若仍视为进行中会重入本函数。
		active = false;
		dragging = false;
		clearLongPressTimer();
		if (
			pointerId !== null &&
			cardEl &&
			typeof cardEl.releasePointerCapture === 'function'
		) {
			try {
				cardEl.releasePointerCapture(pointerId);
			} catch {
				// 指针已释放时 releasePointerCapture 会抛错，忽略。
			}
		}
		if (doc) {
			doc.removeEventListener('pointermove', onPointerMove);
			doc.removeEventListener('pointerup', onPointerUp);
			doc.removeEventListener('pointercancel', onPointerCancel);
			doc.removeEventListener('keydown', onKeydown, true);
			doc.removeEventListener('contextmenu', onContextMenu, true);
			doc.removeEventListener('touchmove', onTouchMove);
		}
		cardEl?.removeEventListener('lostpointercapture', onLostPointerCapture);
		ghostEl?.remove();
		ghostEl = null;
		setDropTarget(null);
		cardEl?.classList.remove('is-dragging');
		gridEl.classList.remove('is-card-dragging');
		sidebarEl.classList.remove('is-card-dragging');
		cardEl = null;
		taskPath = '';
		sourceBucketKey = undefined;
		pointerId = null;
		longPressFired = false;
		doc = null;
	}

	function onKeydown(event: KeyboardEvent): void {
		// 兜底：监听挂在捕获阶段，万一没被摘掉，手势结束后必须保持沉默，
		// 否则会在全局吞掉所有 Esc。
		if (!dragging) return;
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		finish();
	}

	function onContextMenu(event: MouseEvent): void {
		if (!dragging) return;
		event.preventDefault();
		event.stopPropagation();
	}

	function onTouchMove(event: TouchEvent): void {
		// 仅 preventDefault pointermove 无法阻止 iOS/Android 滚动页面，
		// 必须补这层 non-passive 的 touchmove。
		if (!dragging) return;
		event.preventDefault();
	}

	function onLostPointerCapture(): void {
		if (active) finish();
	}

	function onPointerCancel(event: PointerEvent): void {
		if (!active || event.pointerId !== pointerId) return;
		finish();
	}

	function resolveDropBucket(el: Element | null): QuadrantBucketKey | null {
		const quadrantEl = el?.closest<HTMLElement>('.ioto-pq-quadrant');
		if (quadrantEl) {
			const key = quadrantEl.dataset.quadrantKey;
			if (key && (QUADRANT_KEYS as readonly string[]).includes(key)) {
				return key as QuadrantKey;
			}
			return null;
		}
		if (el?.closest('.ioto-pq-sidebar')) return 'unlabeled';
		return null;
	}

	function updateDropTarget(clientX: number, clientY: number): void {
		const el = doc?.elementFromPoint(clientX, clientY) ?? null;
		const quadrantEl = el?.closest<HTMLElement>('.ioto-pq-quadrant');
		if (quadrantEl) {
			setDropTarget(quadrantEl);
			return;
		}
		const sidebarHit = el?.closest<HTMLElement>('.ioto-pq-sidebar');
		setDropTarget(
			sidebarHit && deps.isSidebarDropEnabled() ? sidebarHit : null,
		);
	}

	function beginDrag(clientX: number, clientY: number): void {
		const card = cardEl;
		const pointer = pointerId;
		const ownerDocument = doc;
		if (!card || pointer === null || !ownerDocument) return;
		// 真正进入拖拽时才捕获指针，保证拖到容器外仍能续传事件，
		// 同时不影响正常滑动时的原生滚动。
		if (typeof card.setPointerCapture === 'function') {
			try {
				card.setPointerCapture(pointer);
			} catch {
				// 某些环境下 setPointerCapture 可能抛错，忽略即可。
			}
		}
		dragging = true;
		card.classList.add('is-dragging');
		card.dataset.iotoSuppressClick = '1';
		gridEl.classList.add('is-card-dragging');
		sidebarEl.classList.add('is-card-dragging');

		const title =
			card.querySelector<HTMLElement>('.ioto-pq-card__title')
				?.textContent ?? '';
		const ghost = ownerDocument.createElement('div');
		ghost.className = 'ioto-pq-card-drag-ghost';
		ghost.textContent = title;
		ghost.style.width = `${card.getBoundingClientRect().width}px`;
		ownerDocument.body.appendChild(ghost);
		ghostEl = ghost;
		positionGhost(clientX, clientY);

		card.addEventListener('lostpointercapture', onLostPointerCapture);
		ownerDocument.addEventListener('keydown', onKeydown, true);
		ownerDocument.addEventListener('contextmenu', onContextMenu, true);
		ownerDocument.addEventListener('touchmove', onTouchMove, {
			passive: false,
		});
	}

	function onPointerUp(event: PointerEvent): void {
		if (!active || event.pointerId !== pointerId) return;
		if (!dragging) {
			finish();
			return;
		}
		const bucket = resolveDropBucket(
			doc?.elementFromPoint(event.clientX, event.clientY) ?? null,
		);
		const path = taskPath;
		const source = sourceBucketKey;
		let shouldWrite = false;
		let priority: TaskPriorityValue | undefined;
		if (bucket && !isSameQuadrantDrop(source, bucket)) {
			// P0 只认 p0~p3；侧栏落点需 P1 打开可见性开关才生效。
			if (bucket !== 'unlabeled' || deps.isSidebarDropEnabled()) {
				shouldWrite = true;
				priority = priorityForQuadrantDrop(bucket);
			}
		}
		// 先完成 DOM 清理，再调用写盘链路；重绘发生在 pointerup 之后。
		finish();
		if (shouldWrite && path) deps.setPriority(path, priority);
	}

	function onPointerMove(event: PointerEvent): void {
		if (!active || event.pointerId !== pointerId) return;
		if (!dragging) {
			const intent = resolveQuadrantDragIntent({
				pointerType: event.pointerType,
				longPressFired,
				dragStarted: false,
				distance: Math.hypot(
					event.clientX - startX,
					event.clientY - startY,
				),
				moveThreshold: MOVE_THRESHOLD,
			});
			if (intent === 'pending') return;
			if (intent === 'scroll-abort') {
				// 未长按就滑动 → 放弃本次手势，让原生滚动接管。
				finish();
				return;
			}
			beginDrag(event.clientX, event.clientY);
			if (!dragging) return;
		}
		event.preventDefault();
		positionGhost(event.clientX, event.clientY);
		updateDropTarget(event.clientX, event.clientY);
	}

	function onPointerDown(event: PointerEvent): void {
		if (disposed || active) return;
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		const target = event.target;
		if (!(target instanceof Element)) return;
		if (target.closest('.ioto-pq-card__more')) return;
		const card = target.closest<HTMLElement>('.ioto-pq-card');
		if (!card) return;
		const path = card.dataset.taskPath;
		if (!path) return;
		// popout 里跨窗口指针事件不可靠，整次手势放弃。
		if (card.ownerDocument !== activeDocument) return;
		if (card.classList.contains('is-busy') || deps.isCardBusy(path)) return;

		// 清掉上一次拖拽可能残留的点击抑制（落点不在卡片上时 click 不会来消费）。
		delete card.dataset.iotoSuppressClick;
		active = true;
		dragging = false;
		cardEl = card;
		taskPath = path;
		sourceBucketKey = card.dataset.quadrantKey;
		pointerId = event.pointerId;
		startX = event.clientX;
		startY = event.clientY;
		longPressFired = false;
		doc = card.ownerDocument;
		const rect = card.getBoundingClientRect();
		offsetX = event.clientX - rect.left;
		offsetY = event.clientY - rect.top;

		doc.addEventListener('pointermove', onPointerMove);
		doc.addEventListener('pointerup', onPointerUp);
		doc.addEventListener('pointercancel', onPointerCancel);
		if (event.pointerType !== 'mouse') {
			longPressTimer = window.setTimeout(() => {
				longPressTimer = null;
				// 与 TaskCenter 一致：长按不弹菜单，只取得拖拽资格，
				// 并吞掉长按后松手的那次 click。
				longPressFired = true;
				if (cardEl) cardEl.dataset.iotoSuppressClick = '1';
			}, LONG_PRESS_MS);
		}
	}

	gridEl.addEventListener('pointerdown', onPointerDown);
	sidebarEl.addEventListener('pointerdown', onPointerDown);

	return () => {
		if (disposed) return;
		disposed = true;
		finish();
		gridEl.removeEventListener('pointerdown', onPointerDown);
		sidebarEl.removeEventListener('pointerdown', onPointerDown);
	};
}
