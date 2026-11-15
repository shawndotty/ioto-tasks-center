/**
 * 四象限打开任务的薄封装（[[Plan-20261115-201917]] §3.6）。
 *
 * 不新增通用 helper：修饰键判定复用 `views/tasks-center/task-open-target.ts`，
 * 任务视图 / Markdown 的实际打开路径 100% 复用 `task-view-routing` 的既有导出。
 */

import { Notice, TFile, type App } from 'obsidian';

import { t } from '../../lang/helpter';
import { openFileAsIOTOTask } from '../../task-view-routing';
import { resolveTaskOpenTargetFromMouse } from '../tasks-center/task-open-target';

export async function openQuadrantTask(
	app: App,
	tasksRootPath: string,
	path: string,
	mods: MouseEvent | null,
	preferTaskView: boolean,
): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		new Notice(t('priorityQuadrant.notice.taskMissing'));
		return;
	}

	const target = mods
		? resolveTaskOpenTargetFromMouse(mods)
		: 'adjacent-preview';
	const leaf =
		target === 'right-split-tab'
			? app.workspace.getLeaf('split', 'vertical')
			: app.workspace.getLeaf(false); // adjacent-preview / current-pane-tab 都退化为当前 tab

	if (preferTaskView) {
		await openFileAsIOTOTask(app, tasksRootPath, file, leaf);
		return;
	}

	await leaf.openFile(file);
}
