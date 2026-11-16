/**
 * 新建任务后的通用属性写入（Priority / Starred）。
 *
 * 从 `task-operations.ts` 抽出为视图无关函数：任务中心与优先级四象限共用，
 * 错误文案与原有行为保持一致（[[Plan-20261116-145111]] §4.9）。
 */

import { Notice } from 'obsidian';
import type { App, TFile } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	clearTaskFilePriority,
	setTaskFilePriority,
	type TaskPriorityValue,
} from '../../tasks-center/task-priority';
import {
	clearTaskFileStarred,
	setTaskFileStarred,
} from '../../tasks-center/task-starred';

export async function applyCreatedTaskFileSettings(
	app: App,
	file: TFile,
	settings: { priority: TaskPriorityValue | null; starred: boolean },
): Promise<void> {
	try {
		if (settings.priority === null) {
			await clearTaskFilePriority(app, file);
		} else {
			await setTaskFilePriority(app, file, settings.priority);
		}
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: t('view.notice.updateTaskPriorityFailed');
		new Notice(message);
	}

	try {
		if (settings.starred) {
			await setTaskFileStarred(app, file);
		} else {
			await clearTaskFileStarred(app, file);
		}
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: t('view.notice.updateTaskCoreFailed');
		new Notice(message);
	}
}