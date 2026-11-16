/**
 * 任务笔记「打开」的共享能力（[[Plan-20261116-155634]] §5.2）。
 *
 * 只负责「以某种模式打开任务笔记」与「把光标落到正文偏移」；视图状态
 * （`openingTaskPath` / `openedTaskPath` / 最近打开记忆 / 重绘）留在各调用方。
 */

import {
	MarkdownView,
	type App,
	type TFile,
	type WorkspaceLeaf,
} from 'obsidian';

import { resolveCursorMarkerSearchStart } from '../../tasks-center/cursor-marker';
import { isTaskNoteFile } from '../../tasks-center/task-note-menu';
import { IOTO_TASK_VIEW_TYPE } from '../iotoTaskView';

export type TaskNoteOpenMode = 'source' | 'task-view' | 'default';

export interface TaskNoteOpenInput {
	hasSearchQuery: boolean;
	hasLine: boolean;
	cursorOffset: number | null;
	preferTaskView: boolean;
	isTaskNote: boolean;
}

/**
 * 打开模式判定：
 * - 有搜索词 / 指定行 / `%%Cursor%%` 偏移 → `source`（滚动与落光标依赖 CodeMirror）；
 * - 偏好任务视图且是任务笔记 → `task-view`；
 * - 其余 → `default`。
 */
export function resolveTaskNoteOpenMode(
	input: TaskNoteOpenInput,
): TaskNoteOpenMode {
	if (
		input.hasSearchQuery ||
		input.hasLine ||
		typeof input.cursorOffset === 'number'
	) {
		return 'source';
	}
	if (input.preferTaskView && input.isTaskNote) {
		return 'task-view';
	}
	return 'default';
}

export async function openTaskNoteInLeaf(
	leaf: WorkspaceLeaf,
	file: TFile,
	mode: TaskNoteOpenMode,
): Promise<void> {
	switch (mode) {
		case 'source':
			await leaf.setViewState({
				type: 'markdown',
				active: true,
				state: {
					file: file.path,
					mode: 'source',
				},
			});
			return;
		case 'task-view':
			await leaf.setViewState({
				type: IOTO_TASK_VIEW_TYPE,
				active: true,
				state: {
					file: file.path,
				},
			});
			return;
		case 'default':
			await leaf.openFile(file, {
				active: true,
			});
	}
}

/**
 * 把预览叶子切到源码模式并把光标落到正文指定偏移。
 *
 * `bodyOffset` 是相对正文起始（frontmatter 之后）的偏移；打开时用当前内容的
 * frontmatter 长度折算成绝对位置，因此创建后 frontmatter 再变长也不会漂移。
 */
export async function focusTaskNoteEditorAtOffset(
	app: App,
	leaf: WorkspaceLeaf,
	file: TFile,
	bodyOffset: number,
): Promise<void> {
	try {
		let leafView: MarkdownView | null =
			leaf.view instanceof MarkdownView ? leaf.view : null;
		const needsSourceMode =
			!leafView ||
			leafView.file?.path !== file.path ||
			leafView.getMode() !== 'source';
		if (needsSourceMode) {
			await leaf.setViewState({
				type: 'markdown',
				active: true,
				state: {
					file: file.path,
					mode: 'source',
				},
			});
			leafView = leaf.view instanceof MarkdownView ? leaf.view : null;
		}

		if (!leafView || leafView.file?.path !== file.path) {
			return;
		}

		app.workspace.setActiveLeaf(leaf, { focus: true });
		const editor = leafView.editor;
		const content = editor.getValue();
		const absoluteOffset =
			resolveCursorMarkerSearchStart(content) + bodyOffset;
		const clampedOffset = Math.max(
			0,
			Math.min(absoluteOffset, content.length),
		);
		const position = editor.offsetToPos(clampedOffset);
		editor.setCursor(position);
		editor.scrollIntoView({ from: position, to: position }, true);
		editor.focus();
	} catch {
		// 标记已在创建阶段被剥离，聚焦失败不应影响创建流程。
	}
}

export interface OpenCreatedTaskNoteOptions {
	tasksRootPath: string;
	preferTaskView: boolean;
	cursorOffset: number | null;
}

/** 创建任务后的开箱即用入口：判定模式 + 打开 + 可选落光标。 */
export async function openCreatedTaskNote(
	app: App,
	leaf: WorkspaceLeaf,
	file: TFile,
	options: OpenCreatedTaskNoteOptions,
): Promise<void> {
	const mode = resolveTaskNoteOpenMode({
		hasSearchQuery: false,
		hasLine: false,
		cursorOffset: options.cursorOffset,
		preferTaskView: options.preferTaskView,
		isTaskNote: isTaskNoteFile(file, options.tasksRootPath),
	});
	await openTaskNoteInLeaf(leaf, file, mode);
	if (typeof options.cursorOffset === 'number') {
		await focusTaskNoteEditorAtOffset(
			app,
			leaf,
			file,
			options.cursorOffset,
		);
	}
}
