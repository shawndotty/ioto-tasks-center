import { App, Setting, TFile } from 'obsidian';
import { t } from '../../lang/helpter';
import type { TaskCreationType } from '../../tasks-center/task-template-config';
import { ImportModal } from '../../modals/ImportModal';
import {
	getTaskTemplateSourceModeOptions,
	isTaskTemplateSourceMode,
} from '../../settings-options';
import type IOTOTasksCenter from '../../main';
import {
	TASK_TEMPLATE_TYPES,
	getTaskTypeTemplateLabels,
	getTemplaterTemplatesFolder,
} from './helpers';

/**
 * 「任务模板」标签页：遍历所有任务类型，渲染各自的模板源（file / inline）配置。
 */
export function renderTaskTemplatesSection(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
): void {
	const templaterTemplatesFolder = getTemplaterTemplatesFolder(app);
	new Setting(containerEl)
		.setName(t('settings.taskTemplate.name'))
		.setDesc(t('settings.taskTemplate.desc'));

	for (const taskType of TASK_TEMPLATE_TYPES) {
		const taskTypeContainer = containerEl.createDiv({
			cls: 'ioto-tasks-center__task-template-settings',
		});
		renderTaskTemplateSettings(
			taskTypeContainer,
			plugin,
			taskType,
			templaterTemplatesFolder,
		);
	}
}

export function renderTaskTemplateSettings(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
	taskType: TaskCreationType,
	templaterTemplatesFolder: string | null,
): void {
	containerEl.empty();

	const config = plugin.settings.taskTemplateConfigs[taskType];
	const taskTypeLabel = getTaskTypeTemplateLabels()[taskType];
	const sourceModeOptions = getTaskTemplateSourceModeOptions();

	new Setting(containerEl)
		.setName(t('settings.taskTemplate.heading', [taskTypeLabel]))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.taskTemplate.source.name'))
		.setDesc(t('settings.taskTemplate.source.desc', [taskTypeLabel]))
		.addDropdown((dropdown) => {
			for (const [value, label] of Object.entries(sourceModeOptions)) {
				dropdown.addOption(value, label);
			}

			dropdown.setValue(config.sourceMode).onChange(async (value) => {
				const sourceMode = isTaskTemplateSourceMode(value) ? value : 'file';
				await plugin.updateTaskTemplateConfig(taskType, {
					sourceMode,
				});
				renderTaskTemplateSettings(
					containerEl,
					plugin,
					taskType,
					templaterTemplatesFolder,
				);
			});
		});

	const fileModeDesc = templaterTemplatesFolder
		? t('settings.taskTemplate.filePath.templater', [templaterTemplatesFolder])
		: t('settings.taskTemplate.filePath.templaterGeneric');
	new Setting(containerEl)
		.setName(t('settings.taskTemplate.filePath.name'))
		.setDesc(
			t('settings.taskTemplate.filePath.desc', [
				fileModeDesc,
				config.sourceMode === 'file'
					? ''
					: t('settings.taskTemplate.sourceDisabled'),
			]),
		)
		.addText((text) =>
			text
				// .setPlaceholder(
				// 	t('settings.taskTemplate.filePath.placeholder'),
				// )
				.setValue(config.templatePath)
				.onChange(async (value) => {
					await plugin.updateTaskTemplateConfig(taskType, {
						templatePath: value.trim(),
					});
				}),
		)
		.addButton((button) => {
			button
				.setButtonText(t('settings.taskTemplate.selectButton'))
				.onClick(() => {
					new ImportModal(
						plugin.app,
						(file: TFile) => {
							void (async () => {
								await plugin.updateTaskTemplateConfig(taskType, {
									templatePath: file.path,
								});
								renderTaskTemplateSettings(
									containerEl,
									plugin,
									taskType,
									templaterTemplatesFolder,
								);
							})();
						},
						[templaterTemplatesFolder || ''],
					).open();
				});
		})
		.addButton((button) => {
			button
				.setButtonText(t('settings.taskTemplate.clearButton'))
				.onClick(() => {
					void (async () => {
						await plugin.updateTaskTemplateConfig(taskType, {
							templatePath: '',
						});
						renderTaskTemplateSettings(
							containerEl,
							plugin,
							taskType,
							templaterTemplatesFolder,
						);
					})();
				});
		});

	new Setting(containerEl)
		.setName(t('settings.taskTemplate.inline.name'))
		.setDesc(
			t('settings.taskTemplate.inline.desc', [
				config.sourceMode === 'inline'
					? ''
					: t('settings.taskTemplate.sourceDisabled'),
			]),
		)
		.addTextArea((text) =>
			text
				.setPlaceholder(
					t('settings.taskTemplate.inline.placeholder', [taskTypeLabel]),
				)
				.setValue(config.inlineContent)
				.onChange(async (value) => {
					await plugin.updateTaskTemplateConfig(taskType, {
						inlineContent: value,
					});
				}),
		);
}
