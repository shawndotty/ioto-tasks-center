import { ButtonComponent, Modal, Setting, TextComponent } from 'obsidian';
import { t } from '../lang/helpter';
import {
	formatBatchItemsForPreview,
	formatLevelTaskTypes,
	isTemplateAvailableForProject,
	type BatchTaskItem,
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

/**
 * 选择一个批量模板。返回 null 表示用户取消。
 */
export class BatchTemplateSelectModal extends Modal {
	private readonly filteredTemplates: BatchTaskTemplate[];
	private resolvePromise: ((value: BatchTaskTemplate | null) => void) | null =
		null;
	private isResolved = false;

	constructor(
		app: Modal['app'],
		templates: BatchTaskTemplate[],
		currentProject: string,
	) {
		super(app);
		this.filteredTemplates = templates.filter((template) =>
			isTemplateAvailableForProject(template, currentProject),
		);
	}

	openAndGetValue(): Promise<BatchTaskTemplate | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(t('modal.batchSelect.title'));

		const descriptionEl = this.contentEl.createEl('p', {
			text: t('modal.batchSelect.desc'),
		});
		descriptionEl.addClass('ioto-tasks-center__modal-desc');

		if (this.filteredTemplates.length === 0) {
			const emptyEl = this.contentEl.createEl('p', {
				text: t('modal.batchSelect.empty'),
			});
			emptyEl.addClass('ioto-tasks-center__modal-hint');
			return;
		}

		const listEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__batch-template-list',
		});

		for (const template of this.filteredTemplates) {
			const rowEl = listEl.createDiv({
				cls: 'ioto-tasks-center__batch-template-option',
			});
			rowEl.createSpan({
				cls: 'ioto-tasks-center__batch-template-option-name',
				text: template.name,
			});
			rowEl.createSpan({
				cls: 'ioto-tasks-center__batch-template-option-type',
				text: formatLevelTaskTypes(
					template.levelTaskTypes,
					getBatchTaskTypeLabel,
				),
			});
			rowEl.addEventListener('click', () => {
				this.resolve(template);
				this.close();
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(null);
	}

	private resolve(value: BatchTaskTemplate | null): void {
		if (this.isResolved) {
			return;
		}
		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}

export interface BatchNameAffix {
	prefix: string;
	suffix: string;
}

/**
 * 输入批量任务名称前缀与后缀（均可选）。返回 null 表示取消。
 */
export class BatchNameAffixModal extends Modal {
	private prefixInput: TextComponent | null = null;
	private suffixInput: TextComponent | null = null;
	private resolvePromise: ((value: BatchNameAffix | null) => void) | null =
		null;
	private isResolved = false;

	constructor(app: Modal['app']) {
		super(app);
	}

	openAndGetValue(): Promise<BatchNameAffix | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(t('modal.batchNameAffix.title'));

		const descriptionEl = this.contentEl.createEl('p', {
			text: t('modal.batchNameAffix.desc'),
		});
		descriptionEl.addClass('ioto-tasks-center__modal-desc');

		new Setting(this.contentEl)
			.setName(t('modal.batchNameAffix.prefix'))
			.setDesc(t('modal.batchNameAffix.prefixDesc'))
			.addText((text: TextComponent) => {
				this.prefixInput = text;
				text.setPlaceholder(
					t('modal.batchNameAffix.prefixPlaceholder'),
				);
				text.inputEl.addClass('ioto-tasks-center__modal-input');
			});

		new Setting(this.contentEl)
			.setName(t('modal.batchNameAffix.suffix'))
			.setDesc(t('modal.batchNameAffix.suffixDesc'))
			.addText((text: TextComponent) => {
				this.suffixInput = text;
				text.setPlaceholder(
					t('modal.batchNameAffix.suffixPlaceholder'),
				);
				text.inputEl.addClass('ioto-tasks-center__modal-input');
			});

		this.prefixInput?.inputEl.focus();

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.confirm();
			}
		};
		this.prefixInput?.inputEl.addEventListener('keydown', handleKeyDown);
		this.suffixInput?.inputEl.addEventListener('keydown', handleKeyDown);

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
		const prefix = this.prefixInput?.getValue() ?? '';
		const suffix = this.suffixInput?.getValue() ?? '';
		this.resolve({ prefix, suffix });
		this.close();
	}

	private resolve(value: BatchNameAffix | null): void {
		if (this.isResolved) {
			return;
		}
		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}

export interface BatchCreateConfirmModalOptions {
	templateName: string;
	prefix: string;
	suffix: string;
	projectName: string;
	items: BatchTaskItem[];
	levelTaskTypes: BatchTaskType[];
}

/**
 * 确认弹窗：展示即将创建的任务预览，返回是否确认。
 */
export class BatchCreateConfirmModal extends Modal {
	private readonly options: BatchCreateConfirmModalOptions;
	private resolvePromise: ((value: boolean) => void) | null = null;
	private isResolved = false;

	constructor(app: Modal['app'], options: BatchCreateConfirmModalOptions) {
		super(app);
		this.options = options;
	}

	openAndConfirm(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(t('modal.batchConfirm.title'));

		const { templateName, prefix, suffix, projectName, items } =
			this.options;
		const summary = t('modal.batchConfirm.summary', [
			templateName,
			prefix.length > 0 ? prefix : '-',
			suffix.length > 0 ? suffix : '-',
			projectName,
		]);
		const summaryEl = this.contentEl.createEl('p', {
			text: summary,
		});
		summaryEl.addClass('ioto-tasks-center__modal-desc');

		const countEl = this.contentEl.createEl('p', {
			text: t('modal.batchConfirm.count', [String(items.length)]),
		});
		countEl.addClass('ioto-tasks-center__modal-hint');

		const previewEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__batch-preview',
		});
		const previewEntries = formatBatchItemsForPreview(
			items,
			prefix,
			suffix,
			this.options.levelTaskTypes,
		);
		for (const entry of previewEntries) {
			const lineEl = previewEl.createDiv({
				cls: 'ioto-tasks-center__batch-preview-line',
			});
			lineEl.style.paddingLeft = `${entry.indent * 1.2}em`;
			lineEl.createSpan({ text: `• ${entry.text}` });
			lineEl.createSpan({
				cls: 'ioto-tasks-center__batch-preview-type',
				text: getBatchTaskTypeLabel(entry.taskType),
			});
		}

		const actionsEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__modal-actions',
		});

		new ButtonComponent(actionsEl)
			.setButtonText(t('modal.cancel'))
			.onClick(() => this.close());

		new ButtonComponent(actionsEl)
			.setButtonText(t('modal.batchConfirm.confirm'))
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
