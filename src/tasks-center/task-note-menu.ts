import { Menu, Notice, TAbstractFile, TFile, type App } from 'obsidian';
import { t, type TranslationKey } from '../lang/helpter';
import { formatPriorityMenuTitle } from '../views/tasks-center/helpers';
import { isPathInsideRoot } from './task-path';
import {
	TASK_PRIORITY_VALUES,
	clearTaskFilePriority,
	setTaskFilePriority,
} from './task-priority';
import { clearTaskFileStarred, setTaskFileStarred } from './task-starred';

export interface TaskNoteMenuVisibility {
	showCore: boolean;
	showPriority: boolean;
}

export function isTaskNoteFile(
	file: TAbstractFile,
	tasksRootPath: string,
): file is TFile {
	return (
		file instanceof TFile &&
		file.extension === 'md' &&
		isPathInsideRoot(file.path, tasksRootPath)
	);
}

/**
 * 往 Obsidian `file-menu` 传入的菜单里追加「核心任务与优先级」子菜单。
 * 该事件同时覆盖文件列表右键/长按、标签页右键、笔记标题栏 ⋯ 菜单与内部链接右键，
 * 因此打开任务笔记后不必再回任务中心改属性。
 */
export function buildTaskNoteMenu(options: {
	app: App;
	file: TFile;
	menu: Menu;
	settings: TaskNoteMenuVisibility;
	starred: boolean;
	priority?: number;
}): void {
	const { menu, settings } = options;
	if (!settings.showCore && !settings.showPriority) {
		return;
	}

	let flattenToParentMenu = false;

	menu.addItem((item) => {
		item.setTitle(resolveTaskNoteMenuTitle(settings));

		// 老版本 Obsidian 没有 setSubmenu，降级为把条目平铺到父菜单。
		if (typeof item.setSubmenu !== 'function') {
			flattenToParentMenu = true;
			item.setDisabled(true);
			return;
		}

		try {
			appendTaskNoteMenuItems(options, item.setSubmenu());
		} catch {
			flattenToParentMenu = true;
			item.setDisabled(true);
		}
	});

	if (flattenToParentMenu) {
		appendTaskNoteMenuItems(options, menu);
	}
}

function resolveTaskNoteMenuTitle(settings: TaskNoteMenuVisibility): string {
	if (settings.showCore && settings.showPriority) {
		return t('view.taskNoteMenu.title.coreAndPriority');
	}

	return settings.showCore
		? t('view.taskNoteMenu.title.core')
		: t('view.taskNoteMenu.title.priority');
}

function appendTaskNoteMenuItems(
	options: {
		app: App;
		file: TFile;
		settings: TaskNoteMenuVisibility;
		starred: boolean;
		priority?: number;
	},
	target: Menu,
): void {
	const { app, file, settings, starred, priority } = options;

	// 菜单项点击后立即把整棵菜单（含子菜单）关掉，等菜单完全关闭、触发源（笔记标题栏
	// 的「⋯」按钮）的选中态被清除后，再把写入延后执行。否则写入会同步触发 vault 的
	// modify 事件，使任务中心列表（或正在编辑的笔记）立即重渲染并销毁作为菜单锚点的
	// 行元素，导致菜单浮层无法正常卸载，标题栏「⋯」陷入无法再次点击的选中状态。
	function triggerTaskNoteAction(
		action: (app: App, file: TFile) => Promise<void>,
		errorNoticeKey: TranslationKey,
	): void {
		if (typeof target.hide === 'function') {
			target.hide();
		}
		scheduleTaskNoteAction(() =>
			runTaskNoteAction(app, file, action, errorNoticeKey),
		);
	}

	if (settings.showCore) {
		target.addItem((item) =>
			item
				.setTitle(
					starred
						? t('view.taskCoreMenu.clear')
						: t('view.taskCoreMenu.set'),
				)
				.onClick(() => {
					triggerTaskNoteAction(
						starred
							? clearTaskFileStarred
							: setTaskFileStarred,
						starred
							? 'view.notice.clearTaskCoreFailed'
							: 'view.notice.updateTaskCoreFailed',
					);
				}),
		);
	}

	if (settings.showCore && settings.showPriority) {
		target.addSeparator();
	}

	if (!settings.showPriority) {
		return;
	}

	if (typeof priority === 'number') {
		target.addItem((item) =>
			item.setTitle(t('view.taskPriorityMenu.clear')).onClick(() => {
				triggerTaskNoteAction(
					clearTaskFilePriority,
					'view.notice.clearTaskPriorityFailed',
				);
			}),
		);
		target.addSeparator();
	}

	for (const priorityValue of TASK_PRIORITY_VALUES) {
		target.addItem((item) =>
			item
				.setTitle(
					formatPriorityMenuTitle(priorityValue, priority === priorityValue),
				)
				.onClick(() => {
					triggerTaskNoteAction(
						(taskApp, taskFile) =>
							setTaskFilePriority(taskApp, taskFile, priorityValue),
						'view.notice.updateTaskPriorityFailed',
					);
				}),
		);
	}
}

async function runTaskNoteAction(
	app: App,
	file: TFile,
	action: (app: App, file: TFile) => Promise<void>,
	errorNoticeKey: TranslationKey,
): Promise<void> {
	try {
		await action(app, file);
	} catch (error) {
		const message = error instanceof Error ? error.message : t(errorNoticeKey);
		new Notice(message);
	}
}

// 菜单项点击回调里直接对“当前正在打开的笔记”做 vault 写入会让 Obsidian 在菜单关闭
// 动画/视图销毁尚未完成时就把文件重新加载，导致标题栏的“⋯”按钮（文件菜单触发源）陷入
// 无法再次点击的状态。把写入延后到菜单完全关闭之后执行即可规避。
const MENU_ACTION_DEFER_DELAY_MS = 50;

function scheduleTaskNoteAction(run: () => Promise<void>): void {
	window.setTimeout(() => {
		void run();
	}, MENU_ACTION_DEFER_DELAY_MS);
}
