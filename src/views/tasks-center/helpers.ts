import { t } from '../../lang/helpter';
import type { TaskCreationType } from '../../tasks-center/task-template-config';

export function getTaskCreationOptions(): Array<{
	key: TaskCreationType;
	label: string;
}> {
	return [
		{ key: 'normal', label: t('task.type.normal') },
		{ key: 'date', label: t('task.type.date') },
		{ key: 'topic', label: t('task.type.topic') },
		{ key: 'plan', label: t('task.type.plan') },
	];
}

export function buildProjectGroupBodyId(groupKey: string): string {
	const safeKey = encodeURIComponent(groupKey || 'uncategorized').replace(
		/%/g,
		'_',
	);
	return `ioto-tasks-center-project-group-${safeKey}`;
}

export function getTaskPriorityVisibilityOptions() {
	return [
		{ show: true, label: t('menu.priority.show') },
		{ show: false, label: t('menu.priority.hide') },
	] as const;
}

export function formatPriorityMenuTitle(priority: number, active: boolean): string {
	const label = `P${priority}`;
	return active
		? `${label}${t('view.taskPriorityMenu.currentSuffix')}`
		: label;
}

export function formatMenuOptionTitle(
	category: string,
	label: string,
	active: boolean,
): string {
	return active
		? `${category}: ${label}${t('menu.currentSuffix')}`
		: `${category}: ${label}`;
}

export function getTaskPriorityClassName(priority: number): string {
	if (priority === 0) {
		return 'ioto-tasks-center__task-priority--p0';
	}

	if (priority === 1) {
		return 'ioto-tasks-center__task-priority--p1';
	}

	if (priority === 2) {
		return 'ioto-tasks-center__task-priority--p2';
	}

	return 'ioto-tasks-center__task-priority--p3-plus';
}

export function toggleSetMember(
	set: Set<string>,
	key: string,
): void {
	if (set.has(key)) {
		set.delete(key);
	} else {
		set.add(key);
	}
}
