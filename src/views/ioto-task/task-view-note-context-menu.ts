/**
 * 任务视图「空白处右键」的**笔记级**菜单（[[Plan-20261103-103716]]）。
 *
 * 与卡片菜单（`render-card-context-menu.ts`）刻意不同：
 * - 作用对象是**当前任务笔记**（`view.file`），不是某一行；
 * - 命中判定是「一刀切掉整棵卡片」，不是白名单排除交互控件。
 *
 * 三块职责分离：纯菜单构造 / 命中判定（都可单测）+ 挂载与快照读取（吃 `TaskViewHost`）。
 */

import { Menu } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	readBooleanProperty,
	readScalarProperty,
} from '../../tasks-center/frontmatter-properties';
import { isTaskNoteFile } from '../../tasks-center/task-note-menu';
import {
	TASK_PRIORITY_VALUES,
	isTaskPriorityValue,
	type TaskPriorityValue,
} from '../../tasks-center/task-priority';
import { formatPriorityMenuTitle } from '../tasks-center/helpers';
import { IOTO_TASK_CARD_SELECTOR } from './ioto-task-scroll';
import type { TaskViewHost } from './task-view-host';
import {
	clearNotePriority,
	deleteCurrentTask,
	setNotePriority,
	toggleNoteStarred,
} from './task-view-note-actions';

// 与两处既有菜单同一延迟口径（视图写入会触发 modify → 重绘，锚点元素被销毁前
// 必须让本次点按完整结束）。
const MENU_ACTION_DEFER_DELAY_MS = 50;

export interface NoteContextMenuOptions {
	starred: boolean;
	priority: TaskPriorityValue | null;
	/** 仅任务根目录内的 `.md` 为真；false → 「删除当前任务」置灰 */
	canDelete: boolean;
	/** 有可折叠 Section（= `view.canToggleAllSectionFolds()`）才出第一项 */
	hasSections: boolean;
	/** 有续写区（= `view.canToggleAllContinuationFolds()`）才出第二项 */
	hasContinuations: boolean;
	onShowLinks: () => void;
	onSetPriority: (value: TaskPriorityValue) => void;
	onClearPriority: () => void;
	onToggleStarred: () => void;
	onToggleAllSections: () => void;
	onToggleAllContinuations: () => void;
	onDelete: () => void;
}

export function buildNoteContextMenu(
	menu: Menu,
	options: NoteContextMenuOptions,
): void {
	const defer = (run: () => void): void => {
		window.setTimeout(run, MENU_ACTION_DEFER_DELAY_MS);
	};

	// ① 显示相关链接
	menu.addItem((item) =>
		item
			.setTitle(t('view.taskMenu.showTaskLinks'))
			.setIcon('links')
			.onClick(() => defer(options.onShowLinks)),
	);
	menu.addSeparator();

	// ② 优先级（子菜单；无 setSubmenu 或抛错 → 禁用标题项 + 平铺）
	let flatten = false;
	menu.addItem((item) => {
		item.setTitle(
			options.priority === null
				? t('view.iotoTaskView.noteMenu.priority')
				: t('view.iotoTaskView.noteMenu.priorityWithValue', [
						`P${options.priority}`,
					]),
		).setIcon('flag');
		if (typeof item.setSubmenu !== 'function') {
			flatten = true;
			item.setDisabled(true);
			return;
		}
		try {
			appendPriorityItems(item.setSubmenu(), options, defer);
		} catch {
			flatten = true;
			item.setDisabled(true);
		}
	});
	if (flatten) {
		appendPriorityItems(menu, options, defer);
	}

	// ③ 核心任务（二态单条）
	menu.addItem((item) =>
		item
			.setTitle(
				options.starred
					? t('view.taskCoreMenu.clear')
					: t('view.taskCoreMenu.set'),
			)
			.setIcon(options.starred ? 'star-off' : 'star')
			.onClick(() => defer(options.onToggleStarred)),
	);

	// ④ 折叠组（[[Plan-20261103-152334]]）：两条全文件级视图动作，单独成组。
	//    🔴 两项都不可用时不画分隔线 —— 否则菜单尾部会出现两条连续分隔线。
	const foldItems: Array<{ title: string; icon: string; run: () => void }> = [];
	if (options.hasSections) {
		foldItems.push({
			title: t('command.toggleAllSectionFolds'),
			icon: 'chevrons-down-up',
			run: options.onToggleAllSections,
		});
	}
	if (options.hasContinuations) {
		foldItems.push({
			title: t('command.toggleAllContinuationFolds'),
			icon: 'fold-vertical',
			run: options.onToggleAllContinuations,
		});
	}
	if (foldItems.length > 0) {
		menu.addSeparator();
		for (const entry of foldItems) {
			menu.addItem((item) =>
				item
					.setTitle(entry.title)
					.setIcon(entry.icon)
					// 与四项旧动作同一延迟口径：Section 折叠会整树重建，
					// 续写区折叠虽不重绘，也保持一致（菜单项点击必须在菜单关闭后执行）。
					.onClick(() => defer(entry.run)),
			);
		}
	}

	// ⑤ 分隔线 + 删除当前任务（破坏性动作隔离，恒居末位）
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t('view.iotoTaskView.noteMenu.deleteNote'))
			.setIcon('trash-2')
			.setDisabled(!options.canDelete)
			.onClick(() => defer(options.onDelete)),
	);
}

