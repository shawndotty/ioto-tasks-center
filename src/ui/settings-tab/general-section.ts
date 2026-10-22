import { Setting } from 'obsidian';
import { t } from '../../lang/helpter';
import { DEFAULT_DATE_TASK_DATE_FORMAT } from '../../tasks-center/date-task-format';
import {
	DEFAULT_INPUT_ROOT_PATH,
	DEFAULT_OUTCOME_ROOT_PATH,
	DEFAULT_OUTPUT_ROOT_PATH,
	DEFAULT_TASKS_ROOT_PATH,
} from '../../tasks-center/types';
import type IOTOTasksCenter from '../../main';

/**
 * 「常规」标签页：数据位置（4 个根路径）/ 命名规则（日期任务格式）/ 入口（2 个视图入口）。
 *
 * 数据位置与入口是低频但破坏性高的设置，单独成页避免混在任务列表的长列表里。
 */
export function renderGeneralSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	renderRootPaths(containerEl, plugin);
	renderDateTaskFormat(containerEl, plugin);
	renderViewEntries(containerEl, plugin);
}

function renderRootPaths(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.dataLocation'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.tasksRootPath.name'))
		.setDesc(t('settings.tasksRootPath.desc'))
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_TASKS_ROOT_PATH)
				.setValue(plugin.settings.tasksRootPath)
				.onChange(async (value) => {
					await plugin.updateTasksRootPath(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.inputRootPath.name'))
		.setDesc(t('settings.inputRootPath.desc'))
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_INPUT_ROOT_PATH)
				.setValue(plugin.settings.inputRootPath)
				.onChange(async (value) => {
					await plugin.updateInputRootPath(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.outputRootPath.name'))
		.setDesc(t('settings.outputRootPath.desc'))
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_OUTPUT_ROOT_PATH)
				.setValue(plugin.settings.outputRootPath)
				.onChange(async (value) => {
					await plugin.updateOutputRootPath(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.outcomeRootPath.name'))
		.setDesc(t('settings.outcomeRootPath.desc'))
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_OUTCOME_ROOT_PATH)
				.setValue(plugin.settings.outcomeRootPath)
				.onChange(async (value) => {
					await plugin.updateOutcomeRootPath(value);
				}),
		);
}

function renderDateTaskFormat(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.namingRules'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.dateTaskFormat.name'))
		.setDesc(t('settings.dateTaskFormat.desc', [DEFAULT_DATE_TASK_DATE_FORMAT]))
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_DATE_TASK_DATE_FORMAT)
				.setValue(plugin.settings.dateTaskDateFormat)
				.onChange(async (value) => {
					await plugin.updateDateTaskDateFormat(value);
				}),
		);
}

function renderViewEntries(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.entrypoints'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.viewEntry.name'))
		.setDesc(t('settings.viewEntry.desc'))
		.addButton((button) =>
			button
				.setButtonText(t('settings.viewEntry.button'))
				.onClick(async () => {
					await plugin.activateIOTOTasksCenterView();
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.projectCenterEntry.name'))
		.setDesc(t('settings.projectCenterEntry.desc'))
		.addButton((button) =>
			button
				.setButtonText(t('settings.projectCenterEntry.button'))
				.onClick(async () => {
					await plugin.activateIOTOProjectCenterView();
				}),
		);
}
