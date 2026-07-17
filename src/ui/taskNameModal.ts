import { ButtonComponent, Modal, TextComponent } from 'obsidian';
import { t } from '../lang/helpter';

interface TaskNameModalOptions {
	descriptionText?: string;
	confirmButtonText?: string;
	suggestions?: string[];
}

const SUGGESTION_LIMIT = 8;

export class TaskNameModal extends Modal {
	private readonly titleText: string;
	private readonly placeholder: string;
	private readonly descriptionText: string;
	private readonly confirmButtonText: string;
	private readonly suggestions: string[];
	private nameInput: TextComponent | null = null;
	private suggestionListEl: HTMLDivElement | null = null;
	private resolvePromise: ((value: string | null) => void) | null = null;
	private isResolved = false;

	constructor(
		app: Modal['app'],
		titleText: string,
		placeholder: string,
		options: TaskNameModalOptions = {},
	) {
		super(app);
		this.titleText = titleText;
		this.placeholder = placeholder;
		this.descriptionText =
			options.descriptionText ?? t('modal.defaultDescription');
		this.confirmButtonText = options.confirmButtonText ?? t('modal.confirm');
		this.suggestions = options.suggestions ?? [];
	}

	openAndGetValue(): Promise<string | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(this.titleText);

		const descriptionEl = this.contentEl.createEl('p', {
			text: this.descriptionText,
		});
		descriptionEl.addClass('ioto-tasks-center__modal-desc');

		this.nameInput = new TextComponent(this.contentEl);
		this.nameInput.setPlaceholder(this.placeholder);
		this.nameInput.inputEl.addClass('ioto-tasks-center__modal-input');
		this.nameInput.inputEl.focus();
		this.nameInput.inputEl.addEventListener('keydown', (event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.confirm();
			}
		});

		if (this.suggestions.length > 0) {
			this.suggestionListEl = this.contentEl.createDiv({
				cls: 'ioto-tasks-center__suggest-list',
			});
			this.nameInput.inputEl.addEventListener('input', () => {
				this.renderSuggestions(this.nameInput!.inputEl.value);
			});
			this.renderSuggestions('');
		}

		const actionsEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__modal-actions',
		});

		new ButtonComponent(actionsEl)
			.setButtonText(t('modal.cancel'))
			.onClick(() => this.close());

		new ButtonComponent(actionsEl)
			.setButtonText(this.confirmButtonText)
			.setCta()
			.onClick(() => this.confirm());
	}

	onClose(): void {
		this.suggestionListEl = null;
		this.contentEl.empty();
		this.resolve(null);
	}

	private renderSuggestions(query: string): void {
		if (!this.suggestionListEl) {
			return;
		}
		this.suggestionListEl.empty();

		const normalizedQuery = query.trim().toLowerCase();
		let matches: string[];
		if (!normalizedQuery) {
			matches = this.suggestions.slice(0, SUGGESTION_LIMIT);
		} else {
			matches = this.suggestions
				.filter((s) => s.toLowerCase().includes(normalizedQuery))
				.slice(0, SUGGESTION_LIMIT);
		}

		if (matches.length === 0) {
			this.suggestionListEl.addClass('is-hidden');
			return;
		}
		this.suggestionListEl.removeClass('is-hidden');

		for (const title of matches) {
			const itemEl = this.suggestionListEl.createDiv({
				cls: 'ioto-tasks-center__suggest-item',
				text: title,
			});
			itemEl.addEventListener('click', () => {
				if (this.nameInput) {
					this.nameInput.setValue(title);
					this.nameInput.inputEl.focus();
				}
			});
		}
	}

	private confirm(): void {
		const value = this.nameInput?.getValue().trim() ?? '';
		this.resolve(value.length > 0 ? value : null);
		this.close();
	}

	private resolve(value: string | null): void {
		if (this.isResolved) {
			return;
		}

		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}
