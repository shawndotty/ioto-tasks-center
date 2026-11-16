import {
	MarkdownView,
	TFile,
	type App,
	type WorkspaceParent,
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
import { PROJECT_METADATA_FILE_NAME } from '../../tasks-center/project-metadata';
import {
	focusTaskNoteEditorAtOffset,
	openTaskNoteInLeaf,
	resolveTaskNoteOpenMode,
} from './task-note-opening';
import { type TaskOpenTarget } from './constants';
import { isLeafInSidebar } from './preview-leaf';

export async function openTaskFile(
	view: IOTOTasksCenterView,
	task: TaskFileEntry,
	options?: {
		target?: TaskOpenTarget;
	},
): Promise<void> {
	const target = options?.target ?? 'adjacent-preview';
	if (target === 'current-pane-tab' || target === 'right-split-tab') {
		const file = view.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			return;
		}

		if (target === 'current-pane-tab') {
			await openFileInCurrentPaneTab(view, file);
		} else {
			await openFileInRightSplitTab(view, file);
		}
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
	view.openingTaskPath = file.path;
	view.render();

	try {
		const leaf = view.ensurePreviewLeaf();
		const query = view.taskSearchQuery.trim();
		const cursorOffset =
			typeof options?.cursorOffset === 'number'
				? options.cursorOffset
				: null;
		const line = options?.line;
		const hasLine = typeof line === 'number';
		const mode = resolveTaskNoteOpenMode({
			hasSearchQuery: query.length > 0,
			hasLine,
			cursorOffset,
			preferTaskView: view.getUseIOTOTaskViewAsDefault(),
			isTaskNote: isTaskNoteFile(file, view.getTasksRootPath()),
		});

		await openTaskNoteInLeaf(leaf, file, mode);
		view.previewLeaf = leaf;
		view.openedTaskPath = file.path;
		if (view.selectedProject) {
			view.lastOpenedTaskByProject.set(
				view.selectedProject,
				file.path,
			);
		}

		if (query) {
			await scrollPreviewToFirstMatch(leaf, file, query);
		}

		if (cursorOffset !== null) {
			await focusTaskNoteEditorAtOffset(
				view.app,
				leaf,
				file,
				cursorOffset,
			);
		}

		if (hasLine) {
			await focusPreviewEditorAtLine(view.app, leaf, file, line);
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

async function openFileInCurrentPaneTab(
	view: IOTOTasksCenterView,
	file: TFile,
): Promise<void> {
	const tabGroup = resolveTargetTabGroup(view);
	const existingLeaf =
		tabGroup === null
			? null
			: findLeafInCurrentTabGroupByFilePath(view, file.path, tabGroup);
	if (existingLeaf) {
		markTaskOpened(view, file.path);
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
		// Alt+点击以前走核心默认视图（Markdown），现在与直接点击同口径：
		// 门控开启且是任务笔记时转成 IOTOTask 视图。
		await convertLeafToTaskViewIfDefault(view, leaf, file);
		markTaskOpened(view, file.path);

		view.app.workspace.setActiveLeaf(leaf, { focus: true });
	} finally {
		view.openingTaskPath = null;
		view.render();
	}
}

async function openFileInRightSplitTab(
	view: IOTOTasksCenterView,
	file: TFile,
): Promise<void> {
	// 同文件已打开就只激活，不重复开分屏（方案 §6-2，Johnny 确认）。
	const existingLeaf = findLeafShowingTaskFile(view, file.path);
	if (existingLeaf) {
		markTaskOpened(view, file.path);
		view.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		return;
	}

	view.openingTaskPath = file.path;
	view.render();

	try {
		// 在活动叶子（即刚被点击的任务中心叶子）右侧新建标签组。
		const leaf = view.app.workspace.getLeaf('split', 'vertical');
		await leaf.openFile(file, {
			active: true,
		});
		await convertLeafToTaskViewIfDefault(view, leaf, file);
		markTaskOpened(view, file.path);

		view.app.workspace.setActiveLeaf(leaf, { focus: true });
	} finally {
		view.openingTaskPath = null;
		view.render();
	}
}

/** 记录「该任务已打开」，供预览位状态与项目级最近打开记忆使用。 */
function markTaskOpened(
	view: IOTOTasksCenterView,
	filePath: string,
): void {
	view.openedTaskPath = filePath;
	if (view.selectedProject) {
		view.lastOpenedTaskByProject.set(view.selectedProject, filePath);
	}
}

/**
 * 门控式 TaskView 转换：Alt+点击与右侧分屏两路共用的同一口径——
 * 与 openFileInPreview 的直接点击分支一致，均受 useIOTOTaskViewAsDefault 门控。
 */
async function convertLeafToTaskViewIfDefault(
	view: IOTOTasksCenterView,
	leaf: WorkspaceLeaf,
	file: TFile,
): Promise<void> {
	if (
		!view.getUseIOTOTaskViewAsDefault() ||
		!isTaskNoteFile(file, view.getTasksRootPath()) ||
		!(leaf.view instanceof MarkdownView)
	) {
		return;
	}

	await leaf.setViewState({
		type: IOTO_TASK_VIEW_TYPE,
		active: true,
		state: {
			file: file.path,
		},
	});
}

/** 组合键打开的「已打开就激活」判据：全工作区找展示该文件的 markdown/IOTOTask 叶。 */
function findLeafShowingTaskFile(
	view: IOTOTasksCenterView,
	filePath: string,
): WorkspaceLeaf | null {
	let matchedLeaf: WorkspaceLeaf | null = null;

	view.app.workspace.iterateAllLeaves((leaf) => {
		if (matchedLeaf || leaf === view.leaf) {
			return;
		}

		const viewState = leaf.getViewState();
		if (
			viewState.type !== 'markdown' &&
			viewState.type !== IOTO_TASK_VIEW_TYPE
		) {
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

/** Alt+点击应该去哪个 tab 组找「已打开的同文件标签」。 */
function resolveTargetTabGroup(
	view: IOTOTasksCenterView,
): WorkspaceParent | null {
	const ws = view.app.workspace;
	if (!isLeafInSidebar(ws, view.leaf)) {
		return view.leaf.parent;
	}
	return ws.getMostRecentLeaf(ws.rootSplit)?.parent ?? null;
}

function findLeafInCurrentTabGroupByFilePath(
	view: IOTOTasksCenterView,
	filePath: string,
	tabGroup: WorkspaceParent,
): WorkspaceLeaf | null {
	let matchedLeaf: WorkspaceLeaf | null = null;

	view.app.workspace.iterateAllLeaves((leaf) => {
		if (
			matchedLeaf ||
			leaf === view.leaf ||
			leaf.parent !== tabGroup
		) {
			return;
		}

		const viewState = leaf.getViewState();
		// 任务笔记默认以 IOTOTask 视图打开（useIOTOTaskViewAsDefault），
		// 只认 markdown 会把它当成「没开过」，Alt+点击就会重复新增标签。
		if (
			viewState.type !== 'markdown' &&
			viewState.type !== IOTO_TASK_VIEW_TYPE
		) {
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
