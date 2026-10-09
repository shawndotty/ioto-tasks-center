import { App, Setting } from 'obsidian';
import { t } from '../../lang/helpter';
import type { TaskEntryTemplate } from '../../tasks-center/task-entry-template';
import { EntryTemplateEditModal } from '../entryTemplateEditModal';
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
			text: t('settings.entryTemplates.edit'),
		});
		editButtonEl.type = 'button';
		editButtonEl.addEventListener('click', () => {
			void openEntryTemplateEditor(containerEl, app, plugin, template);
		});

		const deleteButtonEl = actionsEl.createEl('button', {
			text: t('settings.entryTemplates.delete'),
		});
		deleteButtonEl.type = 'button';
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
): Promise<void> {
	const availableProjects = resolveAvailableProjectNames(
		app,
		plugin.settings.tasksRootPath,
	);
	const result = await new EntryTemplateEditModal(
		app,
		existing,
		availableProjects,
	).openAndGetValue();
	if (!result) {
		return;
	}

	const config = plugin.settings.entryTemplateConfig;
	const nextTemplates =
		existing === null
			? [...config.templates, result]
			: config.templates.map((template) =>
					template.id === existing.id ? result : template,
				);

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
