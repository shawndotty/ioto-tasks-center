import { App, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';
import { t } from './lang/helpter';
import {
	clampExportScale,
	DEFAULT_EXPORT_SCALE,
} from './export';
import IOTOTasksCenter from './main';
import { DEFAULT_DATE_TASK_DATE_FORMAT } from './tasks-center/date-task-format';
import {
	createDefaultTaskTemplateConfigMap,
	type TaskCreationType,
	type TaskTemplateConfigMap,
	type TaskTemplateSourceMode,
} from './tasks-center/task-template-config';
import {
	DEFAULT_BATCH_TEMPLATE_CONFIG,
	type BatchTemplateConfig,
	type BatchTaskTemplate,
} from './tasks-center/batch-task-template';
import { listProjectFolders } from './tasks-center/data';
import { ENABLED_TASK_CREATION_TYPE_ORDER } from './tasks-center/enabled-task-creation-types';
import {
	DEFAULT_INPUT_ROOT_PATH,
	DEFAULT_OUTPUT_ROOT_PATH,
	DEFAULT_OUTCOME_ROOT_PATH,
	DEFAULT_TASKS_ROOT_PATH,
	normalizeInputRootPath,
	normalizeOutcomeRootPath,
	normalizeOutputRootPath,
	normalizeTasksRootPath,
} from './tasks-center/types';
import { ImportModal } from './modals/ImportModal';
import { TabbedSettings } from './ui/tabbed-settings';
import { ConfirmModal } from './ui/confirmModal';
import { BatchTemplateEditModal } from './ui/batchTemplateEditModal';

export type ProjectListSortMode =
	| 'incomplete-count'
	| 'incomplete-count-asc'
	| 'name'
	| 'name-desc';
export type ProjectListGroupMode = 'none' | 'category';
export type TaskListSortMode =
	| 'created-desc'
	| 'created-asc'
	| 'updated-desc'
	| 'updated-asc'
	| 'name-asc'
	| 'name-desc'
	| 'priority-desc'
	| 'priority-asc'
	/** 仅在搜索时生效：按命中相关度排列，不作为可持久化的排序设置。 */
	| 'relevance';
export type TaskListGroupMode = 'none' | 'status' | 'priority';

/** 任务搜索的入口形态：常驻内联输入框（默认）或旧的弹窗。 */
export type TaskSearchEntryMode = 'inline' | 'modal';

export type TaskListTimeFilter =
	| 'none'
	| 'created-week'
	| 'created-two-weeks'
	| 'created-month'
	| 'created-calendar-week'
	| 'created-calendar-month'
	| 'updated-week'
	| 'updated-two-weeks'
	| 'updated-month'
	| 'updated-calendar-week'
	| 'updated-calendar-month';
export type TaskLinkBadgeBackgroundMode = 'multicolor' | 'monochrome';

/**
 * IOTOTask 视图的外观风格：
 * - `glass`：玻璃拟态（Aurora 渐变 + 模糊，默认，最华丽）
 * - `modern`：现代扁平（无边框分层 + 圆角 + 极浅投影，介于 glass 与 card 之间）
 * - `simple`：简洁（白卡 + 浅灰表头带 + 发丝分隔线 + 药丸按钮，最克制）
 * - `card`：经典扁平卡片（有边框 + 左侧实心强调线，最克制）
 */
export type TaskViewAppearanceStyle = 'glass' | 'modern' | 'simple' | 'card';

/** 任务视图导出图片的宽度口径：跟随视图宽度（默认）或固定像素。 */
export type TaskViewExportWidthMode = 'view' | 'fixed';

/** 任务视图导出图片的运行时设置（由 `main.ts` 组装成 provider 交给视图，见 [[Plan-20261006-102142]] §2.3）。 */
export interface TaskViewExportOptions {
	widthMode: TaskViewExportWidthMode;
	fixedWidth: number;
	scale: number;
	withHeader: boolean;
}

/** 固定宽度允许区间（px，[[Plan-20261006-102142]] §2.5）。 */
export const EXPORT_IMAGE_FIXED_WIDTH_MIN = 320;
export const EXPORT_IMAGE_FIXED_WIDTH_MAX = 2000;
export const DEFAULT_EXPORT_IMAGE_FIXED_WIDTH = 900;

export interface IOTOTasksCenterSettings {
	tasksRootPath: string;
	inputRootPath: string;
	outputRootPath: string;
	outcomeRootPath: string;
	projectListSortMode: ProjectListSortMode;
	projectListGroupMode: ProjectListGroupMode;
	taskListSortMode: TaskListSortMode;
	taskListGroupMode: TaskListGroupMode;
	taskListTimeFilter: TaskListTimeFilter;
	showTaskHierarchy: boolean;
	showTaskPriority: boolean;
	colorTaskTitleByPriority: boolean;
	showTaskSubtaskCount: boolean;
	showTaskNoteCoreMenu: boolean;
	showTaskNotePriorityMenu: boolean;
	taskLinkBadgeBackgroundMode: TaskLinkBadgeBackgroundMode;
	showTaskOutlinkCounts: boolean;
	showTaskInputOutlinkCount: boolean;
	showTaskOutputOutlinkCount: boolean;
	showTaskOutcomeOutlinkCount: boolean;
	hiddenProjectNames: string[];
	projectCategoryOptions: string[];
	enabledTaskCreationTypes: TaskCreationType[];
	taskTemplateConfigs: TaskTemplateConfigMap;
	dateTaskDateFormat: string;
	batchTemplateConfig: BatchTemplateConfig;
	taskSearchEntryMode: TaskSearchEntryMode;
	/**
	 * 在任务中心打开任务笔记时，是否默认使用 IOTOTask 任务视图（默认 false）。
	 * 仅门控「任务中心预览面板点开任务笔记」这一条自动路径；命令与右键菜单不受限。
	 */
	useIOTOTaskViewAsDefault: boolean;
	/** IOTOTask 视图外观风格（glass / modern / simple / card）。 */
	appearanceStyle: TaskViewAppearanceStyle;
	/** Task View「显示最近任务」保留的顶级任务数。 */
	recentTaskCount: number;
	/** Task View 导出图片的宽度口径（`view` 跟随视图 / `fixed` 固定 px）。 */
	exportImageWidthMode: TaskViewExportWidthMode;
	/** `exportImageWidthMode === 'fixed'` 时的宽度（px）。 */
	exportImageFixedWidth: number;
	/** 导出图片的像素倍率（1–4，步长 0.5）。 */
	exportImageScale: number;
	/** 导出图片是否带页眉（文件名 + 日期，默认关闭，[[Plan-20261006-102142]] Q3）。 */
	exportImageWithHeader: boolean;
}

export const DEFAULT_SETTINGS: IOTOTasksCenterSettings = {
	tasksRootPath: DEFAULT_TASKS_ROOT_PATH,
	inputRootPath: DEFAULT_INPUT_ROOT_PATH,
	outputRootPath: DEFAULT_OUTPUT_ROOT_PATH,
	outcomeRootPath: DEFAULT_OUTCOME_ROOT_PATH,
	projectListSortMode: 'incomplete-count',
	projectListGroupMode: 'none',
	taskListSortMode: 'created-desc',
	taskListGroupMode: 'none',
	taskListTimeFilter: 'none',
	showTaskHierarchy: true,
	showTaskPriority: false,
	colorTaskTitleByPriority: true,
	showTaskSubtaskCount: true,
	showTaskNoteCoreMenu: true,
	showTaskNotePriorityMenu: true,
	taskLinkBadgeBackgroundMode: 'multicolor',
	showTaskOutlinkCounts: false,
	showTaskInputOutlinkCount: true,
	showTaskOutputOutlinkCount: true,
	showTaskOutcomeOutlinkCount: true,
	hiddenProjectNames: [],
	projectCategoryOptions: [],
	enabledTaskCreationTypes: [...ENABLED_TASK_CREATION_TYPE_ORDER],
	taskTemplateConfigs: createDefaultTaskTemplateConfigMap(),
	dateTaskDateFormat: DEFAULT_DATE_TASK_DATE_FORMAT,
	batchTemplateConfig: { ...DEFAULT_BATCH_TEMPLATE_CONFIG },
	taskSearchEntryMode: 'inline',
	useIOTOTaskViewAsDefault: false,
	appearanceStyle: 'glass',
	recentTaskCount: 3,
	exportImageWidthMode: 'view',
	exportImageFixedWidth: DEFAULT_EXPORT_IMAGE_FIXED_WIDTH,
	exportImageScale: 2,
	exportImageWithHeader: false,
};

export { normalizeEnabledTaskCreationTypes } from './tasks-center/enabled-task-creation-types';

export function getProjectListSortModeOptions(): Record<
	ProjectListSortMode,
	string
> {
	return {
		'incomplete-count': t('project.sort.incompleteCountDesc'),
		'incomplete-count-asc': t('project.sort.incompleteCountAsc'),
		name: t('project.sort.projectNameAsc'),
		'name-desc': t('project.sort.projectNameDesc'),
	};
}

export function getProjectListGroupModeOptions(): Record<
	ProjectListGroupMode,
	string
> {
	return {
		none: t('project.group.none'),
		category: t('project.group.category'),
	};
}

export function getTaskListSortModeOptions(): Record<TaskListSortMode, string> {
	return {
		'created-desc': t('task.sort.createdDesc'),
		'created-asc': t('task.sort.createdAsc'),
		'updated-desc': t('task.sort.updatedDesc'),
		'updated-asc': t('task.sort.updatedAsc'),
		'name-asc': t('task.sort.nameAsc'),
		'name-desc': t('task.sort.nameDesc'),
		'priority-desc': t('task.sort.priorityDesc'),
		'priority-asc': t('task.sort.priorityAsc'),
		relevance: t('task.sort.relevance'),
	};
}

export function getTaskSearchEntryModeOptions(): Record<
	TaskSearchEntryMode,
	string
> {
	return {
		inline: t('settings.taskSearchEntryMode.inline'),
		modal: t('settings.taskSearchEntryMode.modal'),
	};
}

export function isTaskSearchEntryMode(
	value: string,
): value is TaskSearchEntryMode {
	return value === 'inline' || value === 'modal';
}

export function normalizeTaskSearchEntryMode(
	value: unknown,
): TaskSearchEntryMode {
	return value === 'modal' ? 'modal' : 'inline';
}

/**
 * 归一化 Task View「显示最近任务」的阈值：取整；`< 1` 或非有限数回退默认值。
 */
export function normalizeRecentTaskCount(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) {
		return DEFAULT_SETTINGS.recentTaskCount;
	}

	const floored = Math.floor(parsed);
	return floored < 1 ? DEFAULT_SETTINGS.recentTaskCount : floored;
}

