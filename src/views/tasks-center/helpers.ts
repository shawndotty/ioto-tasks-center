import type { MenuItem } from 'obsidian';

import { t } from '../../lang/helpter';
import type { ProjectFolderEntry } from '../../tasks-center/types';
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

export function getTaskHierarchyVisibilityOptions() {
	return [
		{ show: true, label: t('menu.hierarchy.show') },
		{ show: false, label: t('menu.hierarchy.hide') },
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

/**
 * 把 `selectedProject`（项目名）还原成项目条目（带 `path`）。
 *
 * `selectedProject` 恒由 `resolveSelectedProject` 从 `view.projects` 中选出，
 * 两者同源，命中即返回列表里的同一个对象。
 * 不拿含存档项目的全量列表兜底：那会让已存档项目也冒出操作菜单。
 */
export function findSelectedProjectEntry(
	projects: readonly ProjectFolderEntry[],
	selectedProject: string | null,
): ProjectFolderEntry | null {
	if (!selectedProject) {
		return null;
	}

	return projects.find((project) => project.name === selectedProject) ?? null;
}

/**
 * 菜单「当前项」修饰类：styles.css 用它把图标（对勾）排到「标题 + 计数」之后。
 * 任务筛选菜单与分类筛选菜单共用，故不带 task-filter 前缀。
 */
export const ACTIVE_MENU_ITEM_CLASS = 'ioto-tasks-center__menu-item--active';

/**
 * 给菜单当前项打标记：只加类，不碰图标、不碰点击逻辑。
 *
 * 图标由调用方自己产生（任务筛选菜单 `setIcon('check')`、分类筛选菜单
 * `setChecked(true)`），本函数只负责让 CSS 把它排到行尾；`MenuItem.dom`
 * 属非官方 API，本仓已在 `src/typings/obsidian-ex.d.ts` 显式声明。
 */
export function markActiveMenuItem(item: MenuItem): void {
	item.dom.addClass(ACTIVE_MENU_ITEM_CLASS);
}
