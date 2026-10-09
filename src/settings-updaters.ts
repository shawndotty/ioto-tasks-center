/**
 * 设置更新函数集合（核心模块，从 main.ts 抽出）。
 *
 * 约定（对齐 AGENTS.md「Settings lifecycle」）：
 *   归一化 → 与当前值相同则跳过 → 写入 settings → saveSettings() → applySettingsToOpenViews()。
 * 调用方传入 `SettingsUpdaterHost`（即 plugin 实例），本模块不直接依赖 main.ts，
 * 避免循环依赖，也便于单测。
 *
 * 本文件只含「纯比较」型简单更新；需要归一化 / 合并 / 集合比较的复杂更新见
 * settings-updaters-extended.ts，并通过下方「显式具名再导出」暴露，保持
 * `from './settings-updaters'` 的外部引用路径不变。
 */
import {
	type IOTOTasksCenterSettings,
	type ProjectListGroupMode,
	type ProjectListSortMode,
	type TaskLinkBadgeBackgroundMode,
	type TaskListGroupMode,
	type TaskListSortMode,
	type TaskListTimeFilter,
	type TaskSearchEntryMode,
	type TaskViewAppearanceStyle,
	type TaskViewExportOptions,
	type TaskViewExportWidthMode,
} from './settings';

// 再导出扩展集（需要归一化 / 合并 / 集合比较的复杂更新），保持单一入口。
// 刻意使用「显式具名」而非 `export *`：一旦 extended 新增与本地同名的导出，
// 会在此处产生「重复导出」编译错误，而不是被静默遮蔽。
export {
	areStringArraysEqual,
	updateRecentTaskCount,
	updateExportImageFixedWidth,
	updateExportImageScale,
	updateTasksRootPath,
	updateInputRootPath,
	updateOutputRootPath,
	updateOutcomeRootPath,
	setProjectHidden,
	updateTaskTemplateConfig,
	updateDateTaskDateFormat,
	updateEnabledTaskCreationTypes,
	addProjectCategoryOption,
	updateBatchTemplateConfig,
	updateEntryTemplateConfig,
} from './settings-updaters-extended';

/**
 * 更新函数依赖的最小宿主接口。IOTOTasksCenter 插件实例结构化满足此接口，
 * 单测可传入桩对象。applySettingsToOpenViews 在插件上为 public（见 main.ts）。
 */
export interface SettingsUpdaterHost {
	settings: IOTOTasksCenterSettings;
	saveSettings(): Promise<void>;
	applySettingsToOpenViews(): void;
}

/**
 * 组装 Task View 导出图片的运行时设置（供视图构造时注入的 provider 调用）。
 * 惰性求值：每次导出都重取，改设置后**无需**即时刷视图（[[Plan-20261006-102142]] §2.5）。
 */
export function resolveExportOptions(
	settings: IOTOTasksCenterSettings,
): TaskViewExportOptions {
	return {
		widthMode: settings.exportImageWidthMode,
		fixedWidth: settings.exportImageFixedWidth,
		scale: settings.exportImageScale,
		withHeader: settings.exportImageWithHeader,
		withFooter: settings.exportImageWithFooter,
	};
}

