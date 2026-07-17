import { Notice, TFile } from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type { TaskFileEntry } from '../../tasks-center/types';
import {
	clearTaskFilePriority,
	setTaskFilePriority,
	type TaskPriorityValue,
} from '../../tasks-center/task-priority';
import {
	clearTaskFileStarred,
	setTaskFileStarred,
} from '../../tasks-center/task-starred';
import { trashTaskFile } from '../../tasks-center/task-deletion';
import {
	assignUpTaskToFile,
	removeUpTaskFromFile,
} from '../../tasks-center/up-task-assignment';
import { t } from '../../lang/helpter';
import { ConfirmModal } from '../../ui/confirmModal';

interface BatchResult {
	ok: number;
	fail: number;
}

async function eachSelectedFile(
	view: IOTOTasksCenterView,
	action: (file: TFile, task: TaskFileEntry) => Promise<unknown>,
): Promise<BatchResult> {
	let ok = 0;
	let fail = 0;
	for (const task of view.getSelectedTasks()) {
		const file = view.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			fail++;
			continue;
		}
		try {
			await action(file, task);
			ok++;
		} catch {
			fail++;
		}
	}
	return { ok, fail };
}

function notify(
	result: BatchResult,
	doneKey: Parameters<typeof t>[0],
	failedKey: Parameters<typeof t>[0],
): void {
	if (result.fail > 0) {
		new Notice(t(failedKey, [String(result.fail)]));
		return;
	}
	new Notice(t(doneKey, [String(result.ok)]));
}

export async function batchSetPriority(
	view: IOTOTasksCenterView,
	priority: TaskPriorityValue,
): Promise<void> {
	const result = await eachSelectedFile(view, (file) =>
		setTaskFilePriority(view.app, file, priority),
	);
	await view.refreshFromVaultChange();
	notify(result, 'notice.batchEdit.priorityDone', 'notice.batchEdit.priorityFailed');
}

export async function batchClearPriority(
	view: IOTOTasksCenterView,
): Promise<void> {
	const result = await eachSelectedFile(view, (file) =>
		clearTaskFilePriority(view.app, file),
	);
	await view.refreshFromVaultChange();
	notify(result, 'notice.batchEdit.priorityDone', 'notice.batchEdit.priorityFailed');
}

export async function batchSetStarred(
	view: IOTOTasksCenterView,
	starred: boolean,
): Promise<void> {
	const result = await eachSelectedFile(view, (file) =>
		starred
			? setTaskFileStarred(view.app, file)
			: clearTaskFileStarred(view.app, file),
	);
	await view.refreshFromVaultChange();
	notify(
		result,
		'notice.batchEdit.starredDone',
		'notice.batchEdit.starredFailed',
	);
}

export async function batchAssignUpTask(
	view: IOTOTasksCenterView,
	parentTitle: string,
): Promise<void> {
	const result = await eachSelectedFile(view, (file) =>
		assignUpTaskToFile(view.app, file, parentTitle),
	);
	await view.refreshFromVaultChange();
	notify(
		result,
		'notice.batchEdit.upTaskDone',
		'notice.batchEdit.upTaskFailed',
	);
}

export async function batchRemoveUpTask(
	view: IOTOTasksCenterView,
): Promise<void> {
	const result = await eachSelectedFile(view, (file) =>
		removeUpTaskFromFile(view.app, file),
	);
	await view.refreshFromVaultChange();
	notify(
		result,
		'notice.batchEdit.removeUpTaskDone',
		'notice.batchEdit.upTaskFailed',
	);
}

export async function batchDeleteTasks(
	view: IOTOTasksCenterView,
	confirmed: boolean,
): Promise<void> {
	if (!confirmed) {
		return;
	}
	const result = await eachSelectedFile(view, (file) =>
		trashTaskFile(view.app, file),
	);
	view.selectedTaskPaths.clear();
	await view.refreshFromVaultChange();
	notify(
		result,
		'notice.batchEdit.deleteDone',
		'notice.batchEdit.deleteFailed',
	);
}

export async function confirmAndBatchDeleteTasks(
	view: IOTOTasksCenterView,
): Promise<void> {
	if (view.selectedTaskPaths.size === 0) {
		return;
	}
	const confirmed = await new ConfirmModal(
		view.app,
		t('modal.batchDelete.title'),
		{
			descriptionText: t('modal.batchDelete.desc', [
				String(view.selectedTaskPaths.size),
			]),
			confirmButtonText: t('modal.batchDelete.confirm'),
			cancelButtonText: t('modal.cancel'),
		},
	).openAndConfirm();
	await batchDeleteTasks(view, confirmed);
}
