import {
	ButtonComponent,
	Modal,
	Setting,
	TextComponent,
} from 'obsidian';
import { t } from '../lang/helpter';
import {
	TASK_PRIORITY_VALUES,
	type TaskPriorityValue,
} from '../tasks-center/task-priority';

interface TaskCreationModalOptions {
	descriptionText?: string;
	confirmButtonText?: string;
	includeNameInput?: boolean;
}

export interface TaskCreationModalResult {
	name: string | null;
	priority: TaskPriorityValue | null;
	starred: boolean;
}

export class TaskCreationModal extends Modal {
	private readonly titleText: string;
	private readonly placeholder: string;
	private readonly descriptionText: string;
	private readonly confirmButtonText: string;
	private readonly includeNameInput: boolean;
	private nameInput: TextComponent | null = null;
	private priority: TaskPriorityValue | null = null;
	private starred = false;
	private resolvePromise:
		| ((value: TaskCreationModalResult | null) => void)
		| null = null;
	private isResolved = false;

	constructor(
		app: Modal['app'],
		titleText: string,
		placeholder: string,
		options: TaskCreationModalOptions = {},
	) {
		super(app);
		this.titleText = titleText;
		this.placeholder = placeholder;
		this.descriptionText =
			options.descriptionText ?? t('modal.defaultDescription');
		this.confirmButtonText = options.confirmButtonText ?? t('modal.confirm');
		this.includeNameInput = options.includeNameInput ?? true;
	}

	openAndGetValue(): Promise<TaskCreationModalResult | null> {
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

		if (this.includeNameInput) {
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
		}

		new Setting(this.contentEl)
			.setName(t('menu.category.priority'))
			.addDropdown((dropdown) => {
				dropdown.addOption('', t('modal.taskSettings.priority.none'));
				for (const priority of TASK_PRIORITY_VALUES) {
					dropdown.addOption(`${priority}`, `P${priority}`);
				}
				dropdown.setValue('');
				dropdown.onChange((value) => {
					this.priority =
						value.trim().length > 0
							? (Number(value) as TaskPriorityValue)
							: null;
				});
			});

		new Setting(this.contentEl)
			.setName(t('view.taskCoreBadge.label'))
			.addToggle((toggle) =>
				toggle.setValue(false).onChange((value) => {
					this.starred = value;
				}),
			);

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
		this.contentEl.empty();
		this.resolve(null);
	}

	private confirm(): void {
		const nameValue = this.includeNameInput
			? this.nameInput?.getValue().trim() ?? ''
			: '';
		if (this.includeNameInput && nameValue.length === 0) {
			this.resolve(null);
			this.close();
			return;
		}

		this.resolve({
			name: this.includeNameInput ? nameValue : null,
			priority: this.priority,
			starred: this.starred,
		});
		this.close();
	}

	private resolve(value: TaskCreationModalResult | null): void {
		if (this.isResolved) {
			return;
		}

		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}