export async function updateProjectListSortMode(
	host: SettingsUpdaterHost,
	sortMode: ProjectListSortMode,
): Promise<void> {
	if (host.settings.projectListSortMode === sortMode) {
		return;
	}

	host.settings.projectListSortMode = sortMode;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateProjectListGroupMode(
	host: SettingsUpdaterHost,
	groupMode: ProjectListGroupMode,
): Promise<void> {
	if (host.settings.projectListGroupMode === groupMode) {
		return;
	}

	host.settings.projectListGroupMode = groupMode;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateTaskListSortMode(
	host: SettingsUpdaterHost,
	sortMode: TaskListSortMode,
): Promise<void> {
	if (host.settings.taskListSortMode === sortMode) {
		return;
	}

	host.settings.taskListSortMode = sortMode;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateTaskListGroupMode(
	host: SettingsUpdaterHost,
	groupMode: TaskListGroupMode,
): Promise<void> {
	if (host.settings.taskListGroupMode === groupMode) {
		return;
	}

	host.settings.taskListGroupMode = groupMode;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateShowTaskHierarchy(
	host: SettingsUpdaterHost,
	show: boolean,
): Promise<void> {
	if (host.settings.showTaskHierarchy === show) {
		return;
	}

	host.settings.showTaskHierarchy = show;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateShowTaskPriority(
	host: SettingsUpdaterHost,
	show: boolean,
): Promise<void> {
	if (host.settings.showTaskPriority === show) {
		return;
	}

	host.settings.showTaskPriority = show;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

// 这两个开关只在下次打开菜单时生效，不影响已渲染的视图，无需刷新。
export async function updateShowTaskNoteCoreMenu(
	host: SettingsUpdaterHost,
	show: boolean,
): Promise<void> {
	if (host.settings.showTaskNoteCoreMenu === show) {
		return;
	}

	host.settings.showTaskNoteCoreMenu = show;
	await host.saveSettings();
}

export async function updateShowTaskNotePriorityMenu(
	host: SettingsUpdaterHost,
	show: boolean,
): Promise<void> {
	if (host.settings.showTaskNotePriorityMenu === show) {
		return;
	}

	host.settings.showTaskNotePriorityMenu = show;
	await host.saveSettings();
}

export async function updateColorTaskTitleByPriority(
	host: SettingsUpdaterHost,
	color: boolean,
): Promise<void> {
	if (host.settings.colorTaskTitleByPriority === color) {
		return;
	}

	host.settings.colorTaskTitleByPriority = color;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateTaskListTimeFilter(
	host: SettingsUpdaterHost,
	filter: TaskListTimeFilter,
): Promise<void> {
	if (host.settings.taskListTimeFilter === filter) {
		return;
	}

	host.settings.taskListTimeFilter = filter;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateShowTaskOutlinkCounts(
	host: SettingsUpdaterHost,
	show: boolean,
): Promise<void> {
	if (host.settings.showTaskOutlinkCounts === show) {
		return;
	}

	host.settings.showTaskOutlinkCounts = show;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateTaskSearchEntryMode(
	host: SettingsUpdaterHost,
	mode: TaskSearchEntryMode,
): Promise<void> {
	if (host.settings.taskSearchEntryMode === mode) {
		return;
	}

	host.settings.taskSearchEntryMode = mode;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateAppearanceStyle(
	host: SettingsUpdaterHost,
	style: TaskViewAppearanceStyle,
): Promise<void> {
	if (host.settings.appearanceStyle === style) {
		return;
	}

	host.settings.appearanceStyle = style;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateUseIOTOTaskViewAsDefault(
	host: SettingsUpdaterHost,
	value: boolean,
): Promise<void> {
	if (host.settings.useIOTOTaskViewAsDefault === value) {
		return;
	}

	host.settings.useIOTOTaskViewAsDefault = value;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateShowTaskViewDeleteButtonOnDesktop(
	host: SettingsUpdaterHost,
	value: boolean,
): Promise<void> {
	if (host.settings.showTaskViewDeleteButtonOnDesktop === value) {
		return;
	}

	host.settings.showTaskViewDeleteButtonOnDesktop = value;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

// 导出设置改动**不**即时刷视图（下一次导出才读 provider），故不带 applySettingsToOpenViews。
export async function updateExportImageWidthMode(
	host: SettingsUpdaterHost,
	mode: TaskViewExportWidthMode,
): Promise<void> {
	if (host.settings.exportImageWidthMode === mode) {
		return;
	}

	host.settings.exportImageWidthMode = mode;
	await host.saveSettings();
}

export async function updateExportImageWithHeader(
	host: SettingsUpdaterHost,
	value: boolean,
): Promise<void> {
	if (host.settings.exportImageWithHeader === value) {
		return;
	}

	host.settings.exportImageWithHeader = value;
	await host.saveSettings();
}

export async function updateExportImageWithFooter(
	host: SettingsUpdaterHost,
	value: boolean,
): Promise<void> {
	if (host.settings.exportImageWithFooter === value) {
		return;
	}

	host.settings.exportImageWithFooter = value;
	await host.saveSettings();
}

export async function updateShowTaskSubtaskCount(
	host: SettingsUpdaterHost,
	show: boolean,
): Promise<void> {
	if (host.settings.showTaskSubtaskCount === show) {
		return;
	}

	host.settings.showTaskSubtaskCount = show;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateTaskLinkBadgeBackgroundMode(
	host: SettingsUpdaterHost,
	mode: TaskLinkBadgeBackgroundMode,
): Promise<void> {
	if (host.settings.taskLinkBadgeBackgroundMode === mode) {
		return;
	}

	host.settings.taskLinkBadgeBackgroundMode = mode;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateShowTaskInputOutlinkCount(
	host: SettingsUpdaterHost,
	show: boolean,
): Promise<void> {
	if (host.settings.showTaskInputOutlinkCount === show) {
		return;
	}

	host.settings.showTaskInputOutlinkCount = show;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateShowTaskOutputOutlinkCount(
	host: SettingsUpdaterHost,
	show: boolean,
): Promise<void> {
	if (host.settings.showTaskOutputOutlinkCount === show) {
		return;
	}

	host.settings.showTaskOutputOutlinkCount = show;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateShowTaskOutcomeOutlinkCount(
	host: SettingsUpdaterHost,
	show: boolean,
): Promise<void> {
	if (host.settings.showTaskOutcomeOutlinkCount === show) {
		return;
	}

	host.settings.showTaskOutcomeOutlinkCount = show;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}
