import {
	MarkdownView,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type {
	IncompleteChecklistItem,
	ProjectFolderEntry,
	TaskFileEntry,
} from '../../tasks-center/types';
import { shouldSkipOpeningTask } from '../task-preview-state';
import { isTaskNoteFile } from '../../tasks-center/task-note-menu';
import { IOTO_TASK_VIEW_TYPE } from '../iotoTaskView';
import { resolveCursorMarkerSearchStart } from '../../tasks-center/cursor-marker';
import { PROJECT_METADATA_FILE_NAME } from '../../tasks-center/project-metadata';
import { type TaskOpenTarget } from './constants';

export async function openTaskFile(
	view: IOTOTasksCenterView,
	task: TaskFileEntry,
	options?: {
		target?: TaskOpenTarget;
	},
): Promise<void> {
	const target = options?.target ?? 'adjacent-preview';
	if (target === 'current-pane-tab') {
		const file = view.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			return;
		}

		await openFileInCurrentPaneTab(view, file);
		return;
	}

	const previewLeafAvailable = Boolean(
		view.previewLeaf && view.isLeafAvailable(view.previewLeaf),
	);
	const previewedFilePath = view.getPreviewLeafFilePath();
	if (
		shouldSkipOpeningTask({
			targetTaskPath: task.path,
			openedTaskPath: view.openedTaskPath,
			previewLeafAvailable,
			previewedFilePath,
		})
	) {
		view.activatePreviewLeaf();
		return;
	}

	const file = view.app.vault.getAbstractFileByPath(task.path);
	if (!(file instanceof TFile)) {
		return;
	}

	await openFileInPreview(view, file);
}

export async function openTaskFileAtChecklist(
	view: IOTOTasksCenterView,
	taskPath: string,
	item: IncompleteChecklistItem,
): Promise<void> {
	const file = view.app.vault.getAbstractFileByPath(taskPath);
	if (!(file instanceof TFile)) {
		return;
	}

	view.openingTaskPath = file.path;
	view.render();

	try {
		const leaf = view.ensurePreviewLeaf();
		await leaf.setViewState({
			type: 'markdown',
			active: true,
			state: {
				file: file.path,
				mode: 'source',
			},
		});
		view.previewLeaf = leaf;
		view.openedTaskPath = file.path;
		if (view.selectedProject) {
			view.lastOpenedTaskByProject.set(
				view.selectedProject,
				file.path,
			);
		}

		view.app.workspace.setActiveLeaf(leaf, { focus: true });
		const leafView = leaf.view;
		if (
			!(leafView instanceof MarkdownView) ||
			leafView.file?.path !== file.path
		) {
			return;
		}

		const editor = leafView.editor;
		const lastLine = editor.lastLine();
		const line = Math.max(0, Math.min(item.line, lastLine));
		const lineText = editor.getLine(line);
		const startCh = Math.max(
			0,
			Math.min(item.selectionStartCh, lineText.length),
		);
		const fallbackEndCh = lineText.trimEnd().length;
		const endCh = Math.max(
			startCh,
			Math.min(
				Math.max(item.selectionEndCh, fallbackEndCh),
				lineText.length,
			),
		);

		editor.setSelection({ line, ch: startCh }, { line, ch: endCh });
		editor.focus();
	} catch {
		await openFileInPreview(view, file);
	} finally {
		view.openingTaskPath = null;
		view.render();
	}
}

export async function openOutlinkFileInPreview(
	view: IOTOTasksCenterView,
	file: TFile,
): Promise<void> {
	const leaf = view.ensurePreviewLeaf();
	await leaf.openFile(file, {
		active: true,
	});
	view.previewLeaf = leaf;
}

export async function openProjectSpecByProject(
	view: IOTOTasksCenterView,
	project: ProjectFolderEntry,
): Promise<void> {
	const filePath = `${project.path}/${PROJECT_METADATA_FILE_NAME}`;
	const abstractFile = view.app.vault.getAbstractFileByPath(filePath);
	const file =
		abstractFile instanceof TFile
			? abstractFile
			: await view.app.vault.create(
					filePath,
					'---\nIOTOProject:\n---\n',
				);
	const leaf = view.ensurePreviewLeaf();
	await leaf.openFile(file, { active: true });
}

