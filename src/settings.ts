import { App, PluginSettingTab, Setting } from 'obsidian';
import { t, type TranslationKey } from './lang/helpter';
// `IOTOTasksCenter` 在本文件**只作类型使用**（`IOTOTasksCenterSettingTab.plugin` 的注解）。
// 必须保持 `import type`：否则 `settings → main` 会成为**值级**反向边，与 `main → settings`
// 构成唯一的值级环（值图上实测 11 条环共此一根因，见 Plan-20261009-142035 §六.B.4/§十一）。
import type IOTOTasksCenter from './main';
import { TabbedSettings, resetTabInstanceCounter } from './ui/tabbed-settings';
import { renderGeneralSection } from './ui/settings-tab/general-section';
import { renderTaskListSection } from './ui/settings-tab/task-list-section';
import { renderTaskTypesSection } from './ui/settings-tab/task-types-section';
import { renderTaskViewSection } from './ui/settings-tab/task-view-section';
import { renderTemplatesSection } from './ui/settings-tab/templates-section';

// 公共 API barrel：保持外部 `from './settings'` 引用不变。
export type {
	IOTOTasksCenterSettings,
	ProjectListGroupMode,
	ProjectListSortMode,
	TaskLinkBadgeBackgroundMode,
	TaskListGroupMode,
	TaskListSortMode,
	TaskListTimeFilter,
	TaskSearchEntryMode,
	TaskViewAppearanceStyle,
	TaskViewExportOptions,
	TaskViewExportWidthMode,
} from './settings-types';
export {
	DEFAULT_EXPORT_IMAGE_FIXED_WIDTH,
	DEFAULT_SETTINGS,
	EXPORT_IMAGE_FIXED_WIDTH_MAX,
	EXPORT_IMAGE_FIXED_WIDTH_MIN,
	normalizeEnabledTaskCreationTypes,
} from './settings-types';

export {
	getProjectListGroupModeOptions,
	getProjectListSortModeOptions,
	getTaskLinkBadgeBackgroundModeOptions,
	getTaskListGroupModeOptions,
	getTaskListSortModeOptions,
	getTaskListTimeFilterOptions,
	getTaskSearchEntryModeOptions,
	getTaskTemplateSourceModeOptions,
	getTaskViewAppearanceStyleOptions,
	getTaskViewExportWidthModeOptions,
	isProjectListGroupMode,
	isProjectListSortMode,
	isTaskLinkBadgeBackgroundMode,
	isTaskListGroupMode,
	isTaskListSortMode,
	isTaskSearchEntryMode,
	isTaskTemplateSourceMode,
	isTaskViewAppearanceStyle,
	isTaskViewExportWidthMode,
} from './settings-options';

export {
	normalizeConfiguredInputRootPath,
	normalizeConfiguredOutcomeRootPath,
	normalizeConfiguredOutputRootPath,
	normalizeConfiguredTasksRootPath,
	normalizeExportImageFixedWidth,
	normalizeExportImageScale,
	normalizeExportImageWidthMode,
	normalizeProjectCategoryOptions,
	normalizeProjectListGroupMode,
	normalizeProjectListSortMode,
	normalizeRecentTaskCount,
	normalizeTaskLinkBadgeBackgroundMode,
	normalizeTaskSearchEntryMode,
	normalizeTaskViewAppearanceStyle,
} from './settings-normalizers';

export class IOTOTasksCenterSettingTab extends PluginSettingTab {
	plugin: IOTOTasksCenter;

	constructor(app: App, plugin: IOTOTasksCenter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		// CSS 作用域锚点：标签条样式全部挂在 .ioto-tasks-center-tab-page 之下，
		// 避免与 ioto-settings 等插件的同名全局类 .settings-tabs 争加载顺序。
		containerEl.addClass('ioto-tasks-center-tab-page');

		new Setting(containerEl)
			.setName(t('settings.heading.main'))
			.setHeading();

		resetTabInstanceCounter();

		const tabbedSettings = new TabbedSettings(
			containerEl,
			'ioto-tasks-center-root',
		);

		const configs: Array<{
			titleKey: TranslationKey;
			render: (contentEl: HTMLElement) => void;
		}> = [
			{
				titleKey: 'settings.tabs.general',
				render: (contentEl) => {
					renderGeneralSection(contentEl, this.plugin);
				},
			},
			{
				titleKey: 'settings.tabs.taskList',
				render: (contentEl) => {
					renderTaskListSection(contentEl, this.plugin);
				},
			},
			{
				titleKey: 'settings.tabs.taskView',
				render: (contentEl) => {
					renderTaskViewSection(contentEl, this.plugin);
				},
			},
			{
				titleKey: 'settings.tabs.templates',
				render: (contentEl) => {
					renderTemplatesSection(contentEl, this.app, this.plugin);
				},
			},
			{
				titleKey: 'settings.tabs.taskTypes',
				render: (contentEl) => {
					renderTaskTypesSection(contentEl, this.plugin);
				},
			},
		];

		for (const config of configs) {
			tabbedSettings.addTab(t(config.titleKey), config.render);
		}
	}
}
