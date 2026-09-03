import { Modal } from 'obsidian';

export interface TaskSearchModalOptions {
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
	onClosed: () => void;
}

export class TaskSearchModal extends Modal {
	private options: TaskSearchModalOptions | null = null;

	openSearch(options: TaskSearchModalOptions): void {
		this.options = options;
		this.open();
	}

	onOpen(): void {
		const options = this.options;
		if (!options) {
			this.close();
			return;
		}

		this.containerEl.addClass('ioto-tasks-center__task-search-modal-container');
		this.modalEl.addClass('ioto-tasks-center__task-search-modal');
		this.modalEl.querySelector('.modal-close-button')?.remove();
		this.contentEl.empty();

		const controlsEl = this.contentEl.createDiv({
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

		const clearButtonEl = inputWrapperEl.createEl('button', {
			cls: 'ioto-tasks-center__task-search-clear-button',
			text: 'X',
		});
		clearButtonEl.type = 'button';
		clearButtonEl.disabled = !options.canSearch;
		clearButtonEl.ariaLabel = options.clearButtonAriaLabel;
		clearButtonEl.title = options.clearButtonTitle;
		clearButtonEl.toggleClass('is-hidden', !options.showClear);

		const syncClearVisibility = () => {
			clearButtonEl.toggleClass('is-hidden', !inputEl.value);
		};

		inputEl.addEventListener('input', () => {
			options.onChange(inputEl.value);
			syncClearVisibility();
		});
		inputEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') {
				return;
			}

			event.preventDefault();
			options.onApply();
		});

		clearButtonEl.addEventListener('click', () => {
			inputEl.value = '';
			syncClearVisibility();
			inputEl.focus();
			options.onClear();
		});

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

		const focusInput = () => {
			inputEl.focus();
			inputEl.select();
		};
		if (typeof window !== 'undefined' && window.requestAnimationFrame) {
			window.requestAnimationFrame(focusInput);
		} else {
			focusInput();
		}
	}

	onClose(): void {
		this.contentEl.empty();
		const options = this.options;
		this.options = null;
		options?.onClosed();
	}
}
