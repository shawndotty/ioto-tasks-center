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

	if (settings.showCore) {
		target.addItem((item) =>
			item
				.setTitle(
					starred
						? t('view.taskCoreMenu.clear')
						: t('view.taskCoreMenu.set'),
				)
				.onClick(() => {
					void runTaskNoteAction(
						app,
						file,
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
				void runTaskNoteAction(
					app,
					file,
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
					void runTaskNoteAction(
						app,
						file,
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
