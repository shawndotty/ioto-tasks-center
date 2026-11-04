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
	/** 导出进行中（= `view.isExporting`）→ 导出 / 复制两项置灰 */
	exporting: boolean;
	/** 与命令面板 `itc-insert-entry-template` 同一门禁（= `view.canInsertEntryTemplate()`） */
	canInsertEntryTemplate: boolean;
	/** 与命令面板 `itc-mark-all-tasks-done` 同一门禁（= `view.canMarkAllTasksDone()`） */
	canMarkAllTasksDone: boolean;
	onExportImage: () => void;
	onCopyImage: () => void;
	onInsertEntryTemplate: () => void;
	/** 整篇写盘：直接委派 `view.markAllTasksDone()`，**不**在这层复制写盘管线 */
	onMarkAllTasksDone: () => void;
	onSearchTasks: () => void;
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

	// ⑤ 视图动作组（[[Plan-20261103-155712]]）：五条视图级命令的单行简写入口。
	//    顺序 = 用户列举顺序；「搜索任务」压尾，让两个写盘项（插入条目模板、
	//    标记所有任务为完成）都不与「删除当前任务」相邻。
	//    🔴 置灰而非隐藏：导出锁命中时 `captureForExport` 静默返回 null，
	//    只有置灰能解释「为什么没反应」。
	const viewActions: Array<{
		title: string;
		icon: string;
		disabled?: boolean;
		run: () => void;
	}> = [
		{
			title: t('view.iotoTaskView.noteMenu.exportImage'),
			icon: 'image-down',
			disabled: options.exporting,
			run: options.onExportImage,
		},
		{
			title: t('view.iotoTaskView.noteMenu.copyImage'),
			icon: 'clipboard-copy',
			disabled: options.exporting,
			run: options.onCopyImage,
		},
	];
	// 稳定态门禁 → 隐藏（与命令面板 / 折叠组同口径）
	if (options.canInsertEntryTemplate) {
		viewActions.push({
			title: t('view.iotoTaskView.noteMenu.insertEntryTemplate'),
			icon: 'layout-template',
			run: options.onInsertEntryTemplate,
		});
	}
	// 「标记所有任务为完成」= 命令面板 `itc-mark-all-tasks-done` 的视图侧简写。
	// 门禁同源（`canMarkAllTasksDone` = 有文件 + 可内嵌编辑）：只读态下
	// `markAllTasksDone` 第一步就静默 return，出现一个「点了完全没反应」的项
	// 比不出现更糟 → 稳定态不可用即隐藏（与插入模板 / 命令面板同口径）。
	// 🔴 不做「没有未完成任务就置灰」：右键会让内联编辑器 blur，commit 是**异步**的，
	//    菜单是同步构建的，此刻 `view.data` 是中间态，任何基于内容的灰态必然说谎；
	//    已有的「当前文件没有需要标记的任务」Notice 是更诚实的兜底。
	if (options.canMarkAllTasksDone) {
		viewActions.push({
			title: t('view.iotoTaskView.noteMenu.markAllTasksDone'),
			icon: 'check',
			run: options.onMarkAllTasksDone,
		});
	}
	viewActions.push({
		title: t('view.iotoTaskView.noteMenu.searchTasks'),
		icon: 'search',
		run: options.onSearchTasks,
	});
	// 组内至少恒有 3 项 → 分隔线无条件添加（不像折叠组要判空）。
	menu.addSeparator();
	for (const entry of viewActions) {
		menu.addItem((item) =>
			item
				.setTitle(entry.title)
				.setIcon(entry.icon)
				.setDisabled(entry.disabled === true)
				// 同一条 defer 口径：导出要写盘、插入模板要开 Modal 并重绘、
				// 搜索要 rAF 聚焦（焦点必须在菜单 teardown 之后才落得住）。
				.onClick(() => defer(entry.run)),
		);
	}

	// ⑥ 分隔线 + 删除当前任务（破坏性动作隔离，恒居末位）
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
		exporting: view.isExporting,
		canInsertEntryTemplate: view.canInsertEntryTemplate(),
		canMarkAllTasksDone: view.canMarkAllTasksDone(),
		onExportImage: () => void view.exportAsImage(),
		onCopyImage: () => void view.copyImageToClipboard(),
		onInsertEntryTemplate: () => void view.insertEntryTemplate(),
		onMarkAllTasksDone: () => void view.markAllTasksDone(),
		onSearchTasks: () => view.revealSearch(),
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
