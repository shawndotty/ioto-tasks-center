import { TFile, type HoverPopover, type Workspace } from 'obsidian';

export type TaskOutlinkCategory = 'input' | 'output' | 'outcome';

export const IOTO_TASKS_CENTER_OUTLINK_HOVER_SOURCE_ID =
	'ioto-tasks-center-outlink-popover';

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
	private readonly workspace: Workspace;
	private readonly hoverParent: { hoverPopover: HoverPopover | null } = {
		hoverPopover: null,
	};
	private containerEl: HTMLDivElement | null = null;
	private closeTimer: number | null = null;
	private outsideMouseDownHandler: ((event: MouseEvent) => void) | null =
		null;
	private keyDownHandler: ((event: KeyboardEvent) => void) | null = null;
	private hoveredItem: {
		path: string;
		targetEl: HTMLElement;
		lastEvent: MouseEvent;
	} | null = null;
	private lastPreviewPath: string | null = null;

	constructor(doc: Document, workspace: Workspace) {
		this.doc = doc;
		this.workspace = workspace;
	}

	open(options: TaskOutlinkPopoverOpenOptions): void {
		this.close();
		this.cancelClose();
		this.hoveredItem = null;
		this.lastPreviewPath = null;

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
				buttonEl.addEventListener('mouseenter', (event) => {
					if (!event.instanceOf(MouseEvent)) {
						return;
					}
					this.handleItemHover(event, item.path, buttonEl);
				});
				buttonEl.addEventListener('mousemove', (event) => {
					if (!event.instanceOf(MouseEvent)) {
						return;
					}
					this.handleItemHover(event, item.path, buttonEl);
				});
				buttonEl.addEventListener('mouseleave', () => {
					if (this.hoveredItem?.targetEl === buttonEl) {
						this.hoveredItem = null;
					}
				});
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

		this.keyDownHandler = (event: KeyboardEvent) => {
			const hoveredItem = this.hoveredItem;
			if (!hoveredItem) {
				return;
			}

			if (!event.ctrlKey && !event.metaKey) {
				return;
			}

			this.triggerHoverLinkPreview(
				hoveredItem.lastEvent,
				hoveredItem.path,
				hoveredItem.targetEl,
			);
		};
		this.doc.addEventListener('keydown', this.keyDownHandler, true);

		this.outsideMouseDownHandler = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}

			if (this.containerEl?.contains(target)) {
				return;
			}

			if (this.hoverParent.hoverPopover?.hoverEl?.contains(target)) {
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
			const hoverElConnected = Boolean(
				this.hoverParent.hoverPopover?.hoverEl?.isConnected,
			);

			if (hoverElConnected) {
				this.scheduleClose(delayMs);
				return;
			}

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
		if (this.keyDownHandler) {
			this.doc.removeEventListener('keydown', this.keyDownHandler, true);
			this.keyDownHandler = null;
		}
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
		this.hoveredItem = null;
		this.lastPreviewPath = null;
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

	private handleItemHover(
		event: MouseEvent,
		path: string,
		targetEl: HTMLElement,
	): void {
		this.hoveredItem = {
			path,
			targetEl,
			lastEvent: event,
		};

		if (!event.ctrlKey && !event.metaKey) {
			return;
		}

		this.triggerHoverLinkPreview(event, path, targetEl);
	}

	private triggerHoverLinkPreview(
		event: MouseEvent,
		path: string,
		targetEl: HTMLElement,
	): void {
		if (
			this.lastPreviewPath === path &&
			this.hoverParent.hoverPopover?.hoverEl.isConnected
		) {
			return;
		}

		this.lastPreviewPath = path;
		this.workspace.trigger('hover-link', {
			event,
			source: IOTO_TASKS_CENTER_OUTLINK_HOVER_SOURCE_ID,
			hoverParent: this.hoverParent,
			targetEl,
			linktext: path,
			sourcePath: path,
		});
	}
}