function appendPriorityItems(
	target: Menu,
	options: NoteContextMenuOptions,
	defer: (run: () => void) => void,
): void {
	if (options.priority !== null) {
		target.addItem((item) =>
			item.setTitle(t('view.taskPriorityMenu.clear')).onClick(() => {
				defer(options.onClearPriority);
			}),
		);
		target.addSeparator();
	}
	for (const value of TASK_PRIORITY_VALUES) {
		target.addItem((item) =>
			item
				.setTitle(formatPriorityMenuTitle(value, options.priority === value))
				.onClick(() => defer(() => options.onSetPriority(value))),
		);
	}
}

export function shouldShowNoteContextMenu(
	target: HTMLElement | null,
): boolean {
	if (!target) return false;
	// 🔴 卡片整棵排除：卡片处理器只在认领时 stopPropagation，未认领（编辑器等）
	// 会继续冒泡到此处，不挡的话右键编辑器会冒出笔记菜单。
	if (target.closest(IOTO_TASK_CARD_SELECTOR)) return false;
	if (target.closest('button, a, input, textarea, select')) return false;
	if (target.closest('[contenteditable]')) return false;
	// 兄弟节点 / 菜单自身（防御：本监听挂在 scrollEl 上，理论上收不到）
	if (target.closest('.ioto-quick-panel')) return false;
	if (target.closest('.menu')) return false;
	return true;
}

/** 右键瞬间现读 `view.data`（不用渲染期闭包，避免连点两次属性后菜单显示旧值）。 */
export function readNotePriority(content: string): TaskPriorityValue | null {
	const raw = readScalarProperty(content, 'Priority');
	if (raw === null) return null;
	const text = raw.trim();
	if (text.length === 0) return null; // Number('') === 0，必须先挡
	const value = Number(text);
	return Number.isInteger(value) && isTaskPriorityValue(value)
		? value
		: null;
}

export function readNoteStarred(content: string): boolean {
	return readBooleanProperty(content, 'Starred');
}

export function showNoteContextMenu(
	event: MouseEvent,
	view: TaskViewHost,
): void {
	const file = view.file;
	if (!file) return;

	const content = view.data ?? '';
	const tasksRootPath = view.taskFileLinkPolicyProvider().tasksRootPath;
	const menu = new Menu();
	buildNoteContextMenu(menu, {
		starred: readNoteStarred(content),
		priority: readNotePriority(content),
		canDelete: isTaskNoteFile(file, tasksRootPath),
		hasSections: view.canToggleAllSectionFolds(),
		hasContinuations: view.canToggleAllContinuationFolds(),
		onShowLinks: () => view.openTaskLinks(file.path),
		onSetPriority: (value) => void setNotePriority(view, value),
		onClearPriority: () => void clearNotePriority(view),
		onToggleStarred: () => void toggleNoteStarred(view),
		onToggleAllSections: () => void view.toggleAllSectionFolds(),
		onToggleAllContinuations: () => void view.toggleAllContinuationFolds(),
		onDelete: () => void deleteCurrentTask(view),
	});
	menu.showAtMouseEvent(event);
}

/** 渲染收尾挂载：移动端由调用方（task-view-render）拦掉，这里不再判平台。 */
export function attachNoteContextMenu(
	scrollEl: HTMLElement,
	view: TaskViewHost,
): void {
	scrollEl.addEventListener('contextmenu', (event) => {
		if (!shouldShowNoteContextMenu(event.target as HTMLElement | null)) {
			return;
		}
		event.preventDefault();
		showNoteContextMenu(event, view);
	});
}