export function isTaskViewExportWidthMode(
	value: unknown,
): value is TaskViewExportWidthMode {
	return value === 'view' || value === 'fixed';
}

export function getTaskViewExportWidthModeOptions(): Record<
	TaskViewExportWidthMode,
	string
> {
	return {
		view: t('settings.exportImage.widthMode.view'),
		fixed: t('settings.exportImage.widthMode.fixed'),
	};
}

export function normalizeExportImageWidthMode(
	value: unknown,
): TaskViewExportWidthMode {
	return isTaskViewExportWidthMode(value) ? value : 'view';
}

/** 固定宽度归一化：非数 / 越界回落默认，再取整。 */
export function normalizeExportImageFixedWidth(value: unknown): number {
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) {
		return DEFAULT_EXPORT_IMAGE_FIXED_WIDTH;
	}
	const rounded = Math.round(parsed);
	if (rounded < EXPORT_IMAGE_FIXED_WIDTH_MIN) {
		return EXPORT_IMAGE_FIXED_WIDTH_MIN;
	}
	if (rounded > EXPORT_IMAGE_FIXED_WIDTH_MAX) {
		return EXPORT_IMAGE_FIXED_WIDTH_MAX;
	}
	return rounded;
}

/** 导出倍率归一化：委托 `export.ts` 的夹取（非数 / 越界回落默认，按 0.5 步长取整）。 */
export function normalizeExportImageScale(value: unknown): number {
	return clampExportScale(value);
}

