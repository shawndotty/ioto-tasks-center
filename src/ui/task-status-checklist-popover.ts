import type { IncompleteChecklistItem } from '../tasks-center/types';

export interface TaskStatusChecklistPopoverItem
	extends IncompleteChecklistItem {
	displayText: string;
}

export interface TaskStatusChecklistPopoverOpenOptions {
	anchorEl: HTMLElement;
	title: string;
	emptyText: string;
	items: TaskStatusChecklistPopoverItem[];
	onItemClick: (item: TaskStatusChecklistPopoverItem) => void;
}

function getChecklistPreviewCharWidth(char: string): number {
	return /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(
		char,
	)
		? 2
		: 1;
}

export function truncateChecklistPreview(
	text: string,
	maxDisplayWidth = 40,
): string {
	let textDisplayWidth = 0;
	for (const char of text) {
		textDisplayWidth += getChecklistPreviewCharWidth(char);
	}

	if (textDisplayWidth <= maxDisplayWidth) {
		return text;
	}

	if (maxDisplayWidth <= 3) {
		return '.'.repeat(Math.max(0, maxDisplayWidth));
	}

	const ellipsisWidth = 3;
	const availableWidth = maxDisplayWidth - ellipsisWidth;
	let currentWidth = 0;
	let truncated = '';
	for (const char of text) {
		const charWidth = getChecklistPreviewCharWidth(char);
		if (currentWidth + charWidth > availableWidth) {
			break;
		}
		truncated += char;
		currentWidth += charWidth;
	}

	return `${truncated}...`;
}

export class TaskStatusChecklistPopover {
	private readonly doc: Document;
	private containerEl: HTMLDivElement | null = null;
	private closeTimer: number | null = null;
	private outsideMouseDownHandler: ((event: MouseEvent) => void) | null =
		null;

	constructor(doc: Document) {
		this.doc = doc;
	}

	open(options: TaskStatusChecklistPopoverOpenOptions): void {
		this.close();
		this.cancelClose();

		const containerEl = this.doc.createElement('div');
		containerEl.className = 'ioto-tasks-center__status-checklist-popover';

		const titleEl = containerEl.createDiv({
			cls: 'ioto-tasks-center__status-checklist-popover-title',
			text: options.title,
		});
		titleEl.setAttr('role', 'heading');

		if (options.items.length === 0) {
			containerEl.createDiv({
				cls: 'ioto-tasks-center__status-checklist-popover-empty',
				text: options.emptyText,
			});
		} else {
			const listEl = containerEl.createDiv({
				cls: 'ioto-tasks-center__status-checklist-popover-list',
			});
			for (const item of options.items) {
				const buttonEl = listEl.createEl('button', {
					cls: 'ioto-tasks-center__status-checklist-popover-item',
					text: item.displayText,
				});
				buttonEl.type = 'button';
				buttonEl.ariaLabel = item.text;
				buttonEl.addEventListener('click', () => {
					this.close();
					options.onItemClick(item);
				});
			}
		}

		containerEl.addEventListener('mouseenter', () => {
			this.cancelClose();
		});
		containerEl.addEventListener('mouseleave', () => {
			this.scheduleClose();
		});

		this.doc.body.appendChild(containerEl);
		this.containerEl = containerEl;
		this.positionAtAnchor(options.anchorEl);

		this.outsideMouseDownHandler = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			if (this.containerEl?.contains(target)) {
				return;
			}

			this.close();
		};
		this.doc.addEventListener(
			'mousedown',
			this.outsideMouseDownHandler,
			true,
		);
	}

	scheduleClose(delayMs = 150): void {
		this.cancelClose();
		this.closeTimer = window.setTimeout(() => {
			this.closeTimer = null;
			this.close();
		}, delayMs);
	}

	cancelClose(): void {
		if (this.closeTimer === null) {
			return;
		}

		window.clearTimeout(this.closeTimer);
		this.closeTimer = null;
	}

	close(): void {
		this.cancelClose();
		if (this.outsideMouseDownHandler) {
			this.doc.removeEventListener(
				'mousedown',
				this.outsideMouseDownHandler,
				true,
			);
			this.outsideMouseDownHandler = null;
		}

		this.containerEl?.remove();
		this.containerEl = null;
	}

	destroy(): void {
		this.close();
	}

	private positionAtAnchor(anchorEl: HTMLElement): void {
		const containerEl = this.containerEl;
		if (!containerEl) {
			return;
		}

		const anchorRect = anchorEl.getBoundingClientRect();
		const popoverRect = containerEl.getBoundingClientRect();
		const view = this.doc.defaultView;
		const viewportWidth = view?.innerWidth ?? 0;
		const viewportHeight = view?.innerHeight ?? 0;

		const padding = 8;
		const gap = 6;
		let left = anchorRect.left;
		left = Math.max(
			padding,
			Math.min(left, viewportWidth - popoverRect.width - padding),
		);

		let top = anchorRect.bottom + gap;
		if (top + popoverRect.height > viewportHeight - padding) {
			top = anchorRect.top - popoverRect.height - gap;
		}
		top = Math.max(
			padding,
			Math.min(top, viewportHeight - popoverRect.height - padding),
		);

		containerEl.style.left = `${left}px`;
		containerEl.style.top = `${top}px`;
	}
}
