import {
	MarkdownView,
	TFile,
	type App,
	WorkspaceLeaf,
} from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type {
	IncompleteChecklistItem,
	ProjectFolderEntry,
	TaskFileEntry,
} from '../../tasks-center/types';
import { PROJECT_METADATA_FILE_NAME } from '../../tasks-center/project-metadata';
import { type TaskOpenTarget } from './constants';
import { openTaskInPreviewLeaf, openTaskInTab } from '../task-preview-open';

export async function openTaskFile(
	view: IOTOTasksCenterView,
	task: TaskFileEntry,
	options?: {
		target?: TaskOpenTarget;
	},
): Promise<void> {
	const target = options?.target ?? 'adjacent-preview';
	if (target === 'current-pane-tab' || target === 'right-split-tab') {
		await openTaskInTab(view, task.path, target);
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
	options?: { line?: number | null },
): Promise<void> {
	const leaf = view.ensurePreviewLeaf();
	const line = options?.line;
	await leaf.openFile(file, {
		active: true,
		// 普通笔记不强制 source 模式：`eState.line` 在 source 模式落光标、
		// 阅读模式滚动到对应区块，两种用户偏好都吃得下。
		eState: typeof line === 'number' ? { line } : undefined,
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
	options?: { cursorOffset?: number | null; line?: number | null },
): Promise<void> {
	const result = await openTaskInPreviewLeaf(view, file.path, {
		cursorOffset: options?.cursorOffset ?? null,
		line: options?.line ?? null,
		searchQuery: view.taskSearchQuery,
	});
	if (result.status !== 'opened') return;

	const query = view.taskSearchQuery.trim();
	if (query) {
		await scrollPreviewToFirstMatch(result.leaf, file, query);
	}
	if (typeof options?.line === 'number') {
		await focusPreviewEditorAtLine(view.app, result.leaf, file, options.line);
	}
	// cursorOffset 已由共享函数落点，此处不再重复。
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
 * 把预览叶子切到源码模式并把光标落到全文指定行（[[Plan-20261030-060126]] §三 S4）。
 *
 * `line` 是**全文 0 基行号（含 frontmatter）**——frontmatter 折算已在
 * `search-hit-line.ts` 的 `frontmatterLineCount` 完成，这里不做任何偏移处理。
 * 行号夹取到 `[0, lastLine]`（照 `openTaskFileAtChecklist` 先例）。
 * 定位失败按普通打开处理（静默降级，零新增文案）。
 */
async function focusPreviewEditorAtLine(
	app: App,
	leaf: WorkspaceLeaf,
	file: TFile,
	line: number,
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
		const clampedLine = Math.max(0, Math.min(line, editor.lastLine()));
		const position = { line: clampedLine, ch: 0 };
		editor.setCursor(position);
		editor.scrollIntoView({ from: position, to: position }, true);
		editor.focus();
	} catch {
		// 定位是增强不是承诺：失败 = 普通打开，不提示。
	}
}

async function scrollPreviewToFirstMatch(
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