export function getTaskListGroupModeOptions(): Record<
	TaskListGroupMode,
	string
> {
	return {
		none: t('task.group.none'),
		status: t('task.group.status'),
		priority: t('task.group.priority'),
	};
}

export function getTaskListTimeFilterOptions(): Record<
	TaskListTimeFilter,
	string
> {
	return {
		none: t('menu.filter.none'),
		'created-week': t('menu.filter.createdWeek'),
		'created-two-weeks': t('menu.filter.createdTwoWeeks'),
		'created-month': t('menu.filter.createdMonth'),
		'created-calendar-week': t('menu.filter.createdCalendarWeek'),
		'created-calendar-month': t('menu.filter.createdCalendarMonth'),
		'updated-week': t('menu.filter.updatedWeek'),
		'updated-two-weeks': t('menu.filter.updatedTwoWeeks'),
		'updated-month': t('menu.filter.updatedMonth'),
		'updated-calendar-week': t('menu.filter.updatedCalendarWeek'),
		'updated-calendar-month': t('menu.filter.updatedCalendarMonth'),
	};
}

export function getTaskLinkBadgeBackgroundModeOptions(): Record<
	TaskLinkBadgeBackgroundMode,
	string
> {
	return {
		multicolor: t('settings.taskLinkBadges.backgroundMode.multicolor'),
		monochrome: t('settings.taskLinkBadges.backgroundMode.monochrome'),
	};
}

