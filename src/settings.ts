import { App, PluginSettingTab, Setting } from 'obsidian';
import { t } from './lang/helpter';
import IOTOTasksCenter from './main';
import { TabbedSettings } from './ui/tabbed-settings';
import { renderBasicDisplaySection } from './ui/settings-tab/basic-display-section';
import { renderBasicGeneralSection } from './ui/settings-tab/basic-general-section';
import { renderBatchTemplateSection } from './ui/settings-tab/batch-templates-section';
import { renderEntryTemplateSection } from './ui/settings-tab/entry-templates-section';
import { renderTaskTemplatesSection } from './ui/settings-tab/task-templates-section';
import { renderTaskTypesSection } from './ui/settings-tab/task-types-section';

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

		new Setting(containerEl)
			.setName(t('settings.heading.main'))
			.setHeading();

		const tabbedSettings = new TabbedSettings(containerEl);

		tabbedSettings.addTab(t('settings.tabs.basic'), (containerEl) => {
			renderBasicGeneralSection(containerEl, this.plugin);
			renderBasicDisplaySection(containerEl, this.plugin);
		});

		tabbedSettings.addTab(t('settings.tabs.taskTypes'), (containerEl) => {
			renderTaskTypesSection(containerEl, this.plugin);
		});

		tabbedSettings.addTab(
			t('settings.tabs.taskTemplates'),
			(containerEl) => {
				renderTaskTemplatesSection(containerEl, this.app, this.plugin);
			},
		);

		tabbedSettings.addTab(
			t('settings.tabs.batchTemplates'),
			(containerEl) => {
				renderBatchTemplateSection(containerEl, this.app, this.plugin);
			},
		);

		tabbedSettings.addTab(
			t('settings.tabs.entryTemplates'),
			(containerEl) => {
				renderEntryTemplateSection(containerEl, this.app, this.plugin);
			},
		);
	}
}
