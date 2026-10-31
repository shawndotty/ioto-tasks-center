import { Menu } from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { t } from '../../lang/helpter';
import { TASK_PRIORITY_VALUES } from '../../tasks-center/task-priority';
import {
	batchClearPriority,
	batchRemoveUpTask,
	batchSetPriority,
	batchSetStarred,
	confirmAndBatchDeleteTasks,
} from './batch-edit-operations';
import { formatPriorityMenuTitle } from './helpers';
import { runAfterMenuCloses, showBatchAssignUpTaskModal } from './menus';

/**
 * 批量栏的下拉菜单。集中在一处的原因：
 *  - 桌面端是「优先级 / 核心 / 上级」三个下拉，窄栏是「操作 ▾」一个总菜单，
 *    后者只是前者的并集，复用同一批条目构造器可避免两套文案与顺序漂移；
 *  - 所有条目统一走 `runAfterMenuCloses`（移动端菜单点按穿透的唯一修法，
 *    成因见 `menus.ts` 顶部注释）。
 *
 * 菜单项一律不设图标：Obsidian 在 macOS 走原生菜单会丢弃图标，只给部分项加图标
 * 会在 Windows 上出现孤立的图标项（同 `menus.ts` 里 rename 处的说明）。
 */

function showMenuAt(
	menu: Menu,
	view: IOTOTasksCenterView,
	event?: MouseEvent,
): void {
	if (event) {
		menu.showAtMouseEvent(event);
		return;
	}

	// 键盘触发（无鼠标坐标）时回落到视图顶部中央。
	const rect = view.containerEl.getBoundingClientRect();
	menu.showAtPosition({
		x: rect.left + rect.width / 2,
		y: rect.top + 40,
	});
}

/** 分组标题：只作提示，不承载操作（原生菜单下的样式不受控，退化也不影响功能）。 */
function addGroupLabel(menu: Menu, title: string): void {
	menu.addItem((item) => item.setTitle(title).setIsLabel(true));
}

function addPriorityItems(menu: Menu, view: IOTOTasksCenterView): void {
	for (const priority of TASK_PRIORITY_VALUES) {
		menu.addItem((item) =>
			item
				.setTitle(formatPriorityMenuTitle(priority, false))
				.onClick(() => {
					runAfterMenuCloses(menu, () => {
						void batchSetPriority(view, priority);
					});
				}),
		);
	}
	menu.addSeparator();
	menu.addItem((item) =>
		item.setTitle(t('view.batchBar.clearPriority')).onClick(() => {
			runAfterMenuCloses(menu, () => {
				void batchClearPriority(view);
			});
		}),
	);
}

function addStarredItems(menu: Menu, view: IOTOTasksCenterView): void {
	menu.addItem((item) =>
		item.setTitle(t('view.batchBar.setStarred')).onClick(() => {
			runAfterMenuCloses(menu, () => {
				void batchSetStarred(view, true);
			});
		}),
	);
	menu.addItem((item) =>
		item.setTitle(t('view.batchBar.clearStarred')).onClick(() => {
			runAfterMenuCloses(menu, () => {
				void batchSetStarred(view, false);
			});
		}),
	);
}

function addUpTaskItems(menu: Menu, view: IOTOTasksCenterView): void {
	menu.addItem((item) =>
		item.setTitle(t('view.batchBar.assignUpTask')).onClick(() => {
			runAfterMenuCloses(menu, () => {
				void showBatchAssignUpTaskModal(view);
			});
		}),
	);
	menu.addItem((item) =>
		item.setTitle(t('view.batchBar.removeUpTask')).onClick(() => {
			runAfterMenuCloses(menu, () => {
				void batchRemoveUpTask(view);
			});
		}),
	);
}

export function showBatchPriorityMenu(
	view: IOTOTasksCenterView,
	event?: MouseEvent,
): void {
	const menu = new Menu();
	addPriorityItems(menu, view);
	showMenuAt(menu, view, event);
}

export function showBatchStarredMenu(
	view: IOTOTasksCenterView,
	event?: MouseEvent,
): void {
	const menu = new Menu();
	addStarredItems(menu, view);
	showMenuAt(menu, view, event);
}

export function showBatchUpTaskMenu(
	view: IOTOTasksCenterView,
	event?: MouseEvent,
): void {
	const menu = new Menu();
	addUpTaskItems(menu, view);
	showMenuAt(menu, view, event);
}

/** 窄栏「操作 ▾」：属性区三组 + 危险的删除项并成一个菜单（删除项放最末）。 */
export function showBatchActionsMenu(
	view: IOTOTasksCenterView,
	event?: MouseEvent,
): void {
	const menu = new Menu();

	addGroupLabel(menu, t('view.batchBar.menuPriority'));
	addPriorityItems(menu, view);
	menu.addSeparator();

	addGroupLabel(menu, t('view.batchBar.menuStarred'));
	addStarredItems(menu, view);
	menu.addSeparator();

	addGroupLabel(menu, t('view.batchBar.menuUpTask'));
	addUpTaskItems(menu, view);
	menu.addSeparator();

	addGroupLabel(menu, t('view.batchBar.delete'));
	// Menu 不支持给单项着色，删除的「危险性」由文案（所选任务）+ 既有二次确认兜底。
	menu.addItem((item) =>
		item.setTitle(t('view.batchBar.menuDelete')).onClick(() => {
			runAfterMenuCloses(menu, () => {
				void confirmAndBatchDeleteTasks(view);
			});
		}),
	);

	showMenuAt(menu, view, event);
}