export function isProjectListSortMode(
	value: string,
): value is ProjectListSortMode {
	return (
		value === 'incomplete-count' ||
		value === 'incomplete-count-asc' ||
		value === 'name' ||
		value === 'name-desc'
	);
}

export function isProjectListGroupMode(
	value: string,
): value is ProjectListGroupMode {
	return value === 'none' || value === 'category';
}

export function isTaskListSortMode(value: string): value is TaskListSortMode {
	return (
		value === 'created-desc' ||
		value === 'created-asc' ||
		value === 'updated-desc' ||
		value === 'updated-asc' ||
		value === 'name-asc' ||
		value === 'name-desc' ||
		value === 'priority-desc' ||
		value === 'priority-asc'
	);
}

export function isTaskListGroupMode(value: string): value is TaskListGroupMode {
	return value === 'none' || value === 'status' || value === 'priority';
}

export function isTaskLinkBadgeBackgroundMode(
	value: string,
): value is TaskLinkBadgeBackgroundMode {
	return value === 'multicolor' || value === 'monochrome';
}

export function normalizeTaskLinkBadgeBackgroundMode(
	value: unknown,
): TaskLinkBadgeBackgroundMode {
	return typeof value === 'string' && isTaskLinkBadgeBackgroundMode(value)
		? value
		: 'multicolor';
}

export function getTaskViewAppearanceStyleOptions(): Record<
	TaskViewAppearanceStyle,
	string
> {
	return {
		glass: t('settings.appearanceStyle.glass'),
		modern: t('settings.appearanceStyle.modern'),
		simple: t('settings.appearanceStyle.simple'),
		card: t('settings.appearanceStyle.card'),
	};
}

export function isTaskViewAppearanceStyle(
	value: string,
): value is TaskViewAppearanceStyle {
	return (
		value === 'glass' ||
		value === 'modern' ||
		value === 'simple' ||
		value === 'card'
	);
}

export function normalizeTaskViewAppearanceStyle(
	value: unknown,
): TaskViewAppearanceStyle {
	return typeof value === 'string' && isTaskViewAppearanceStyle(value)
		? value
		: 'glass';
}

export function getTaskTemplateSourceModeOptions(): Record<
	TaskTemplateSourceMode,
	string
> {
	return {
		file: t('task.template.source.file'),
		inline: t('task.template.source.inline'),
	};
}

function getTaskTypeTemplateLabels(): Record<TaskCreationType, string> {
	return {
		date: t('task.type.date'),
		plan: t('task.type.plan'),
		topic: t('task.type.topic'),
		normal: t('task.type.normal'),
	};
}

export class IOTOTasksCenterSettingTab extends PluginSettingTab {
	plugin: IOTOTasksCenter;

