import { Setting } from 'obsidian';
import { DEFAULT_EXPORT_SCALE } from '../../export';
import { t } from '../../lang/helpter';
import { DEFAULT_SETTINGS, DEFAULT_EXPORT_IMAGE_FIXED_WIDTH } from '../../settings-types';
import {
	getTaskViewAppearanceStyleOptions,
	getTaskViewExportWidthModeOptions,
	isTaskViewAppearanceStyle,
	isTaskViewExportWidthMode,
} from '../../settings-options';
import type IOTOTasksCenter from '../../main';

/**
 * 「任务视图」标签页：视图行为（4）/ 外观（1）/ 导出图片（5）。
 *
 * 导出图片改设置**无需**即时刷视图，下一次导出时才读取（provider 惰性求值）。
 */
export function renderTaskViewSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	renderViewBehaviorSection(containerEl, plugin);
	renderAppearanceSection(containerEl, plugin);
	renderExportImageSection(containerEl, plugin);
}

function renderViewBehaviorSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.taskViewBehavior'))
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
		.setName(t('settings.showViewToggleButton.name'))
		.setDesc(t('settings.showViewToggleButton.desc'))
		.addToggle((toggle) =>
			toggle
				.setValue(plugin.settings.showViewToggleButton)
				.onChange(async (value) => {
					await plugin.updateShowViewToggleButton(value);
				}),
		);

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

function renderAppearanceSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.appearance'))
		.setHeading();

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
}

function renderExportImageSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
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
