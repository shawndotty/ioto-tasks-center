import {
	ButtonComponent,
	Modal,
	Notice,
	Setting,
	TextComponent,
	TextAreaComponent,
} from 'obsidian';
import { t } from '../lang/helpter';
import {
	createEntryTemplateId,
	isEntryTemplateValid,
	type TaskEntryTemplate,
} from '../tasks-center/task-entry-template';

/**
 * 新增 / 编辑一条「条目模板」。
 * 字段：名称 / 说明（可选）/ 项目范围（多行文本，空 = 所有项目）/ 模板正文（多行）。
 */
export class EntryTemplateEditModal extends Modal {
	private readonly existing: TaskEntryTemplate | null;
	private readonly availableProjects: string[];
	private name = '';
	private description = '';
	private projects: string[] = [];
	private content = '';
	private resolvePromise: ((value: TaskEntryTemplate | null) => void) | null =
		null;
	private isResolved = false;

	constructor(
		app: Modal['app'],
		existing: TaskEntryTemplate | null,
		availableProjects: string[] = [],
	) {
		super(app);
		this.existing = existing;
		this.availableProjects = availableProjects;
		this.name = existing?.name ?? '';
		this.description = existing?.description ?? '';
		this.projects = existing ? [...existing.projects] : [];
		this.content = existing?.content ?? '';
	}

	openAndGetValue(): Promise<TaskEntryTemplate | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const isNew = this.existing === null;
		this.setTitle(
			isNew
				? t('settings.entryTemplates.editModal.title.new')
				: t('settings.entryTemplates.editModal.title.edit'),
		);

		new Setting(this.contentEl)
			.setName(t('settings.entryTemplates.editModal.name'))
			.addText((text: TextComponent) => {
				text.setValue(this.name);
				text.onChange((value) => {
					this.name = value;
				});
			});

		new Setting(this.contentEl)
			.setName(t('settings.entryTemplates.editModal.description'))
			.addText((text: TextComponent) => {
				text.setValue(this.description);
				text.onChange((value) => {
					this.description = value;
				});
			});

		new Setting(this.contentEl)
			.setName(t('settings.entryTemplates.editModal.projects'))
			.setDesc(t('settings.entryTemplates.editModal.projectsDesc'))
			.addTextArea((textArea: TextAreaComponent) => {
				textArea.setValue(this.projects.join('\n'));
				textArea.setPlaceholder(
					this.availableProjects.length > 0
						? this.availableProjects.slice(0, 3).join('\n')
						: t(
								'settings.entryTemplates.editModal.projectsPlaceholder',
							),
				);
				textArea.inputEl.rows = 3;
				textArea.onChange((value) => {
					this.projects = value
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line.length > 0);
				});
			});

		const contentSetting = new Setting(this.contentEl)
			.setName(t('settings.entryTemplates.editModal.content'))
			.setDesc(t('settings.entryTemplates.editModal.contentHint'))
			.setClass('ioto-tasks-center__batch-template-content-setting');
		contentSetting.addTextArea((textArea: TextAreaComponent) => {
			textArea.setValue(this.content);
			textArea.setPlaceholder(
				t('settings.entryTemplates.editModal.contentPlaceholder'),
			);
			textArea.onChange((value) => {
				this.content = value;
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
		const candidate: TaskEntryTemplate = {
			id: this.existing?.id ?? createEntryTemplateId(),
			name: this.name.trim(),
			content: this.content,
			projects: this.projects,
		};
		const description = this.description.trim();
		if (description.length > 0) {
			candidate.description = description;
		}

		if (!isEntryTemplateValid(candidate)) {
			new Notice(t('settings.entryTemplates.editModal.invalid'));
			return;
		}

		this.resolve(candidate);
		this.close();
	}

	private resolve(value: TaskEntryTemplate | null): void {
		if (this.isResolved) {
			return;
		}
		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}