	constructor(app: App, plugin: IOTOTasksCenter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const projectSortModeOptions = getProjectListSortModeOptions();
		const taskLinkBadgeBackgroundModeOptions =
			getTaskLinkBadgeBackgroundModeOptions();
		const taskSearchEntryModeOptions = getTaskSearchEntryModeOptions();

		containerEl.empty();

		new Setting(containerEl)
			.setName(t('settings.heading.main'))
			.setHeading();

		const tabbedSettings = new TabbedSettings(containerEl);

		tabbedSettings.addTab(t('settings.tabs.basic'), (containerEl) => {
			new Setting(containerEl)
				.setName(t('settings.tasksRootPath.name'))
				.setDesc(t('settings.tasksRootPath.desc'))
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_TASKS_ROOT_PATH)
						.setValue(this.plugin.settings.tasksRootPath)
						.onChange(async (value) => {
							await this.plugin.updateTasksRootPath(value);
							// this.display();
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.inputRootPath.name'))
				.setDesc(t('settings.inputRootPath.desc'))
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_INPUT_ROOT_PATH)
						.setValue(this.plugin.settings.inputRootPath)
						.onChange(async (value) => {
							await this.plugin.updateInputRootPath(value);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.outputRootPath.name'))
				.setDesc(t('settings.outputRootPath.desc'))
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_OUTPUT_ROOT_PATH)
						.setValue(this.plugin.settings.outputRootPath)
						.onChange(async (value) => {
							await this.plugin.updateOutputRootPath(value);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.outcomeRootPath.name'))
				.setDesc(t('settings.outcomeRootPath.desc'))
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_OUTCOME_ROOT_PATH)
						.setValue(this.plugin.settings.outcomeRootPath)
						.onChange(async (value) => {
							await this.plugin.updateOutcomeRootPath(value);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.viewEntry.name'))
				.setDesc(t('settings.viewEntry.desc'))
				.addButton((button) =>
					button
						.setButtonText(t('settings.viewEntry.button'))
						.onClick(async () => {
							await this.plugin.activateIOTOTasksCenterView();
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.projectCenterEntry.name'))
				.setDesc(t('settings.projectCenterEntry.desc'))
				.addButton((button) =>
					button
						.setButtonText(t('settings.projectCenterEntry.button'))
						.onClick(async () => {
							await this.plugin.activateIOTOProjectCenterView();
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.taskListBehavior.name'))
				.setDesc(t('settings.taskListBehavior.desc'));

			new Setting(containerEl)
				.setName(t('settings.autoRefresh.name'))
				.setDesc(
					t('settings.autoRefresh.desc', [
						this.plugin.settings.tasksRootPath,
					]),
				);

			new Setting(containerEl)
				.setName(t('settings.dateTaskFormat.name'))
				.setDesc(
					t('settings.dateTaskFormat.desc', [
						DEFAULT_DATE_TASK_DATE_FORMAT,
					]),
				)
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_DATE_TASK_DATE_FORMAT)
						.setValue(this.plugin.settings.dateTaskDateFormat)
						.onChange(async (value) => {
							await this.plugin.updateDateTaskDateFormat(value);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.taskSearchEntryMode.name'))
				.setDesc(t('settings.taskSearchEntryMode.desc'))
				.addDropdown((dropdown) => {
					for (const [value, label] of Object.entries(
						taskSearchEntryModeOptions,
					)) {
						dropdown.addOption(value, label);
					}

					dropdown
						.setValue(this.plugin.settings.taskSearchEntryMode)
						.onChange(async (value) => {
							if (!isTaskSearchEntryMode(value)) {
								return;
							}

							await this.plugin.updateTaskSearchEntryMode(value);
						});
				});

			new Setting(containerEl)
				.setName(t('settings.heading.taskView'))
				.setHeading();

			new Setting(containerEl)
				.setName(t('settings.useIOTOTaskViewAsDefault.name'))
				.setDesc(t('settings.useIOTOTaskViewAsDefault.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.useIOTOTaskViewAsDefault,
						)
						.onChange(async (value) => {
							await this.plugin.updateUseIOTOTaskViewAsDefault(
								value,
							);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.appearanceStyle.name'))
				.setDesc(t('settings.appearanceStyle.desc'))
				.addDropdown((dropdown) => {
					const appearanceStyleOptions =
						getTaskViewAppearanceStyleOptions();
					for (const [value, label] of Object.entries(
						appearanceStyleOptions,
					)) {
						dropdown.addOption(value, label);
					}

					dropdown
						.setValue(this.plugin.settings.appearanceStyle)
						.onChange(async (value) => {
							if (!isTaskViewAppearanceStyle(value)) {
								return;
							}

							await this.plugin.updateAppearanceStyle(value);
						});
				});

			new Setting(containerEl)
				.setName(t('settings.recentTaskCount.name'))
				.setDesc(t('settings.recentTaskCount.desc'))
				.addText((text) =>
					text
						.setPlaceholder(String(DEFAULT_SETTINGS.recentTaskCount))
						.setValue(String(this.plugin.settings.recentTaskCount))
						.onChange(async (value) => {
							await this.plugin.updateRecentTaskCount(value);
						}),
				);

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
						.setValue(this.plugin.settings.exportImageWidthMode)
						.onChange(async (value) => {
							if (!isTaskViewExportWidthMode(value)) {
								return;
							}

							await this.plugin.updateExportImageWidthMode(
								value,
							);
						});
				});

			new Setting(containerEl)
				.setName(t('settings.exportImage.fixedWidth.name'))
				.setDesc(t('settings.exportImage.fixedWidth.desc'))
				.addText((text) =>
					text
						.setPlaceholder(
							String(DEFAULT_EXPORT_IMAGE_FIXED_WIDTH),
						)
						.setValue(
							String(this.plugin.settings.exportImageFixedWidth),
						)
						.onChange(async (value) => {
							await this.plugin.updateExportImageFixedWidth(
								value,
							);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.exportImage.scale.name'))
				.setDesc(t('settings.exportImage.scale.desc'))
				.addText((text) =>
					text
						.setPlaceholder(String(DEFAULT_EXPORT_SCALE))
						.setValue(String(this.plugin.settings.exportImageScale))
						.onChange(async (value) => {
							await this.plugin.updateExportImageScale(value);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.exportImage.header.name'))
				.setDesc(t('settings.exportImage.header.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.exportImageWithHeader)
						.onChange(async (value) => {
							await this.plugin.updateExportImageWithHeader(
								value,
							);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.heading.taskOutlinks'))
				.setHeading();

			new Setting(containerEl)
				.setName(t('settings.taskOutlinks.show.name'))
				.setDesc(t('settings.taskOutlinks.show.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.showTaskOutlinkCounts)
						.onChange(async (value) => {
							await this.plugin.updateShowTaskOutlinkCounts(
								value,
							);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.taskOutlinks.input.name'))
				.setDesc(t('settings.taskOutlinks.input.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.showTaskInputOutlinkCount,
						)
						.onChange(async (value) => {
							await this.plugin.updateShowTaskInputOutlinkCount(
								value,
							);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.taskOutlinks.output.name'))
				.setDesc(t('settings.taskOutlinks.output.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.showTaskOutputOutlinkCount,
						)
						.onChange(async (value) => {
							await this.plugin.updateShowTaskOutputOutlinkCount(
								value,
							);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.taskOutlinks.outcome.name'))
				.setDesc(t('settings.taskOutlinks.outcome.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.showTaskOutcomeOutlinkCount,
						)
						.onChange(async (value) => {
							await this.plugin.updateShowTaskOutcomeOutlinkCount(
								value,
							);
						}),
				);

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
						.setValue(
							this.plugin.settings.taskLinkBadgeBackgroundMode,
						)
						.onChange(async (value) => {
							if (!isTaskLinkBadgeBackgroundMode(value)) {
								return;
							}

							await this.plugin.updateTaskLinkBadgeBackgroundMode(
								value,
							);
						});
				});

			new Setting(containerEl)
				.setName(t('settings.heading.priority'))
				.setHeading();

			new Setting(containerEl)
				.setName(t('settings.priority.colorTaskTitle.name'))
				.setDesc(t('settings.priority.colorTaskTitle.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(
							this.plugin.settings.colorTaskTitleByPriority,
						)
						.onChange(async (value) => {
							await this.plugin.updateColorTaskTitleByPriority(
								value,
							);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.heading.subtasks'))
				.setHeading();

			new Setting(containerEl)
				.setName(t('settings.subtasks.showCount.name'))
				.setDesc(t('settings.subtasks.showCount.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.showTaskSubtaskCount)
						.onChange(async (value) => {
							await this.plugin.updateShowTaskSubtaskCount(value);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.heading.taskNoteMenu'))
				.setHeading();

			new Setting(containerEl)
				.setName(t('settings.taskNoteMenu.showCore.name'))
				.setDesc(t('settings.taskNoteMenu.showCore.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.showTaskNoteCoreMenu)
						.onChange(async (value) => {
							await this.plugin.updateShowTaskNoteCoreMenu(value);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.taskNoteMenu.showPriority.name'))
				.setDesc(t('settings.taskNoteMenu.showPriority.desc'))
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.showTaskNotePriorityMenu)
						.onChange(async (value) => {
							await this.plugin.updateShowTaskNotePriorityMenu(value);
						}),
				);

			new Setting(containerEl)
				.setName(t('settings.heading.projectSort'))
				.setHeading();

			new Setting(containerEl)
				.setName(t('settings.projectSort.name'))
				.setDesc(t('settings.projectSort.desc'))
				.addDropdown((dropdown) => {
					for (const [value, label] of Object.entries(
						projectSortModeOptions,
					)) {
						dropdown.addOption(value, label);
					}

					dropdown
						.setValue(this.plugin.settings.projectListSortMode)
						.onChange(async (value) => {
							if (!isProjectListSortMode(value)) {
								return;
							}

							await this.plugin.updateProjectListSortMode(value);
							// this.display();
						});
				});
		});

		tabbedSettings.addTab(t('settings.tabs.taskTypes'), (containerEl) => {
			new Setting(containerEl)
				.setName(t('settings.heading.taskCreation'))
				.setHeading();

			new Setting(containerEl)
				.setName(t('settings.enabledTaskTypes.name'))
				.setDesc(t('settings.enabledTaskTypes.desc'));

			const enabledTaskTypes = new Set<TaskCreationType>(
				this.plugin.settings.enabledTaskCreationTypes,
			);
			const taskTypeLabels = getTaskTypeTemplateLabels();
			for (const taskType of ENABLED_TASK_CREATION_TYPE_ORDER) {
				new Setting(containerEl)
					.setName(taskTypeLabels[taskType])
					.addToggle((toggle) =>
						toggle
							.setValue(enabledTaskTypes.has(taskType))
							.onChange(async (value) => {
								if (
									!value &&
									enabledTaskTypes.has(taskType) &&
									enabledTaskTypes.size === 1
								) {
									toggle.setValue(true);
									new Notice(
										t(
											'settings.enabledTaskTypes.atLeastOne',
										),
									);
									return;
								}

								if (value) {
									enabledTaskTypes.add(taskType);
								} else {
									enabledTaskTypes.delete(taskType);
								}

								await this.plugin.updateEnabledTaskCreationTypes(
									[...enabledTaskTypes],
								);
							}),
					);
			}
		});

		tabbedSettings.addTab(
			t('settings.tabs.taskTemplates'),
			(containerEl) => {
				const templaterTemplatesFolder = getTemplaterTemplatesFolder(
					this.app,
				);
				new Setting(containerEl)
					.setName(t('settings.taskTemplate.name'))
					.setDesc(t('settings.taskTemplate.desc'));

				for (const taskType of TASK_TEMPLATE_TYPES) {
					const taskTypeContainer = containerEl.createDiv({
						cls: 'ioto-tasks-center__task-template-settings',
					});
					this.renderTaskTemplateSettings(
						taskTypeContainer,
						taskType,
						templaterTemplatesFolder,
					);
				}
			},
		);

		tabbedSettings.addTab(
			t('settings.tabs.batchTemplates'),
			(containerEl) => {
				this.renderBatchTemplateSettings(containerEl);
			},
		);
	}

	private renderBatchTemplateSettings(containerEl: HTMLElement): void {
		containerEl.empty();

		const config = this.plugin.settings.batchTemplateConfig;

		new Setting(containerEl)
			.setName(t('settings.batchTemplates.enabled.name'))
			.setDesc(t('settings.batchTemplates.enabled.desc'))
			.addToggle((toggle) =>
				toggle.setValue(config.enabled).onChange(async (value) => {
					await this.plugin.updateBatchTemplateConfig({
						enabled: value,
						templates: config.templates,
					});
					this.renderBatchTemplateSettings(containerEl);
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
						void this.openBatchTemplateEditor(containerEl, null);
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
				void this.openBatchTemplateEditor(containerEl, template);
			});

			const deleteButtonEl = actionsEl.createEl('button', {
				text: t('settings.batchTemplates.delete'),
			});
			deleteButtonEl.type = 'button';
			deleteButtonEl.addEventListener('click', () => {
				void this.confirmDeleteBatchTemplate(containerEl, template);
			});
		}
	}

	private async openBatchTemplateEditor(
		containerEl: HTMLElement,
		existing: BatchTaskTemplate | null,
	): Promise<void> {
		const availableProjects = this.resolveAvailableProjectNames();
		const result = await new BatchTemplateEditModal(
			this.app,
			existing,
			availableProjects,
		).openAndGetValue();
		if (!result) {
			return;
		}

		const config = this.plugin.settings.batchTemplateConfig;
		const nextTemplates =
			existing === null
				? [...config.templates, result]
				: config.templates.map((template) =>
						template.id === existing.id ? result : template,
					);

		await this.plugin.updateBatchTemplateConfig({
			enabled: config.enabled,
			templates: nextTemplates,
		});
		this.renderBatchTemplateSettings(containerEl);
	}

	private resolveAvailableProjectNames(): string[] {
		const tasksRootPath = this.plugin.settings.tasksRootPath;
		if (!tasksRootPath) {
			return [];
		}
		const result = listProjectFolders(this.app, tasksRootPath);
		return result.status === 'success'
			? result.projects.map((project) => project.name)
			: [];
	}

	private async confirmDeleteBatchTemplate(
		containerEl: HTMLElement,
		template: BatchTaskTemplate,
	): Promise<void> {
		const confirmed = await new ConfirmModal(
			this.app,
			t('settings.batchTemplates.deleteConfirm.title'),
			{
				descriptionText: t(
					'settings.batchTemplates.deleteConfirm.desc',
					[template.name],
				),
				confirmButtonText: t(
					'settings.batchTemplates.deleteConfirm.confirm',
				),
				cancelButtonText: t('modal.cancel'),
			},
		).openAndConfirm();
		if (!confirmed) {
			return;
		}

		const config = this.plugin.settings.batchTemplateConfig;
		const nextTemplates = config.templates.filter(
			(entry) => entry.id !== template.id,
		);
		await this.plugin.updateBatchTemplateConfig({
			enabled: config.enabled,
			templates: nextTemplates,
		});
		this.renderBatchTemplateSettings(containerEl);
	}

	private renderTaskTemplateSettings(
		containerEl: HTMLElement,
		taskType: TaskCreationType,
		templaterTemplatesFolder: string | null,
	): void {
		containerEl.empty();

		const config = this.plugin.settings.taskTemplateConfigs[taskType];
		const taskTypeLabel = getTaskTypeTemplateLabels()[taskType];
		const sourceModeOptions = getTaskTemplateSourceModeOptions();

		new Setting(containerEl)
			.setName(t('settings.taskTemplate.heading', [taskTypeLabel]))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.taskTemplate.source.name'))
			.setDesc(t('settings.taskTemplate.source.desc', [taskTypeLabel]))
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(
					sourceModeOptions,
				)) {
					dropdown.addOption(value, label);
				}

				dropdown.setValue(config.sourceMode).onChange(async (value) => {
					const sourceMode = isTaskTemplateSourceMode(value)
						? value
						: 'file';
					await this.plugin.updateTaskTemplateConfig(taskType, {
						sourceMode,
					});
					this.renderTaskTemplateSettings(
						containerEl,
						taskType,
						templaterTemplatesFolder,
					);
				});
			});

		const fileModeDesc = templaterTemplatesFolder
			? t('settings.taskTemplate.filePath.templater', [
					templaterTemplatesFolder,
				])
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
						await this.plugin.updateTaskTemplateConfig(taskType, {
							templatePath: value.trim(),
						});
					}),
			)
			.addButton((button) => {
				button
					.setButtonText(t('settings.taskTemplate.selectButton'))
					.onClick(() => {
						new ImportModal(
							this.app,
							(file: TFile) => {
								void (async () => {
									await this.plugin.updateTaskTemplateConfig(
										taskType,
										{
											templatePath: file.path,
										},
									);
									this.renderTaskTemplateSettings(
										containerEl,
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
							await this.plugin.updateTaskTemplateConfig(
								taskType,
								{
									templatePath: '',
								},
							);
							this.renderTaskTemplateSettings(
								containerEl,
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
						t('settings.taskTemplate.inline.placeholder', [
							taskTypeLabel,
						]),
					)
					.setValue(config.inlineContent)
					.onChange(async (value) => {
						await this.plugin.updateTaskTemplateConfig(taskType, {
							inlineContent: value,
						});
					}),
			);
	}
}

function getTemplaterTemplatesFolder(app: App): string | null {
	const templater = (
		app as App & {
			plugins?: {
				plugins?: Record<
					string,
					{ settings?: { templates_folder?: unknown } }
				>;
			};
		}
	).plugins?.plugins?.['templater-obsidian'];
	const templatesFolder = templater?.settings?.templates_folder;
	return typeof templatesFolder === 'string' && templatesFolder.length > 0
		? templatesFolder
		: null;
}

export function normalizeConfiguredTasksRootPath(path: string): string {
	return normalizeTasksRootPath(path);
}

export function normalizeConfiguredInputRootPath(path: string): string {
	return normalizeInputRootPath(path);
}

export function normalizeConfiguredOutputRootPath(path: string): string {
	return normalizeOutputRootPath(path);
}

export function normalizeConfiguredOutcomeRootPath(path: string): string {
	return normalizeOutcomeRootPath(path);
}

export function normalizeProjectListSortMode(
	input: unknown,
): ProjectListSortMode {
	return typeof input === 'string' && isProjectListSortMode(input)
		? input
		: DEFAULT_SETTINGS.projectListSortMode;
}

export function normalizeProjectListGroupMode(
	input: unknown,
): ProjectListGroupMode {
	return typeof input === 'string' && isProjectListGroupMode(input)
		? input
		: DEFAULT_SETTINGS.projectListGroupMode;
}

export function normalizeProjectCategoryOptions(input: unknown): string[] {
	if (!Array.isArray(input)) {
		return [];
	}

	const set = new Set<string>();
	for (const item of input) {
		if (typeof item !== 'string') {
			continue;
		}

		const normalized = item.trim();
		if (normalized) {
			set.add(normalized);
		}
	}

	return [...set].sort((left, right) =>
		left.localeCompare(right, undefined, { numeric: true }),
	);
}

export function isTaskTemplateSourceMode(
	value: string,
): value is TaskTemplateSourceMode {
	return value === 'file' || value === 'inline';
}

const TASK_TEMPLATE_TYPES: TaskCreationType[] = [
	'normal',
	'topic',
	'plan',
	'date',
];
