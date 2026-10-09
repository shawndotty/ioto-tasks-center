/**
 * 设置更新函数（扩展集）—— 需要归一化 / 合并 / 集合比较的复杂更新。
 * 从 settings-updaters.ts 拆出以控制单文件行数。core 模块通过
 * `export *` 再导出本模块，保持 `from './settings-updaters'` 的外部引用不变。
 */
import type { SettingsUpdaterHost } from './settings-updaters';
import {
	normalizeConfiguredInputRootPath,
	normalizeConfiguredOutcomeRootPath,
	normalizeConfiguredOutputRootPath,
	normalizeConfiguredTasksRootPath,
	normalizeEnabledTaskCreationTypes,
	normalizeExportImageFixedWidth,
	normalizeExportImageScale,
	normalizeRecentTaskCount,
} from './settings';
import { normalizeDateTaskDateFormat } from './tasks-center/date-task-format';
import {
	areBatchTemplateConfigsEqual,
	normalizeBatchTemplateConfig,
	type BatchTemplateConfig,
} from './tasks-center/batch-task-template';
import {
	areEntryTemplateConfigsEqual,
	normalizeEntryTemplateConfig,
	type EntryTemplateConfig,
} from './tasks-center/task-entry-template';
import {
	areTaskTemplateConfigsEqual,
	mergeTaskTemplateConfig,
	type TaskCreationType,
	type TaskTemplateConfig,
} from './tasks-center/task-template-config';

/** 两个字符串数组内容是否完全相等（顺序敏感）。 */
export function areStringArraysEqual(
	left: string[],
	right: string[],
): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

export async function updateRecentTaskCount(
	host: SettingsUpdaterHost,
	value: unknown,
): Promise<void> {
	const count = normalizeRecentTaskCount(value);
	if (host.settings.recentTaskCount === count) {
		return;
	}

	host.settings.recentTaskCount = count;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateExportImageFixedWidth(
	host: SettingsUpdaterHost,
	value: unknown,
): Promise<void> {
	const width = normalizeExportImageFixedWidth(value);
	if (host.settings.exportImageFixedWidth === width) {
		return;
	}

	host.settings.exportImageFixedWidth = width;
	await host.saveSettings();
}

export async function updateExportImageScale(
	host: SettingsUpdaterHost,
	value: unknown,
): Promise<void> {
	const scale = normalizeExportImageScale(value);
	if (host.settings.exportImageScale === scale) {
		return;
	}

	host.settings.exportImageScale = scale;
	await host.saveSettings();
}

export async function updateTasksRootPath(
	host: SettingsUpdaterHost,
	path: string,
): Promise<void> {
	const nextPath = normalizeConfiguredTasksRootPath(path);
	if (host.settings.tasksRootPath === nextPath) {
		return;
	}

	host.settings.tasksRootPath = nextPath;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateInputRootPath(
	host: SettingsUpdaterHost,
	path: string,
): Promise<void> {
	const nextPath = normalizeConfiguredInputRootPath(path);
	if (host.settings.inputRootPath === nextPath) {
		return;
	}

	host.settings.inputRootPath = nextPath;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateOutputRootPath(
	host: SettingsUpdaterHost,
	path: string,
): Promise<void> {
	const nextPath = normalizeConfiguredOutputRootPath(path);
	if (host.settings.outputRootPath === nextPath) {
		return;
	}

	host.settings.outputRootPath = nextPath;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateOutcomeRootPath(
	host: SettingsUpdaterHost,
	path: string,
): Promise<void> {
	const nextPath = normalizeConfiguredOutcomeRootPath(path);
	if (host.settings.outcomeRootPath === nextPath) {
		return;
	}

	host.settings.outcomeRootPath = nextPath;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function setProjectHidden(
	host: SettingsUpdaterHost,
	projectName: string,
	hidden: boolean,
): Promise<void> {
	const hiddenProjectNameSet = new Set(host.settings.hiddenProjectNames);
	if (hidden) {
		hiddenProjectNameSet.add(projectName);
	} else {
		hiddenProjectNameSet.delete(projectName);
	}

	const nextHiddenProjectNames = [...hiddenProjectNameSet].sort(
		(left, right) => left.localeCompare(right, undefined, { numeric: true }),
	);
	if (
		areStringArraysEqual(
			host.settings.hiddenProjectNames,
			nextHiddenProjectNames,
		)
	) {
		return;
	}

	host.settings.hiddenProjectNames = nextHiddenProjectNames;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateTaskTemplateConfig(
	host: SettingsUpdaterHost,
	type: TaskCreationType,
	config: Partial<TaskTemplateConfig>,
): Promise<void> {
	const currentConfig = host.settings.taskTemplateConfigs[type];
	const nextConfig = mergeTaskTemplateConfig(currentConfig, config);
	if (areTaskTemplateConfigsEqual(currentConfig, nextConfig)) {
		return;
	}

	host.settings.taskTemplateConfigs = {
		...host.settings.taskTemplateConfigs,
		[type]: nextConfig,
	};
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateDateTaskDateFormat(
	host: SettingsUpdaterHost,
	format: string,
): Promise<void> {
	const nextFormat = normalizeDateTaskDateFormat(format);

	if (host.settings.dateTaskDateFormat === nextFormat) {
		return;
	}

	host.settings.dateTaskDateFormat = nextFormat;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateEnabledTaskCreationTypes(
	host: SettingsUpdaterHost,
	types: TaskCreationType[],
): Promise<void> {
	const nextTypes = normalizeEnabledTaskCreationTypes(types);
	if (
		areStringArraysEqual(host.settings.enabledTaskCreationTypes, nextTypes)
	) {
		return;
	}

	host.settings.enabledTaskCreationTypes = nextTypes;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function addProjectCategoryOption(
	host: SettingsUpdaterHost,
	category: string,
): Promise<void> {
	const normalized = category.trim();
	if (!normalized) {
		return;
	}

	const categorySet = new Set(host.settings.projectCategoryOptions);
	categorySet.add(normalized);
	const nextCategories = [...categorySet].sort((left, right) =>
		left.localeCompare(right, undefined, { numeric: true }),
	);
	if (
		areStringArraysEqual(
			host.settings.projectCategoryOptions,
			nextCategories,
		)
	) {
		return;
	}

	host.settings.projectCategoryOptions = nextCategories;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateBatchTemplateConfig(
	host: SettingsUpdaterHost,
	config: BatchTemplateConfig,
): Promise<void> {
	const nextConfig = normalizeBatchTemplateConfig(config);
	if (
		areBatchTemplateConfigsEqual(
			host.settings.batchTemplateConfig,
			nextConfig,
		)
	) {
		return;
	}

	host.settings.batchTemplateConfig = nextConfig;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}

export async function updateEntryTemplateConfig(
	host: SettingsUpdaterHost,
	config: EntryTemplateConfig,
): Promise<void> {
	const nextConfig = normalizeEntryTemplateConfig(config);
	if (
		areEntryTemplateConfigsEqual(
			host.settings.entryTemplateConfig,
			nextConfig,
		)
	) {
		return;
	}

	host.settings.entryTemplateConfig = nextConfig;
	await host.saveSettings();
	host.applySettingsToOpenViews();
}
