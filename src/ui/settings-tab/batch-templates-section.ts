import { App, Setting, setIcon } from 'obsidian';
import { t } from '../../lang/helpter';
import type { BatchTaskTemplate } from '../../tasks-center/batch-task-template';
import { createBatchTemplateId } from '../../tasks-center/batch-task-template';
import { BatchTemplateEditModal } from '../batchTemplateEditModal';
import type { TemplateEditMode } from '../entryTemplateEditModal';
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
			cls: 'ioto-tasks-center__icon-button',
		});
		editButtonEl.type = 'button';
		editButtonEl.ariaLabel = t('settings.batchTemplates.edit');
		editButtonEl.title = t('settings.batchTemplates.edit');
		setIcon(editButtonEl, 'pencil');
		editButtonEl.addEventListener('click', () => {
			void openBatchTemplateEditor(containerEl, app, plugin, template);
		});

		const duplicateButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-tasks-center__icon-button',
		});
		duplicateButtonEl.type = 'button';
		duplicateButtonEl.ariaLabel = t('settings.batchTemplates.duplicate');
		duplicateButtonEl.title = t('settings.batchTemplates.duplicate');
		setIcon(duplicateButtonEl, 'copy');
		duplicateButtonEl.addEventListener('click', () => {
			void openBatchTemplateEditor(
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
		deleteButtonEl.ariaLabel = t('settings.batchTemplates.delete');
		deleteButtonEl.title = t('settings.batchTemplates.delete');
		setIcon(deleteButtonEl, 'trash-2');
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
					id: createBatchTemplateId(),
					name:
						existing.name + t('settings.batchTemplates.duplicateSuffix'),
				}
			: existing;

	const result = await new BatchTemplateEditModal(
		app,
		seed,
		availableProjects,
		mode,
	).openAndGetValue();
	if (!result) {
		return;
	}

	// 按 id 查找，使「新建 / 编辑 / 复制」三条路径合一，不依赖 existing 的语义
	const config = plugin.settings.batchTemplateConfig;
	const index = config.templates.findIndex(
		(template) => template.id === result.id,
	);
	const nextTemplates =
		index >= 0
			? config.templates.map((template, i) => (i === index ? result : template))
			: [...config.templates, result];

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
