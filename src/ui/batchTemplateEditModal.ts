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
	DEFAULT_LEVEL_TASK_TYPES,
	MAX_LEVEL_TASK_TYPES,
	createBatchTemplateId,
	isBatchTemplateValid,
	normalizeBatchTemplate,
	parseBatchList,
	resolveMaxLevel,
	type BatchTaskTemplate,
	type BatchTaskType,
} from '../tasks-center/batch-task-template';
import type { ListMarker } from '../tasks-center/list-edit-ops';
import type { TemplateEditMode } from './entryTemplateEditModal';
import { bindListMarkdownEditing } from './list-edit-textarea';
import {
	focusTextAreaAtEnd,
	resolveCreateSeedContent,
} from './template-create-seed';

/** 内容区的列表标记：编辑接管与新建预填共用，避免两处各写一份。 */
const CONTENT_MARKER: ListMarker = '- ';

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
	private readonly availableProjects: string[];
	private readonly mode: TemplateEditMode;
	private name = '';
	private levelTaskTypes: BatchTaskType[] = [...DEFAULT_LEVEL_TASK_TYPES];
	private listContent = '';
	private projects: string[] = [];
	private levelTypesContainerEl: HTMLElement | null = null;
	private lastDisplayLevelCount = -1;
	private resolvePromise: ((value: BatchTaskTemplate | null) => void) | null =
		null;
	private isResolved = false;

	constructor(
		app: Modal['app'],
		existing: BatchTaskTemplate | null,
		availableProjects: string[] = [],
		mode: TemplateEditMode = existing === null ? 'create' : 'edit',
	) {
		super(app);
		this.existing = existing;
		this.availableProjects = availableProjects;
		this.mode = mode;
		this.name = existing?.name ?? '';
		this.levelTaskTypes = existing
			? (normalizeBatchTemplate(existing)?.levelTaskTypes ?? [
					...DEFAULT_LEVEL_TASK_TYPES,
				])
			: [...DEFAULT_LEVEL_TASK_TYPES];
		this.listContent = existing?.listContent ?? '';
		this.projects = existing?.projects ?? [];
	}

	openAndGetValue(): Promise<BatchTaskTemplate | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const titleKey =
			this.mode === 'duplicate'
				? 'settings.batchTemplates.editModal.title.duplicate'
				: this.mode === 'create'
					? 'settings.batchTemplates.editModal.title.new'
					: 'settings.batchTemplates.editModal.title.edit';
		this.setTitle(t(titleKey));

		new Setting(this.contentEl)
			.setName(t('settings.batchTemplates.editModal.name'))
			.addText((text: TextComponent) => {
				text.setValue(this.name);
				text.onChange((value) => {
					this.name = value;
				});
			});

		new Setting(this.contentEl)
			.setName(t('settings.batchTemplates.editModal.projects'))
			.setDesc(t('settings.batchTemplates.editModal.projectsDesc'))
			.setClass('ioto-tasks-center__batch-template-projects-setting')
			.addTextArea((textArea: TextAreaComponent) => {
				textArea.setValue(this.projects.join('\n'));
				textArea.setPlaceholder(
					this.availableProjects.length > 0
						? this.availableProjects.slice(0, 3).join('\n')
						: t(
								'settings.batchTemplates.editModal.projectsPlaceholder',
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

		this.levelTypesContainerEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__batch-level-types',
		});
		this.renderLevelTypeSettings();

		const contentSetting = new Setting(this.contentEl)
			.setName(t('settings.batchTemplates.editModal.content'))
			.setDesc(t('settings.batchTemplates.editModal.contentHint'))
			.setClass('ioto-tasks-center__batch-template-content-setting');
		contentSetting.addTextArea((textArea: TextAreaComponent) => {
			textArea.setValue(this.listContent);
			textArea.setPlaceholder(
				t('settings.batchTemplates.editModal.contentPlaceholder'),
			);
			bindListMarkdownEditing(textArea.inputEl, CONTENT_MARKER);
			const seed = resolveCreateSeedContent(
				this.mode,
				this.listContent,
				CONTENT_MARKER,
			);
			if (seed !== null) {
				// `setValue` 不保证触发 onChange，状态必须自己同步，
				// 否则「确认」时校验读到的是空内容
				this.listContent = seed;
				textArea.setValue(seed);
				focusTextAreaAtEnd(textArea.inputEl, seed.length);
			}
			textArea.onChange((value) => {
				this.listContent = value;
				this.renderLevelTypeSettings();
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

	private renderLevelTypeSettings(): void {
		const containerEl = this.levelTypesContainerEl;
		if (!containerEl) {
			return;
		}

		const items = parseBatchList(this.listContent);
		const maxLevel = resolveMaxLevel(items);
		const displayLevelCount = Math.min(
			Math.max(maxLevel + 1, 1),
			MAX_LEVEL_TASK_TYPES,
		);

		// 逐键重建会把下拉销毁重建（编辑时下拉被打断、焦点丢失），
		// 只有「层级数量」变化才需要重排；取值仍以 levelTaskTypes 为准。
		if (displayLevelCount === this.lastDisplayLevelCount) {
			return;
		}
		this.lastDisplayLevelCount = displayLevelCount;
		containerEl.empty();

		// 确保数组长度足够
		while (this.levelTaskTypes.length < displayLevelCount) {
			this.levelTaskTypes.push('normal');
		}

		for (let level = 0; level < displayLevelCount; level += 1) {
			const levelNumber = level + 1;
			new Setting(containerEl)
				.setName(
					t('settings.batchTemplates.editModal.levelTaskType', [
						String(levelNumber),
					]),
				)
				.addDropdown((dropdown: DropdownComponent) => {
					for (const taskType of BATCH_TASK_TYPES) {
						dropdown.addOption(
							taskType,
							getBatchTaskTypeLabel(taskType),
						);
					}
					dropdown.setValue(this.levelTaskTypes[level] ?? 'normal');
					dropdown.onChange((value) => {
						if (
							value === 'normal' ||
							value === 'topic' ||
							value === 'plan'
						) {
							this.levelTaskTypes[level] = value;
						}
					});
				});
		}

		if (displayLevelCount >= MAX_LEVEL_TASK_TYPES) {
			containerEl.createEl('p', {
				text: t(
					'settings.batchTemplates.editModal.levelTaskTypeOverflow',
				),
				cls: 'ioto-tasks-center__settings-hint',
			});
		}
	}

	private confirm(): void {
		const candidate: BatchTaskTemplate = {
			id: this.existing?.id ?? createBatchTemplateId(),
			name: this.name.trim(),
			levelTaskTypes: this.levelTaskTypes.slice(0, MAX_LEVEL_TASK_TYPES),
			listContent: this.listContent,
			projects: this.projects,
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
