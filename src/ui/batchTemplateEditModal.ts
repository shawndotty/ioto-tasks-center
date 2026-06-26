import {
	ButtonComponent,
	DropdownComponent,
	Modal,
	Notice,
	Setting,
	TextComponent,
	TextAreaComponent,
} from 'obsidian';
import { t } from '../lang/helpter';
import {
	BATCH_TASK_TYPES,
	createBatchTemplateId,
	isBatchTemplateValid,
	type BatchTaskTemplate,
	type BatchTaskType,
} from '../tasks-center/batch-task-template';

function getBatchTaskTypeLabel(taskType: BatchTaskType): string {
	switch (taskType) {
		case 'normal':
			return t('task.type.normal');
		case 'topic':
			return t('task.type.topic');
		case 'plan':
			return t('task.type.plan');
		default:
			return taskType;
	}
}

export class BatchTemplateEditModal extends Modal {
	private readonly existing: BatchTaskTemplate | null;
	private name = '';
	private taskType: BatchTaskType = 'normal';
	private listContent = '';
	private resolvePromise:
		| ((value: BatchTaskTemplate | null) => void)
		| null = null;
	private isResolved = false;

	constructor(app: Modal['app'], existing: BatchTaskTemplate | null) {
		super(app);
		this.existing = existing;
		this.name = existing?.name ?? '';
		this.taskType = existing?.taskType ?? 'normal';
		this.listContent = existing?.listContent ?? '';
	}

	openAndGetValue(): Promise<BatchTaskTemplate | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const isNew = this.existing === null;
		this.setTitle(
			isNew
				? t('settings.batchTemplates.editModal.title.new')
				: t('settings.batchTemplates.editModal.title.edit'),
		);

		new Setting(this.contentEl)
			.setName(t('settings.batchTemplates.editModal.name'))
			.addText((text: TextComponent) => {
				text.setValue(this.name);
				text.onChange((value) => {
					this.name = value;
				});
			});

		new Setting(this.contentEl)
			.setName(t('settings.batchTemplates.editModal.taskType'))
			.addDropdown((dropdown: DropdownComponent) => {
				for (const taskType of BATCH_TASK_TYPES) {
					dropdown.addOption(taskType, getBatchTaskTypeLabel(taskType));
				}
				dropdown.setValue(this.taskType);
				dropdown.onChange((value) => {
					if (
						value === 'normal' ||
						value === 'topic' ||
						value === 'plan'
					) {
						this.taskType = value;
					}
				});
			});

		const contentSetting = new Setting(this.contentEl).setName(
			t('settings.batchTemplates.editModal.content'),
		);
		contentSetting.addTextArea((textArea: TextAreaComponent) => {
			textArea.setValue(this.listContent);
			textArea.setPlaceholder(
				t('settings.batchTemplates.editModal.contentPlaceholder'),
			);
			textArea.onChange((value) => {
				this.listContent = value;
			});
		});

		const actionsEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__modal-actions',
		});

		new ButtonComponent(actionsEl)
			.setButtonText(t('modal.cancel'))
			.onClick(() => this.close());

		new ButtonComponent(actionsEl)
			.setButtonText(t('modal.confirm'))
			.setCta()
			.onClick(() => this.confirm());
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(null);
	}

	private confirm(): void {
		const candidate: BatchTaskTemplate = {
			id: this.existing?.id ?? createBatchTemplateId(),
			name: this.name.trim(),
			taskType: this.taskType,
			listContent: this.listContent,
		};

		if (!isBatchTemplateValid(candidate)) {
			new Notice(t('settings.batchTemplates.editModal.invalid'));
			return;
		}

		this.resolve(candidate);
		this.close();
	}

	private resolve(value: BatchTaskTemplate | null): void {
		if (this.isResolved) {
			return;
		}
		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}
