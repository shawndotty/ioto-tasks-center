import { clampExportScale } from './export';
import {
	DEFAULT_EXPORT_IMAGE_FIXED_WIDTH,
	DEFAULT_SETTINGS,
	EXPORT_IMAGE_FIXED_WIDTH_MAX,
	EXPORT_IMAGE_FIXED_WIDTH_MIN,
	type ProjectListGroupMode,
	type ProjectListSortMode,
	type TaskLinkBadgeBackgroundMode,
	type TaskSearchEntryMode,
	type TaskViewAppearanceStyle,
	type TaskViewExportWidthMode,
} from './settings-types';
import {
	isProjectListGroupMode,
	isProjectListSortMode,
	isTaskLinkBadgeBackgroundMode,
	isTaskViewAppearanceStyle,
	isTaskViewExportWidthMode,
} from './settings-options';
import {
	normalizeInputRootPath,
	normalizeOutcomeRootPath,
	normalizeOutputRootPath,
	normalizeTasksRootPath,
} from './tasks-center/types';

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

export function normalizeTaskLinkBadgeBackgroundMode(
	value: unknown,
): TaskLinkBadgeBackgroundMode {
	return typeof value === 'string' && isTaskLinkBadgeBackgroundMode(value)
		? value
		: 'multicolor';
}

export function normalizeTaskViewAppearanceStyle(
	value: unknown,
): TaskViewAppearanceStyle {
	return typeof value === 'string' && isTaskViewAppearanceStyle(value)
		? value
		: 'glass';
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