export async function openFileInPreview(
	view: IOTOTasksCenterView,
	file: TFile,
	options?: { cursorOffset?: number | null },
): Promise<void> {
	view.openingTaskPath = file.path;
	view.render();

	try {
		const leaf = view.ensurePreviewLeaf();
		const query = view.taskSearchQuery.trim();
		const cursorOffset = options?.cursorOffset;
		const hasCursorOffset = typeof cursorOffset === 'number';
		if (query) {
			await leaf.setViewState({
				type: 'markdown',
				active: true,
				state: {
					file: file.path,
					mode: 'source',
				},
			});
		} else if (
			view.getUseIOTOTaskViewAsDefault() &&
			!hasCursorOffset &&
			isTaskNoteFile(file, view.getTasksRootPath())
		) {
			// 任务笔记「打开即任务视图」；受 useIOTOTaskViewAsDefault 设置门控，
			// 带搜索词或光标标记时仍走 markdown，
			// 因为滚动到命中与落光标都依赖 MarkdownView 的 CodeMirror。
			await leaf.setViewState({
				type: IOTO_TASK_VIEW_TYPE,
				active: true,
				state: {
					file: file.path,
				},
			});
		} else {
			await leaf.openFile(file, {
				active: true,
			});
		}
		view.previewLeaf = leaf;
		view.openedTaskPath = file.path;
		if (view.selectedProject) {
			view.lastOpenedTaskByProject.set(
				view.selectedProject,
				file.path,
			);
		}

		if (query) {
			await scrollPreviewToFirstMatch(view, leaf, file, query);
		}

		if (hasCursorOffset) {
			await focusPreviewEditorAtOffset(
				view,
				leaf,
				file,
				cursorOffset,
			);
		}
	} finally {
		view.openingTaskPath = null;
		view.render();
	}
}

export function findReusablePreviewLeaf(
	view: IOTOTasksCenterView,
): WorkspaceLeaf | null {
	if (view.openedTaskPath) {
		const openedFileLeaf = view.findLeafByFilePath(view.openedTaskPath);
		if (openedFileLeaf && openedFileLeaf !== view.leaf) {
			return openedFileLeaf;
		}
	}

	return null;
}

/**
 * 把预览叶子切到源码模式并把光标落到正文指定偏移。
 *
 * `bodyOffset` 是相对正文起始（frontmatter 之后）的偏移；打开时用当前内容的
 * frontmatter 长度折算成绝对位置，因此创建后 frontmatter 再变长也不会漂移。
 * 仅在创建任务笔记命中 `%%Cursor%%` 且该文件会留给用户时调用；无标记时
 * 完全不触发，因此默认打开模式不受影响（见方案 §3.5、§5.3）。
 */
async function focusPreviewEditorAtOffset(
	view: IOTOTasksCenterView,
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

		view.app.workspace.setActiveLeaf(leaf, { focus: true });
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

async function openFileInCurrentPaneTab(
	view: IOTOTasksCenterView,
	file: TFile,
): Promise<void> {
	const existingLeaf = findLeafInCurrentTabGroupByFilePath(
		view,
		file.path,
	);
	if (existingLeaf) {
		view.openedTaskPath = file.path;
		if (view.selectedProject) {
			view.lastOpenedTaskByProject.set(
				view.selectedProject,
				file.path,
			);
		}
		view.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		return;
	}

	view.openingTaskPath = file.path;
	view.render();

	try {
		const leaf = view.app.workspace.getLeaf('tab');
		await leaf.openFile(file, {
			active: true,
		});
		view.openedTaskPath = file.path;
		if (view.selectedProject) {
			view.lastOpenedTaskByProject.set(
				view.selectedProject,
				file.path,
			);
		}

		view.app.workspace.setActiveLeaf(leaf, { focus: true });
	} finally {
		view.openingTaskPath = null;
		view.render();
	}
}

function findLeafInCurrentTabGroupByFilePath(
	view: IOTOTasksCenterView,
	filePath: string,
): WorkspaceLeaf | null {
	const currentTabs = view.leaf.parent;
	let matchedLeaf: WorkspaceLeaf | null = null;

	view.app.workspace.iterateAllLeaves((leaf) => {
		if (
			matchedLeaf ||
			leaf === view.leaf ||
			leaf.parent !== currentTabs
		) {
			return;
		}

		const viewState = leaf.getViewState();
		if (viewState.type !== 'markdown') {
			return;
		}

		const candidatePath = viewState.state?.file;
		if (
			typeof candidatePath === 'string' &&
			candidatePath === filePath
		) {
			matchedLeaf = leaf;
		}
	});

	return matchedLeaf;
}

async function scrollPreviewToFirstMatch(
	view: IOTOTasksCenterView,
	leaf: WorkspaceLeaf,
	file: TFile,
	query: string,
): Promise<void> {
	const leafView = leaf.view;
	if (!(leafView instanceof MarkdownView) || leafView.file?.path !== file.path) {
		return;
	}

	const editor = leafView.editor;
	const normalizedQuery = query.toLocaleLowerCase();
	const lineCount = editor.lineCount();
	for (let line = 0; line < lineCount; line++) {
		const lineText = editor.getLine(line);
		const ch = lineText.toLocaleLowerCase().indexOf(normalizedQuery);
		if (ch !== -1) {
			const from = { line, ch };
			const to = { line, ch: ch + query.length };
			editor.setSelection(from, to);
			editor.scrollIntoView({ from, to }, true);
			editor.focus();
			return;
		}
	}
}
