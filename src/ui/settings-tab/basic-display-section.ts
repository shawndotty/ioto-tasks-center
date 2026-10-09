import { Setting } from 'obsidian';
import { DEFAULT_EXPORT_SCALE } from '../../export';
import { t } from '../../lang/helpter';
import { DEFAULT_EXPORT_IMAGE_FIXED_WIDTH } from '../../settings-types';
import {
	getProjectListSortModeOptions,
	getTaskLinkBadgeBackgroundModeOptions,
	getTaskViewExportWidthModeOptions,
	isProjectListSortMode,
	isTaskLinkBadgeBackgroundMode,
	isTaskViewExportWidthMode,
} from '../../settings-options';
import type IOTOTasksCenter from '../../main';

/**
 * 「基础」标签页下半部分：导出图片 / 任务双链计数 / 双链徽章背景 /
 * 优先级着色 / 子任务计数 / 任务笔记右键菜单 / 项目排序。
 */
export function renderBasicDisplaySection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	renderExportImageSection(containerEl, plugin);
	renderTaskOutlinksSection(containerEl, plugin);
	renderTaskLinkBadgesSection(containerEl, plugin);
	renderPrioritySection(containerEl, plugin);
	renderSubtasksSection(containerEl, plugin);
	renderTaskNoteMenuSection(containerEl, plugin);
	renderProjectSortSection(containerEl, plugin);
}

function renderExportImageSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	// 「导出图片」小节（[[Plan-20261006-102142]] §2.5）：改这些设置**无需**即时刷视图，
	// 下一次导出时才读取（provider 惰性求值）。
	new Setting(containerEl)
		.setName(t('settings.exportImage.section'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.exportImage.widthMode.name'))
		.setDesc(t('settings.exportImage.widthMode.desc'))
		.addDropdown((dropdown) => {
			const options = getTaskViewExportWidthModeOptions();
			for (const [value, label] of Object.entries(options)) {
				dropdown.addOption(value, label);
			}

			dropdown
				.setValue(plugin.settings.exportImageWidthMode)
				.onChange(async (value) => {
					if (!isTaskViewExportWidthMode(value)) {
						return;
					}

					await plugin.updateExportImageWidthMode(value);
				});
		});

	new Setting(containerEl)
		.setName(t('settings.exportImage.fixedWidth.name'))
		.setDesc(t('settings.exportImage.fixedWidth.desc'))
		.addText((text) =>
			text
				.setPlaceholder(String(DEFAULT_EXPORT_IMAGE_FIXED_WIDTH))
				.setValue(String(plugin.settings.exportImageFixedWidth))
				.onChange(async (value) => {
					await plugin.updateExportImageFixedWidth(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.exportImage.scale.name'))
		.setDesc(t('settings.exportImage.scale.desc'))
		.addText((text) =>
			text
				.setPlaceholder(String(DEFAULT_EXPORT_SCALE))
				.setValue(String(plugin.settings.exportImageScale))
				.onChange(async (value) => {
					await plugin.updateExportImageScale(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.exportImage.header.name'))
		.setDesc(t('settings.exportImage.header.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.exportImageWithHeader)
				.onChange(async (value) => {
					await plugin.updateExportImageWithHeader(value);
				}),
		);

	new Setting(containerEl)
		.setName(t('settings.exportImage.footer.name'))
		.setDesc(t('settings.exportImage.footer.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.exportImageWithFooter)
				.onChange(async (value) => {
					await plugin.updateExportImageWithFooter(value);
				}),
		);
}

function renderTaskOutlinksSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.taskOutlinks'))
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
}

function renderTaskLinkBadgesSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
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

function renderPrioritySection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.priority'))
		.setHeading();

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
}

function renderSubtasksSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.subtasks'))
		.setHeading();

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
					// this.display();
				});
		});
}
