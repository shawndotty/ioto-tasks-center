import { ButtonComponent, Modal } from 'obsidian';

export interface ConfirmModalOptions {
	descriptionText: string;
	confirmButtonText: string;
	cancelButtonText: string;
}

export class ConfirmModal extends Modal {
	private readonly titleText: string;
	private readonly descriptionText: string;
	private readonly confirmButtonText: string;
	private readonly cancelButtonText: string;
	private resolvePromise: ((value: boolean) => void) | null = null;
	private isResolved = false;

	constructor(
		app: Modal['app'],
		titleText: string,
		options: ConfirmModalOptions,
	) {
		super(app);
		this.titleText = titleText;
		this.descriptionText = options.descriptionText;
		this.confirmButtonText = options.confirmButtonText;
		this.cancelButtonText = options.cancelButtonText;
	}

	openAndConfirm(): Promise<boolean> {
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

		const actionsEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__modal-actions',
		});

		new ButtonComponent(actionsEl)
			.setButtonText(this.cancelButtonText)
			.onClick(() => this.close());

		new ButtonComponent(actionsEl)
			.setButtonText(this.confirmButtonText)
			.setCta()
			.onClick(() => this.confirm());
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(false);
	}

	private confirm(): void {
		this.resolve(true);
		this.close();
	}

	private resolve(value: boolean): void {
		if (this.isResolved) {
			return;
		}

		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}
