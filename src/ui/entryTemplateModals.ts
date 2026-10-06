import { ButtonComponent, Modal, Setting, TextComponent } from 'obsidian';
import { t } from '../lang/helpter';
import { isTemplateAvailableForProject } from '../tasks-center/batch-task-template';
import type {
	EntryTemplateVariable,
	TaskEntryTemplate,
} from '../tasks-center/task-entry-template';

/**
 * 选择一条「条目模板」。返回 null 表示用户取消。
 * 只列出「enabled 且项目匹配」的模板（调用方已过滤 enabled）。
 */
export class EntryTemplateSelectModal extends Modal {
	private readonly filteredTemplates: TaskEntryTemplate[];
	private resolvePromise: ((value: TaskEntryTemplate | null) => void) | null =
		null;
	private isResolved = false;

	constructor(
		app: Modal['app'],
		templates: TaskEntryTemplate[],
		currentProject: string,
	) {
		super(app);
		this.filteredTemplates = templates.filter((template) =>
			isTemplateAvailableForProject(template, currentProject),
		);
	}

	openAndGetValue(): Promise<TaskEntryTemplate | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(t('modal.entryTemplateSelect.title'));

		const descriptionEl = this.contentEl.createEl('p', {
			text: t('modal.entryTemplateSelect.desc'),
		});
		descriptionEl.addClass('ioto-tasks-center__modal-desc');

		if (this.filteredTemplates.length === 0) {
			const emptyEl = this.contentEl.createEl('p', {
				text: t('modal.entryTemplateSelect.empty'),
			});
			emptyEl.addClass('ioto-tasks-center__modal-hint');
			return;
		}

		for (const template of this.filteredTemplates) {
			const rowEl = this.contentEl.createDiv({
				cls: 'ioto-tasks-center__batch-template-option',
			});
			rowEl.createSpan({
				cls: 'ioto-tasks-center__batch-template-option-name',
				text: template.name,
			});
			if (template.description) {
				rowEl.createSpan({
					cls: 'ioto-tasks-center__batch-template-option-type',
					text: template.description,
				});
			}
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

	private resolve(value: TaskEntryTemplate | null): void {
		if (this.isResolved) {
			return;
		}
		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}

/**
 * 按顺序收集模板里的「提示变量」值。返回 null 表示取消。
 */
export class EntryTemplateVariablesModal extends Modal {
	private readonly variables: EntryTemplateVariable[];
	private readonly values = new Map<string, string>();
	private readonly inputs: TextComponent[] = [];
	private resolvePromise: ((value: Record<string, string> | null) => void) | null =
		null;
	private isResolved = false;

	constructor(app: Modal['app'], variables: EntryTemplateVariable[]) {
		super(app);
		this.variables = variables;
		for (const variable of variables) {
			this.values.set(variable.name, variable.defaultValue ?? '');
		}
	}

	openAndGetValue(): Promise<Record<string, string> | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(t('modal.entryTemplateVars.title'));

		const descriptionEl = this.contentEl.createEl('p', {
			text: t('modal.entryTemplateVars.desc'),
		});
		descriptionEl.addClass('ioto-tasks-center__modal-desc');

		for (const variable of this.variables) {
			new Setting(this.contentEl).setName(variable.name).addText((text) => {
				this.inputs.push(text);
				text.setValue(this.values.get(variable.name) ?? '');
				text.inputEl.addClass('ioto-tasks-center__modal-input');
				text.onChange((value) => {
					this.values.set(variable.name, value);
				});
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						this.confirm();
					}
				});
			});
		}

		this.inputs[0]?.inputEl.focus();

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
		const result: Record<string, string> = {};
		for (const variable of this.variables) {
			result[variable.name] = this.values.get(variable.name) ?? '';
		}
		this.resolve(result);
		this.close();
	}

	private resolve(value: Record<string, string> | null): void {
		if (this.isResolved) {
			return;
		}
		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}
