import { t } from './lang/helpter';
import type {
	ProjectListGroupMode,
	ProjectListSortMode,
	TaskLinkBadgeBackgroundMode,
	TaskListGroupMode,
	TaskListSortMode,
	TaskListTimeFilter,
	TaskSearchEntryMode,
	TaskTemplateSourceMode,
	TaskViewAppearanceStyle,
	TaskViewExportWidthMode,
} from './settings-types';

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

export function getTaskViewAppearanceStyleOptions(): Record<
	TaskViewAppearanceStyle,
	string
> {
	return {
		glass: t('settings.appearanceStyle.glass'),
		modern: t('settings.appearanceStyle.modern'),
		simple: t('settings.appearanceStyle.simple'),
		card: t('settings.appearanceStyle.card'),
		morandi: t('settings.appearanceStyle.morandi'),
	};
}

export function isTaskViewAppearanceStyle(
	value: string,
): value is TaskViewAppearanceStyle {
	return (
		value === 'glass' ||
		value === 'modern' ||
		value === 'simple' ||
		value === 'card' ||
		value === 'morandi'
	);
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

export function isTaskTemplateSourceMode(
	value: string,
): value is TaskTemplateSourceMode {
	return value === 'file' || value === 'inline';
}
