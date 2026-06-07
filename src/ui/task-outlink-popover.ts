import { TFile } from 'obsidian';

export type TaskOutlinkCategory = 'input' | 'output' | 'outcome';

export interface TaskOutlinkPopoverItem {
	path: string;
	title: string;
	file: TFile;
}

export interface TaskOutlinkPopoverOpenOptions {
	anchorEl: HTMLElement;
	categoryTitle: string;
	emptyText: string;
	items: TaskOutlinkPopoverItem[];
	onItemClick: (file: TFile) => void;
}

export class TaskOutlinkPopover {
	private readonly doc: Document;
	private containerEl: HTMLDivElement | null = null;
	private closeTimer: number | null = null;
	private outsideMouseDownHandler: ((event: MouseEvent) => void) | null =
		null;

	constructor(doc: Document) {
		this.doc = doc;
	}

	open(options: TaskOutlinkPopoverOpenOptions): void {
		this.close();
		this.cancelClose();

		const containerEl = this.doc.createElement('div');
		containerEl.className = 'ioto-tasks-center__outlink-popover';

		const titleEl = containerEl.createDiv({
			cls: 'ioto-tasks-center__outlink-popover-title',
			text: options.categoryTitle,
		});
		titleEl.setAttr('role', 'heading');

		if (options.items.length === 0) {
			containerEl.createDiv({
				cls: 'ioto-tasks-center__outlink-popover-empty',
				text: options.emptyText,
			});
		} else {
			const listEl = containerEl.createDiv({
				cls: 'ioto-tasks-center__outlink-popover-list',
			});
			for (const item of options.items) {
				const buttonEl = listEl.createEl('button', {
					cls: 'ioto-tasks-center__outlink-popover-item',
					text: item.title,
				});
				buttonEl.type = 'button';
				buttonEl.addEventListener('click', () => {
					this.close();
					options.onItemClick(item.file);
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
