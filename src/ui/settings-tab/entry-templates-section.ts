import { App, Setting, setIcon } from 'obsidian';
import { t } from '../../lang/helpter';
import type { TaskEntryTemplate } from '../../tasks-center/task-entry-template';
import { createEntryTemplateId } from '../../tasks-center/task-entry-template';
import {
	EntryTemplateEditModal,
	type TemplateEditMode,
} from '../entryTemplateEditModal';
import { ConfirmModal } from '../confirmModal';
import type IOTOTasksCenter from '../../main';
import { resolveAvailableProjectNames } from './helpers';

/** 「条目模板」标签页：开关 + 模板列表 + 新增 / 编辑 / 删除。 */
export function renderEntryTemplateSection(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
): void {
	renderEntryTemplateSettings(containerEl, app, plugin);
}

function renderEntryTemplateSettings(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
): void {
	containerEl.empty();

	const config = plugin.settings.entryTemplateConfig;

	new Setting(containerEl)
		.setName(t('settings.entryTemplates.enabled.name'))
		.setDesc(t('settings.entryTemplates.enabled.desc'))
		.addToggle((toggle) =>
			toggle.setValue(config.enabled).onChange(async (value) => {
				await plugin.updateEntryTemplateConfig({
					enabled: value,
					templates: config.templates,
				});
				renderEntryTemplateSettings(containerEl, app, plugin);
			}),
		);

	new Setting(containerEl)
		.setName(t('settings.entryTemplates.heading'))
		.setHeading()
		.addButton((button) =>
			button
				.setButtonText(t('settings.entryTemplates.add'))
				.setClass('ioto-tasks-center__batch-template-add')
				.onClick(() => {
					void openEntryTemplateEditor(containerEl, app, plugin, null);
				}),
		);

	if (config.templates.length === 0) {
		containerEl.createEl('p', {
			text: t('settings.entryTemplates.empty'),
			cls: 'ioto-tasks-center__settings-hint',
		});
	}

	for (const template of config.templates) {
		const rowEl = containerEl.createDiv({
			cls: 'ioto-tasks-center__batch-template-row',
		});
		rowEl.createSpan({
			cls: 'ioto-tasks-center__batch-template-row-name',
			text: template.name,
		});

		const actionsEl = rowEl.createDiv({
			cls: 'ioto-tasks-center__batch-template-row-actions',
		});

		const editButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-tasks-center__icon-button',
		});
		editButtonEl.type = 'button';
		editButtonEl.ariaLabel = t('settings.entryTemplates.edit');
		editButtonEl.title = t('settings.entryTemplates.edit');
		setIcon(editButtonEl, 'pencil');
		editButtonEl.addEventListener('click', () => {
			void openEntryTemplateEditor(containerEl, app, plugin, template);
		});

		const duplicateButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-tasks-center__icon-button',
		});
		duplicateButtonEl.type = 'button';
		duplicateButtonEl.ariaLabel = t('settings.entryTemplates.duplicate');
		duplicateButtonEl.title = t('settings.entryTemplates.duplicate');
		setIcon(duplicateButtonEl, 'copy');
		duplicateButtonEl.addEventListener('click', () => {
			void openEntryTemplateEditor(
				containerEl,
				app,
				plugin,
				template,
				'duplicate',
			);
		});

		const deleteButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-tasks-center__icon-button ioto-tasks-center__icon-button--danger',
		});
		deleteButtonEl.type = 'button';
		deleteButtonEl.ariaLabel = t('settings.entryTemplates.delete');
		deleteButtonEl.title = t('settings.entryTemplates.delete');
		setIcon(deleteButtonEl, 'trash-2');
		deleteButtonEl.addEventListener('click', () => {
			void confirmDeleteEntryTemplate(containerEl, app, plugin, template);
		});
	}
}

async function openEntryTemplateEditor(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
	existing: TaskEntryTemplate | null,
	mode: TemplateEditMode = existing === null ? 'create' : 'edit',
): Promise<void> {
	const availableProjects = resolveAvailableProjectNames(
		app,
		plugin.settings.tasksRootPath,
	);

	// duplicate：预先换上新 id 并把名称补成「原名 + 副本」，弹窗只负责预填与改名
	const seed =
		mode === 'duplicate' && existing
			? {
					...existing,
					id: createEntryTemplateId(),
					name: existing.name + t('settings.entryTemplates.duplicateSuffix'),
				}
			: existing;

	const result = await new EntryTemplateEditModal(
		app,
		seed,
		availableProjects,
		mode,
	).openAndGetValue();
	if (!result) {
		return;
	}

	// 按 id 查找，使「新建 / 编辑 / 复制」三条路径合一，不依赖 existing 的语义
	const config = plugin.settings.entryTemplateConfig;
	const index = config.templates.findIndex(
		(template) => template.id === result.id,
	);
	const nextTemplates =
		index >= 0
			? config.templates.map((template, i) => (i === index ? result : template))
			: [...config.templates, result];

	await plugin.updateEntryTemplateConfig({
		enabled: config.enabled,
		templates: nextTemplates,
	});
	renderEntryTemplateSettings(containerEl, app, plugin);
}

async function confirmDeleteEntryTemplate(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
	template: TaskEntryTemplate,
): Promise<void> {
	const confirmed = await new ConfirmModal(
		app,
		t('settings.entryTemplates.deleteConfirm.title'),
		{
			descriptionText: t('settings.entryTemplates.deleteConfirm.desc', [
				template.name,
			]),
			confirmButtonText: t('settings.entryTemplates.deleteConfirm.confirm'),
			cancelButtonText: t('modal.cancel'),
		},
	).openAndConfirm();
	if (!confirmed) {
		return;
	}

	const config = plugin.settings.entryTemplateConfig;
	const nextTemplates = config.templates.filter(
		(entry) => entry.id !== template.id,
	);
	await plugin.updateEntryTemplateConfig({
		enabled: config.enabled,
		templates: nextTemplates,
	});
	renderEntryTemplateSettings(containerEl, app, plugin);
}
