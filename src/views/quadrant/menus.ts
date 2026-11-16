/**
 * 四象限的精简优先级菜单（[[Plan-20261115-201917]] §3.6）。
 *
 * 只保留「取消优先级 + P0–P3」，不夹带星标 / 子任务 / 重命名 / 删除：
 * 跨项目看板上误点重命名或删除的代价太高。条目描述来自纯模型，单测直接断言。
 */

import type { Menu } from 'obsidian';

import { t } from '../../lang/helpter';
import { buildQuadrantPriorityMenuItems } from '../../tasks-center/quadrant-data';
import type { TaskPriorityValue } from '../../tasks-center/task-priority';
import { formatPriorityMenuTitle } from '../tasks-center/helpers';

// 与 `views/tasks-center/menus.ts:43` 同因：移动端点按菜单项时若同步移除浮层，
// 本次点按会穿透到下方元素，且写盘触发的 modify 会销毁锚点卡片 → 浮层卸不掉。
const MENU_ACTION_DEFER_DELAY_MS = 50;

export function runAfterMenuCloses(menu: Menu, run: () => void): void {
	window.setTimeout(() => {
		if (typeof menu.hide === 'function') {
			menu.hide();
		}
		const el = (menu as unknown as { containerEl?: HTMLElement }).containerEl;
		if (el && el.isShown()) {
			el.detach();
		}
		run();
	}, MENU_ACTION_DEFER_DELAY_MS);
}

export interface QuadrantPriorityMenuOptions {
	priority: number | undefined;
	onSelect: (priority: TaskPriorityValue | undefined) => void;
}

export function buildQuadrantPriorityMenu(
	menu: Menu,
	options: QuadrantPriorityMenuOptions,
): void {
	for (const item of buildQuadrantPriorityMenuItems(options.priority)) {
		if (item.kind === 'clear') {
			menu.addItem((menuItem) => {
				menuItem
					.setTitle(t('view.taskPriorityMenu.clear'))
					.setIcon('x')
					.onClick(() =>
						runAfterMenuCloses(menu, () =>
							options.onSelect(undefined),
						),
					);
			});
			menu.addSeparator();
			continue;
		}

		menu.addItem((menuItem) => {
			menuItem
				.setTitle(formatPriorityMenuTitle(item.value, item.active))
				.setChecked(item.active)
				.onClick(() =>
					runAfterMenuCloses(menu, () =>
						options.onSelect(item.value),
					),
				);
		});
	}
}
