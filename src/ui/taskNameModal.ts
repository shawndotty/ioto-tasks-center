import { ButtonComponent, Modal, TextComponent } from 'obsidian';

interface TaskNameModalOptions {
	descriptionText?: string;
	confirmButtonText?: string;
}

export class TaskNameModal extends Modal {
	private readonly titleText: string;
	private readonly placeholder: string;
	private readonly descriptionText: string;
	private readonly confirmButtonText: string;
	private nameInput: TextComponent | null = null;
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
		this.descriptionText = options.descriptionText ?? '请输入名称。';
		this.confirmButtonText = options.confirmButtonText ?? '确认';
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

		const actionsEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__modal-actions',
		});

		new ButtonComponent(actionsEl)
			.setButtonText('取消')
			.onClick(() => this.close());

		new ButtonComponent(actionsEl)
			.setButtonText(this.confirmButtonText)
			.setCta()
			.onClick(() => this.confirm());
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(null);
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
