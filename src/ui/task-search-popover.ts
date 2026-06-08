export interface TaskSearchPopoverOptions {
	anchorEl: HTMLElement;
	placeholder: string;
	value: string;
	canSearch: boolean;
	showClear: boolean;
	searchButtonText: string;
	searchButtonAriaLabel: string;
	clearButtonAriaLabel: string;
	clearButtonTitle: string;
	onChange: (value: string) => void;
	onApply: () => void;
	onClear: () => void;
	onClose: () => void;
	shouldFocus: boolean;
}

export class TaskSearchPopover {
	private readonly doc: Document;
	private containerEl: HTMLDivElement | null = null;
	private outsideMouseDownHandler: ((event: MouseEvent) => void) | null =
		null;
	private keyDownHandler: ((event: KeyboardEvent) => void) | null = null;

	constructor(doc: Document) {
		this.doc = doc;
	}

	open(options: TaskSearchPopoverOptions): void {
		this.close();

		const containerEl = this.doc.createElement('div');
		containerEl.className = 'ioto-tasks-center__task-search-popover';

		const controlsEl = containerEl.createDiv({
			cls: 'ioto-tasks-center__task-search-controls',
		});

		const inputWrapperEl = controlsEl.createDiv({
			cls: 'ioto-tasks-center__task-search-input-wrapper',
		});
		const inputEl = inputWrapperEl.createEl('input', {
			cls: 'ioto-tasks-center__task-search-input',
			type: 'search',
		});
		inputEl.placeholder = options.placeholder;
		inputEl.value = options.value;
		inputEl.disabled = !options.canSearch;
		inputEl.addEventListener('input', () => {
			options.onChange(inputEl.value);
		});
		inputEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') {
				return;
			}

			event.preventDefault();
			options.onApply();
		});

		if (options.showClear) {
			const clearButtonEl = inputWrapperEl.createEl('button', {
				cls: 'ioto-tasks-center__task-search-clear-button',
				text: 'X',
			});
			clearButtonEl.type = 'button';
			clearButtonEl.disabled = !options.canSearch;
			clearButtonEl.ariaLabel = options.clearButtonAriaLabel;
			clearButtonEl.title = options.clearButtonTitle;
			clearButtonEl.addEventListener('click', () => {
				options.onClear();
			});
		}

		const searchButtonEl = controlsEl.createEl('button', {
			cls: 'ioto-tasks-center__task-search-button',
			text: options.searchButtonText,
		});
		searchButtonEl.type = 'button';
		searchButtonEl.disabled = !options.canSearch;
		searchButtonEl.ariaLabel = options.searchButtonAriaLabel;
		searchButtonEl.addEventListener('click', () => {
			options.onApply();
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

			if (options.anchorEl.contains(target)) {
				return;
			}

			this.close();
			options.onClose();
		};
		this.doc.addEventListener(
			'mousedown',
			this.outsideMouseDownHandler,
			true,
		);

		this.keyDownHandler = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') {
				return;
			}

			this.close();
			options.onClose();
		};
		this.doc.addEventListener('keydown', this.keyDownHandler, true);

		if (options.shouldFocus) {
			if (typeof window !== 'undefined' && window.requestAnimationFrame) {
				window.requestAnimationFrame(() => {
					inputEl.focus();
					inputEl.select();
				});
			} else {
				inputEl.focus();
				inputEl.select();
			}
		}
	}

	close(): void {
		if (this.outsideMouseDownHandler) {
			this.doc.removeEventListener(
				'mousedown',
				this.outsideMouseDownHandler,
				true,
			);
			this.outsideMouseDownHandler = null;
		}
		if (this.keyDownHandler) {
			this.doc.removeEventListener('keydown', this.keyDownHandler, true);
			this.keyDownHandler = null;
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
		const gap = 8;
		let left = anchorRect.right - popoverRect.width;
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
