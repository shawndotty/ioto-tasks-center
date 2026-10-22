import { Setting } from 'obsidian';
import { t } from '../../lang/helpter';
import {
	getProjectListSortModeOptions,
	getTaskLinkBadgeBackgroundModeOptions,
	getTaskSearchEntryModeOptions,
	isProjectListSortMode,
	isTaskLinkBadgeBackgroundMode,
	isTaskSearchEntryMode,
} from '../../settings-options';
import type IOTOTasksCenter from '../../main';
import { renderTaskFilterTabsSection } from './task-filter-tabs-section';

/**
 * 「任务列表」标签页：列表内容 / 出链与徽章 / 筛选标签 / 项目列表 / 任务笔记 / 搜索。
 *
 * 页首把原「基础」页里两条只读说明行（任务列表行为、自动刷新）合并成一句介绍，
 * 文案一字不丢（自动刷新那句仍带 {0} 根路径插值）。
 */
export function renderTaskListSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: t('settings.taskList.intro', [plugin.settings.tasksRootPath]),
	});

	renderListContentSection(containerEl, plugin);
	renderOutlinksAndBadgesSection(containerEl, plugin);
	renderTaskFilterTabsSection(containerEl, plugin);
	renderProjectSortSection(containerEl, plugin);
	renderTaskNoteMenuSection(containerEl, plugin);
	renderTaskSearchEntryModeSection(containerEl, plugin);
}

function renderListContentSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.listContent'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.taskTitle.showProjectName.name'))
		.setDesc(t('settings.taskTitle.showProjectName.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showProjectNameInTaskList)
				.onChange(async (value) => {
					await plugin.updateShowProjectNameInTaskList(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.priority.colorTaskTitle.name'))
		.setDesc(t('settings.priority.colorTaskTitle.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.colorTaskTitleByPriority)
				.onChange(async (value) => {
					await plugin.updateColorTaskTitleByPriority(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.subtasks.showCount.name'))
		.setDesc(t('settings.subtasks.showCount.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showTaskSubtaskCount)
				.onChange(async (value) => {
					await plugin.updateShowTaskSubtaskCount(value);
				}),
		);
}

function renderOutlinksAndBadgesSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.outlinksBadges'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.taskOutlinks.show.name'))
		.setDesc(t('settings.taskOutlinks.show.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showTaskOutlinkCounts)
				.onChange(async (value) => {
					await plugin.updateShowTaskOutlinkCounts(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.taskOutlinks.input.name'))
		.setDesc(t('settings.taskOutlinks.input.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showTaskInputOutlinkCount)
				.onChange(async (value) => {
					await plugin.updateShowTaskInputOutlinkCount(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.taskOutlinks.output.name'))
		.setDesc(t('settings.taskOutlinks.output.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showTaskOutputOutlinkCount)
				.onChange(async (value) => {
					await plugin.updateShowTaskOutputOutlinkCount(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.taskOutlinks.outcome.name'))
		.setDesc(t('settings.taskOutlinks.outcome.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showTaskOutcomeOutlinkCount)
				.onChange(async (value) => {
					await plugin.updateShowTaskOutcomeOutlinkCount(value);
				}),
		);

	const taskLinkBadgeBackgroundModeOptions =
		getTaskLinkBadgeBackgroundModeOptions();
	new Setting(containerEl)
		.setName(t('settings.taskLinkBadges.backgroundMode.name'))
		.setDesc(t('settings.taskLinkBadges.backgroundMode.desc'))
		.addDropdown((dropdown) => {
			for (const [value, label] of Object.entries(
				taskLinkBadgeBackgroundModeOptions,
			)) {
				dropdown.addOption(value, label);
			}

			dropdown
				.setValue(plugin.settings.taskLinkBadgeBackgroundMode)
				.onChange(async (value) => {
					if (!isTaskLinkBadgeBackgroundMode(value)) {
						return;
					}

					await plugin.updateTaskLinkBadgeBackgroundMode(value);
				});
		});
}

function renderProjectSortSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	const projectSortModeOptions = getProjectListSortModeOptions();
	new Setting(containerEl)
		.setName(t('settings.heading.projectSort'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.projectSort.name'))
		.setDesc(t('settings.projectSort.desc'))
		.addDropdown((dropdown) => {
			for (const [value, label] of Object.entries(projectSortModeOptions)) {
				dropdown.addOption(value, label);
			}

			dropdown
				.setValue(plugin.settings.projectListSortMode)
				.onChange(async (value) => {
					if (!isProjectListSortMode(value)) {
						return;
					}

					await plugin.updateProjectListSortMode(value);
				});
		});
}

function renderTaskNoteMenuSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.taskNoteMenu'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.taskNoteMenu.showCore.name'))
		.setDesc(t('settings.taskNoteMenu.showCore.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showTaskNoteCoreMenu)
				.onChange(async (value) => {
					await plugin.updateShowTaskNoteCoreMenu(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.taskNoteMenu.showPriority.name'))
		.setDesc(t('settings.taskNoteMenu.showPriority.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showTaskNotePriorityMenu)
				.onChange(async (value) => {
					await plugin.updateShowTaskNotePriorityMenu(value);
				}),
		);
}

function renderTaskSearchEntryModeSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.search'))
		.setHeading();

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
