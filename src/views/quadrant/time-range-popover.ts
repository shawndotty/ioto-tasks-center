/**
 * 桌面端自定义时间区间浮层（[[Plan-20261116-083330]] §3.5）。
 *
 * 定位照 `task-links-filter-popover`：`position: fixed` + 视口夹取（8px）+ 下方不足上翻；
 * 外点 `mousedown` / `Escape` 关闭，关闭后焦点回到触发控件。
 * 打开时只构建一次，应用 / 清除后直接关闭，不重建面板。
 */

import { t } from '../../lang/helpter';
import type { TaskTimeField } from '../../tasks-center/task-time-range';
import { buildQuadrantTimeRangePanel } from '../../ui/quadrantTimeRangePanel';

export interface QuadrantTimeRangePopoverOptions {
	/** 定位与样式宿主 = 四象限视图内容区（继承 `--ioto-pq-*` 五档外观变量）。 */
	hostEl: HTMLElement;
	anchorEl: HTMLElement;
	field: TaskTimeField;
	start: string;
	end: string;
	onApply(field: TaskTimeField, start: string, end: string): void;
	onClear(): void;
	onAfterClose?: () => void;
}

export class QuadrantTimeRangePopover {
	private readonly doc: Document;
	private containerEl: HTMLDivElement | null = null;
	private anchorEl: HTMLElement | null = null;
	private outsideMouseDownHandler: ((event: MouseEvent) => void) | null = null;
	private keydownHandler: ((event: KeyboardEvent) => void) | null = null;
	private closeHandler: (() => void) | null = null;

	constructor(doc: Document) {
		this.doc = doc;
	}

	isOpen(): boolean {
		return this.containerEl !== null;
	}

	open(options: QuadrantTimeRangePopoverOptions): void {
		this.close();

		const containerEl = this.doc.createElement('div');
		containerEl.className = 'ioto-pq-time-popover';
		containerEl.setAttribute('role', 'dialog');
		containerEl.setAttribute('aria-label', t('priorityQuadrant.time.panelTitle'));
		options.hostEl.appendChild(containerEl);

		this.containerEl = containerEl;
		this.anchorEl = options.anchorEl;
		this.closeHandler = options.onAfterClose ?? null;

		const handle = buildQuadrantTimeRangePanel(containerEl, {
			field: options.field,
			start: options.start,
			end: options.end,
			onApply: (field, start, end) => {
				options.onApply(field, start, end);
				this.close({ restoreFocus: true });
			},
			onClear: () => {
				options.onClear();
				this.close({ restoreFocus: true });
			},
			onCancel: () => this.close({ restoreFocus: true }),
		});

		this.positionAtAnchor(options.anchorEl, options.hostEl);

		this.outsideMouseDownHandler = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (
				this.containerEl?.contains(target) ||
				this.anchorEl?.contains(target)
			) {
				return;
			}
			this.close();
		};
		this.doc.addEventListener('mousedown', this.outsideMouseDownHandler, true);

		this.keydownHandler = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			this.close({ restoreFocus: true });
		};
		this.doc.addEventListener('keydown', this.keydownHandler, true);

		handle.focus();
	}

	close(options: { restoreFocus?: boolean } = {}): void {
		if (this.outsideMouseDownHandler) {
			this.doc.removeEventListener(
				'mousedown',
				this.outsideMouseDownHandler,
				true,
			);
			this.outsideMouseDownHandler = null;
		}
		if (this.keydownHandler) {
			this.doc.removeEventListener('keydown', this.keydownHandler, true);
			this.keydownHandler = null;
		}

		const hadContainer = this.containerEl !== null;
		this.containerEl?.remove();
		this.containerEl = null;

		const anchorEl = this.anchorEl;
		this.anchorEl = null;
		if (options.restoreFocus) anchorEl?.focus();

		const onClose = this.closeHandler;
		this.closeHandler = null;
		if (hadContainer) onClose?.();
	}

	destroy(): void {
		this.close();
	}

	/**
	 * 左对齐锚点、下方优先；越界上翻，四周各夹 8px。
	 *
	 * 坐标相对视图内容区（`position: absolute`）：`.ioto-pq-view` 是
	 * `container-type: inline-size`（建立包含块）且 `overflow: hidden`，
	 * 挂到 body 的 fixed 浮层拿不到 `--ioto-pq-*` 外观变量；留在视图内既继承
	 * 五档主题，夹取边界也与可视区一致。
	 */
	private positionAtAnchor(anchorEl: HTMLElement, hostEl: HTMLElement): void {
		const popoverEl = this.containerEl;
		if (!popoverEl) return;

		const anchorRect = anchorEl.getBoundingClientRect();
		const hostRect = hostEl.getBoundingClientRect();
		const popoverRect = popoverEl.getBoundingClientRect();
		const hostWidth = hostEl.clientWidth || hostRect.width;
		const hostHeight = hostEl.clientHeight || hostRect.height;

		const padding = 8;
		const gap = 6;
		const anchorLeft = anchorRect.left - hostRect.left;
		const anchorTop = anchorRect.top - hostRect.top;
		const anchorBottom = anchorTop + anchorRect.height;

		let left = anchorLeft;
		left = Math.max(
			padding,
			Math.min(left, hostWidth - popoverRect.width - padding),
		);

		let top = anchorBottom + gap;
		if (top + popoverRect.height > hostHeight - padding) {
			top = anchorTop - popoverRect.height - gap;
		}
		top = Math.max(
			padding,
			Math.min(top, hostHeight - popoverRect.height - padding),
		);

		popoverEl.style.left = `${left}px`;
		popoverEl.style.top = `${top}px`;
	}
}
