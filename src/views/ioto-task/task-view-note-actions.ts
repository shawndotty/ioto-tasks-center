/**
 * 任务视图「空白处右键」菜单的**笔记级**动作（[[Plan-20261103-103716]] §四.C3）。
 *
 * 作用对象是当前任务笔记（`view.file`）的 frontmatter，不是某一行：因此不复用
 * 任务行写盘（`commitBlockRange`），而是「整篇属性写 + 六步收尾」。
 */

import { Notice } from 'obsidian';

import { t, type TranslationKey } from '../../lang/helpter';
import { readBooleanProperty } from '../../tasks-center/frontmatter-properties';
import { isTaskNoteFile } from '../../tasks-center/task-note-menu';
import {
	type TaskPriorityValue,
	clearTaskFilePriority,
	setTaskFilePriority,
} from '../../tasks-center/task-priority';
import {
	clearTaskFileStarred,
	setTaskFileStarred,
} from '../../tasks-center/task-starred';
import { trashTaskFile } from '../../tasks-center/task-deletion';
import { ConfirmModal } from '../../ui/confirmModal';
import type { TaskViewHost } from './task-view-host';
import { shiftTrackedLines } from './task-view-filters';

/**
 * 六步写盘（[[Research-20261103-100910]] §4.4）：
 * ① 落盘在册编辑器 → ② 原子写 → ③ 行号平移 → ④ 🔴 data / lastLoadedText 同步
 * → ⑤ 整树重绘 → ⑥ Notice。
 */
async function applyNoteWrite(
	view: TaskViewHost,
	write: () => Promise<string>,
	successNotice: string,
	errorNoticeKey: TranslationKey,
): Promise<void> {
	if (!view.file) return;
	try {
		// ① 先落盘：改 frontmatter 会在文件头部插入 / 删除行，未提交的正文会错位
		await view.flushInlineEdits();
		const oldContent = view.data ?? '';
		const newContent = await write();

		if (newContent === oldContent) {
			// 幂等（如重复点同一档优先级）：不重绘，但仍给反馈
			new Notice(successNotice);
			return;
		}

		// ③ frontmatter 行数变化 → 平移选中行等跟踪态（同 toggleFilter / togglePrimarySection）
		const delta =
			newContent.split('\n').length - oldContent.split('\n').length;
		if (delta !== 0) {
			shiftTrackedLines(view, delta, oldContent, newContent);
		}

		// ④ 🔴 红线：两者一起同步，否则 TextFileView 回写旧字节；
		//    也正因为相等，紧随其后的 modify → reloadFromVault 会直接早退（不闪、不重入）
		view.data = newContent;
		view.lastLoadedText = newContent;
		view.renderNote(view.data);

		// ⑥ 任务视图不显示 P{n}/⭐，Notice 是唯一反馈
		new Notice(successNotice);
	} catch (error) {
		new Notice(
			error instanceof Error ? error.message : t(errorNoticeKey),
		);
	}
}

export async function setNotePriority(
	view: TaskViewHost,
	priority: TaskPriorityValue,
): Promise<void> {
	const file = view.file;
	if (!file) return;
	await applyNoteWrite(
		view,
		() => setTaskFilePriority(view.app, file, priority),
		t('notice.iotoTaskView.notePrioritySet', [`P${priority}`]),
		'view.notice.updateTaskPriorityFailed',
	);
}

export async function clearNotePriority(view: TaskViewHost): Promise<void> {
	const file = view.file;
	if (!file) return;
	await applyNoteWrite(
		view,
		() => clearTaskFilePriority(view.app, file),
		t('notice.iotoTaskView.notePriorityCleared'),
		'view.notice.clearTaskPriorityFailed',
	);
}

export async function toggleNoteStarred(view: TaskViewHost): Promise<void> {
	const file = view.file;
	if (!file) return;
	// 二态判据在写盘前从**当前** data 现读（直读 frontmatter 叶子模块：
	// 不 import `task-view-note-context-menu` 的 `readNoteStarred`，否则成值级环）
	const starred = readBooleanProperty(view.data ?? '', 'Starred');
	await applyNoteWrite(
		view,
		() =>
			starred
				? clearTaskFileStarred(view.app, file)
				: setTaskFileStarred(view.app, file),
		starred
			? t('notice.iotoTaskView.noteStarredCleared')
			: t('notice.iotoTaskView.noteStarredSet'),
		starred
			? 'view.notice.clearTaskCoreFailed'
			: 'view.notice.updateTaskCoreFailed',
	);
}

export async function deleteCurrentTask(view: TaskViewHost): Promise<void> {
	const file = view.file;
	if (!file) return;
	// 防御第二道门：菜单项已按同一判据置灰，这里再挡一次（setViewState 能打开根目录外的笔记）
	if (
		!isTaskNoteFile(
			file,
			view.taskFileLinkPolicyProvider().tasksRootPath,
		)
	) {
		new Notice(t('view.notice.taskFileUnavailable'));
		return;
	}

	// 确认框会抢焦点触发 blur 提交，前后各幂等 flush 一次（同 deleteSection 口径）
	await view.flushInlineEdits();
	const confirmed = await new ConfirmModal(
		view.app,
		t('modal.deleteTask.title'),
		{
			descriptionText: t('modal.deleteTask.desc', [file.basename]),
			confirmButtonText: t('modal.deleteTask.confirm'),
			cancelButtonText: t('modal.cancel'),
		},
	).openAndConfirm();
	if (!confirmed) return;
	await view.flushInlineEdits();

	try {
		await trashTaskFile(view.app, file);
		// 不渲染、不关叶子：核心会随文件删除自动关闭本视图（Research §3.7 实测 2 → 1）
	} catch (error) {
		new Notice(
			error instanceof Error
				? error.message
				: t('view.notice.deleteTaskFailed'),
		);
	}
}
