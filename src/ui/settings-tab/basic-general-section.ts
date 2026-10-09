import { Setting } from 'obsidian';
import { t } from '../../lang/helpter';
import { DEFAULT_DATE_TASK_DATE_FORMAT } from '../../tasks-center/date-task-format';
import {
	DEFAULT_INPUT_ROOT_PATH,
	DEFAULT_OUTCOME_ROOT_PATH,
	DEFAULT_OUTPUT_ROOT_PATH,
	DEFAULT_TASKS_ROOT_PATH,
} from '../../tasks-center/types';
import { DEFAULT_SETTINGS } from '../../settings-types';
import {
	getTaskSearchEntryModeOptions,
	getTaskViewAppearanceStyleOptions,
	isTaskSearchEntryMode,
	isTaskViewAppearanceStyle,
} from '../../settings-options';
import type IOTOTasksCenter from '../../main';

/**
 * 「基础」标签页上半部分：根路径 / 视图入口 / 任务列表行为 / 自动刷新 /
 * 日期任务格式 / 搜索入口 / 任务视图风格。
 */
export function renderBasicGeneralSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	renderRootPaths(containerEl, plugin);
	renderViewEntries(containerEl, plugin);
	renderTaskListBehavior(containerEl, plugin);
	renderDateTaskFormat(containerEl, plugin);
	renderTaskSearchEntryMode(containerEl, plugin);
	renderTaskViewSection(containerEl, plugin);
}

function renderRootPaths(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.tasksRootPath.name'))
		.setDesc(t('settings.tasksRootPath.desc'))
		.addText((text) =>
			text
				.setPlaceholder(DEFAULT_TASKS_ROOT_PATH)
				.setValue(plugin.settings.tasksRootPath)
				.onChange(async (value) => {
					await plugin.updateTasksRootPath(value);
					// this.display();
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

function renderViewEntries(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
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

function renderTaskListBehavior(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.taskListBehavior.name'))
		.setDesc(t('settings.taskListBehavior.desc'));

	new Setting(containerEl)
		.setName(t('settings.autoRefresh.name'))
		.setDesc(
			t('settings.autoRefresh.desc', [plugin.settings.tasksRootPath]),
		);
}

function renderDateTaskFormat(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
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

function renderTaskSearchEntryMode(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	const taskSearchEntryModeOptions = getTaskSearchEntryModeOptions();
	new Setting(containerEl)
		.setName(t('settings.taskSearchEntryMode.name'))
		.setDesc(t('settings.taskSearchEntryMode.desc'))
		.addDropdown((dropdown) => {
			for (const [value, label] of Object.entries(taskSearchEntryModeOptions)) {
				dropdown.addOption(value, label);
			}

			dropdown
				.setValue(plugin.settings.taskSearchEntryMode)
				.onChange(async (value) => {
					if (!isTaskSearchEntryMode(value)) {
						return;
					}

					await plugin.updateTaskSearchEntryMode(value);
				});
		});
}

function renderTaskViewSection(containerEl: HTMLElement, plugin: IOTOTasksCenter): void {
	new Setting(containerEl)
		.setName(t('settings.heading.taskView'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.useIOTOTaskViewAsDefault.name'))
		.setDesc(t('settings.useIOTOTaskViewAsDefault.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.useIOTOTaskViewAsDefault)
				.onChange(async (value) => {
					await plugin.updateUseIOTOTaskViewAsDefault(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.appearanceStyle.name'))
		.setDesc(t('settings.appearanceStyle.desc'))
		.addDropdown((dropdown) => {
			const appearanceStyleOptions = getTaskViewAppearanceStyleOptions();
			for (const [value, label] of Object.entries(appearanceStyleOptions)) {
				dropdown.addOption(value, label);
			}

			dropdown
				.setValue(plugin.settings.appearanceStyle)
				.onChange(async (value) => {
					if (!isTaskViewAppearanceStyle(value)) {
						return;
					}

					await plugin.updateAppearanceStyle(value);
				});
		});

	new Setting(containerEl)
		.setName(t('settings.recentTaskCount.name'))
		.setDesc(t('settings.recentTaskCount.desc'))
		.addText((text) =>
			text
				.setPlaceholder(String(DEFAULT_SETTINGS.recentTaskCount))
				.setValue(String(plugin.settings.recentTaskCount))
				.onChange(async (value) => {
					await plugin.updateRecentTaskCount(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.showTaskViewDeleteButtonOnDesktop.name'))
		.setDesc(t('settings.showTaskViewDeleteButtonOnDesktop.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showTaskViewDeleteButtonOnDesktop)
				.onChange(async (value) => {
					await plugin.updateShowTaskViewDeleteButtonOnDesktop(value);
				}),
		);
}
