import { App, Setting } from 'obsidian';
import { t } from '../../lang/helpter';
import type { BatchTaskTemplate } from '../../tasks-center/batch-task-template';
import { BatchTemplateEditModal } from '../batchTemplateEditModal';
import { ConfirmModal } from '../confirmModal';
import type IOTOTasksCenter from '../../main';
import { resolveAvailableProjectNames } from './helpers';

/** 「批量模板」标签页：开关 + 模板列表 + 新增 / 编辑 / 删除。 */
export function renderBatchTemplateSection(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
): void {
	renderBatchTemplateSettings(containerEl, app, plugin);
}

function renderBatchTemplateSettings(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
): void {
	containerEl.empty();

	const config = plugin.settings.batchTemplateConfig;

	new Setting(containerEl)
		.setName(t('settings.batchTemplates.enabled.name'))
		.setDesc(t('settings.batchTemplates.enabled.desc'))
		.addToggle((toggle) =>
			toggle.setValue(config.enabled).onChange(async (value) => {
				await plugin.updateBatchTemplateConfig({
					enabled: value,
					templates: config.templates,
				});
				renderBatchTemplateSettings(containerEl, app, plugin);
			}),
		);

	new Setting(containerEl)
		.setName(t('settings.batchTemplates.heading'))
		.setHeading()
		.addButton((button) =>
			button
				.setButtonText(t('settings.batchTemplates.add'))
				.setClass('ioto-tasks-center__batch-template-add')
				.onClick(() => {
					void openBatchTemplateEditor(containerEl, app, plugin, null);
				}),
		);

	if (config.templates.length === 0) {
		containerEl.createEl('p', {
			text: t('settings.batchTemplates.empty'),
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
			text: t('settings.batchTemplates.edit'),
		});
		editButtonEl.type = 'button';
		editButtonEl.addEventListener('click', () => {
			void openBatchTemplateEditor(containerEl, app, plugin, template);
		});

		const deleteButtonEl = actionsEl.createEl('button', {
			text: t('settings.batchTemplates.delete'),
		});
		deleteButtonEl.type = 'button';
		deleteButtonEl.addEventListener('click', () => {
			void confirmDeleteBatchTemplate(containerEl, app, plugin, template);
		});
	}
}

async function openBatchTemplateEditor(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
	existing: BatchTaskTemplate | null,
): Promise<void> {
	const availableProjects = resolveAvailableProjectNames(
		app,
		plugin.settings.tasksRootPath,
	);
	const result = await new BatchTemplateEditModal(
		app,
		existing,
		availableProjects,
	).openAndGetValue();
	if (!result) {
		return;
	}

	const config = plugin.settings.batchTemplateConfig;
	const nextTemplates =
		existing === null
			? [...config.templates, result]
			: config.templates.map((template) =>
					template.id === existing.id ? result : template,
				);

	await plugin.updateBatchTemplateConfig({
		enabled: config.enabled,
		templates: nextTemplates,
	});
	renderBatchTemplateSettings(containerEl, app, plugin);
}

async function confirmDeleteBatchTemplate(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
	template: BatchTaskTemplate,
): Promise<void> {
	const confirmed = await new ConfirmModal(
		app,
		t('settings.batchTemplates.deleteConfirm.title'),
		{
			descriptionText: t('settings.batchTemplates.deleteConfirm.desc', [
				template.name,
			]),
			confirmButtonText: t('settings.batchTemplates.deleteConfirm.confirm'),
			cancelButtonText: t('modal.cancel'),
		},
	).openAndConfirm();
	if (!confirmed) {
		return;
	}

	const config = plugin.settings.batchTemplateConfig;
	const nextTemplates = config.templates.filter(
		(entry) => entry.id !== template.id,
	);
	await plugin.updateBatchTemplateConfig({
		enabled: config.enabled,
		templates: nextTemplates,
	});
	renderBatchTemplateSettings(containerEl, app, plugin);
}
