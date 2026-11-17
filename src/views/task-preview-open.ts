/**
 * 任务「打开」的视图中立共享口径（[[Research-20261117-061808]] §四 方案 A /
 * [[Plan-20261117-062052]] §5.1）。
 *
 * 任务中心与优先级矩阵共用同一份「去重 → 预览叶 → 模式判定 → 打开 → 记录状态」链路，
 * 从根上避免两处判定分叉。滚动定位（搜索词 / 指定行）仍留在任务中心
 * `task-file-opening.ts`，本模块不反向依赖它。
 */

import {
	MarkdownView,
	TFile,
	type App,
	type WorkspaceLeaf,
	type WorkspaceParent,
} from 'obsidian';

import { shouldSkipOpeningTask } from './task-preview-state';
import { isTaskNoteFile } from '../tasks-center/task-note-menu';
import { IOTO_TASK_VIEW_TYPE } from './iotoTaskView';
import {
	focusTaskNoteEditorAtOffset,
	openTaskNoteInLeaf,
	resolveTaskNoteOpenMode,
} from './tasks-center/task-note-opening';
import { getLeafFilePath, isLeafInSidebar } from './tasks-center/preview-leaf';
import { type TaskOpenTarget } from './tasks-center/constants';

export interface TaskPreviewOpenHost {
	readonly app: App;
	/** 视图自身叶：排除自身命中、解析 Alt 当前标签组、侧栏判定。 */
	readonly leaf: WorkspaceLeaf;
	previewLeaf: WorkspaceLeaf | null;
	openedTaskPath: string | null;
	isLeafAvailable(leaf: WorkspaceLeaf): boolean;
	ensurePreviewLeaf(): WorkspaceLeaf;
	getTasksRootPath(): string;
	getUseIOTOTaskViewAsDefault(): boolean;
	/** 任务中心用它维护 lastOpenedTaskByProject；矩阵不实现。 */
	onTaskOpened?(path: string): void;
	/** 任务中心用它驱动 is-opening 行样式；矩阵不实现。 */
	onOpeningChange?(path: string | null): void;
}

export type TaskPreviewOpenResult =
	| { status: 'missing' }
	| { status: 'skipped' }
	| { status: 'opened'; leaf: WorkspaceLeaf };

export interface TaskPreviewOpenOptions {
	cursorOffset?: number | null;
	line?: number | null;
	searchQuery?: string;
}

/** 记录「该任务已打开」，供预览位状态与项目级最近打开记忆使用。 */
function markTaskOpened(host: TaskPreviewOpenHost, taskPath: string): void {
	host.openedTaskPath = taskPath;
	host.onTaskOpened?.(taskPath);
}

/**
 * 在视图持有的预览叶中打开任务（无修饰点击口径）。
 *
 * `missing` 由调用方决定是否提示（矩阵弹 Notice，任务中心静默）。
 * 文件已在该预览叶且路径未变时只激活叶，返回 `skipped`。
 */
export async function openTaskInPreviewLeaf(
	host: TaskPreviewOpenHost,
	taskPath: string,
	options?: TaskPreviewOpenOptions,
): Promise<TaskPreviewOpenResult> {
	const file = host.app.vault.getAbstractFileByPath(taskPath);
	if (!(file instanceof TFile)) {
		return { status: 'missing' };
	}

	const previewLeafAvailable = Boolean(
		host.previewLeaf && host.isLeafAvailable(host.previewLeaf),
	);
	const previewedFilePath = previewLeafAvailable
		? getLeafFilePath(host.previewLeaf)
		: null;
	if (
		shouldSkipOpeningTask({
			targetTaskPath: file.path,
			openedTaskPath: host.openedTaskPath,
			previewLeafAvailable,
			previewedFilePath,
		})
	) {
		host.app.workspace.setActiveLeaf(host.previewLeaf!, { focus: true });
		return { status: 'skipped' };
	}

	const query = options?.searchQuery?.trim() ?? '';
	const cursorOffset =
		typeof options?.cursorOffset === 'number' ? options.cursorOffset : null;
	const line = options?.line;
	const hasLine = typeof line === 'number';

	host.onOpeningChange?.(file.path);
	try {
		const leaf = host.ensurePreviewLeaf();
		const mode = resolveTaskNoteOpenMode({
			hasSearchQuery: query.length > 0,
			hasLine,
			cursorOffset,
			preferTaskView: host.getUseIOTOTaskViewAsDefault(),
			isTaskNote: isTaskNoteFile(file, host.getTasksRootPath()),
		});

		await openTaskNoteInLeaf(leaf, file, mode);
		host.previewLeaf = leaf;
		markTaskOpened(host, file.path);

		if (cursorOffset !== null) {
			await focusTaskNoteEditorAtOffset(
				host.app,
				leaf,
				file,
				cursorOffset,
			);
		}

		return { status: 'opened', leaf };
	} finally {
		host.onOpeningChange?.(null);
	}
}

/**
 * 修饰键打开：`current-pane-tab`（Alt）与 `right-split-tab`（Alt+Cmd/Ctrl）。
 *
 * 两路都先解析文件；缺失返回 `missing`，门控 TaskView 转换与去重口径与
 * 任务中心改造前逐行一致。
 */
export async function openTaskInTab(
	host: TaskPreviewOpenHost,
	taskPath: string,
	target: Exclude<TaskOpenTarget, 'adjacent-preview'>,
): Promise<{ status: 'missing' | 'opened' }> {
	const file = host.app.vault.getAbstractFileByPath(taskPath);
	if (!(file instanceof TFile)) {
		return { status: 'missing' };
	}

	if (target === 'current-pane-tab') {
		await openFileInCurrentPaneTab(host, file);
	} else {
		await openFileInRightSplitTab(host, file);
	}

	return { status: 'opened' };
}

async function openFileInCurrentPaneTab(
	host: TaskPreviewOpenHost,
	file: TFile,
): Promise<void> {
	const tabGroup = resolveTargetTabGroup(host);
	const existingLeaf =
		tabGroup === null
			? null
			: findLeafInCurrentTabGroupByFilePath(host, file.path, tabGroup);
	if (existingLeaf) {
		markTaskOpened(host, file.path);
		host.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		return;
	}

	host.onOpeningChange?.(file.path);
	try {
		const leaf = host.app.workspace.getLeaf('tab');
		await leaf.openFile(file, { active: true });
		// Alt+点击与直接点击同口径：门控开启且是任务笔记时转成 IOTOTask 视图。
		await convertLeafToTaskViewIfDefault(host, leaf, file);
		markTaskOpened(host, file.path);

		host.app.workspace.setActiveLeaf(leaf, { focus: true });
	} finally {
		host.onOpeningChange?.(null);
	}
}

async function openFileInRightSplitTab(
	host: TaskPreviewOpenHost,
	file: TFile,
): Promise<void> {
	// 同文件已打开就只激活，不重复开分屏。
	const existingLeaf = findLeafShowingTaskFile(host, file.path);
	if (existingLeaf) {
		markTaskOpened(host, file.path);
		host.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		return;
	}

	host.onOpeningChange?.(file.path);
	try {
		const leaf = host.app.workspace.getLeaf('split', 'vertical');
		await leaf.openFile(file, { active: true });
		await convertLeafToTaskViewIfDefault(host, leaf, file);
		markTaskOpened(host, file.path);

		host.app.workspace.setActiveLeaf(leaf, { focus: true });
	} finally {
		host.onOpeningChange?.(null);
	}
}

/**
 * 门控式 TaskView 转换：Alt+点击与右侧分屏两路共用的同一口径——
 * 与无修饰点击分支一致，均受 useIOTOTaskViewAsDefault 门控。
 */
async function convertLeafToTaskViewIfDefault(
	host: TaskPreviewOpenHost,
	leaf: WorkspaceLeaf,
	file: TFile,
): Promise<void> {
	if (
		!host.getUseIOTOTaskViewAsDefault() ||
		!isTaskNoteFile(file, host.getTasksRootPath()) ||
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
	host: TaskPreviewOpenHost,
	filePath: string,
): WorkspaceLeaf | null {
	let matchedLeaf: WorkspaceLeaf | null = null;

	host.app.workspace.iterateAllLeaves((leaf) => {
		if (matchedLeaf || leaf === host.leaf) {
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
	host: TaskPreviewOpenHost,
): WorkspaceParent | null {
	const ws = host.app.workspace;
	if (!isLeafInSidebar(ws, host.leaf)) {
		return host.leaf.parent;
	}
	return ws.getMostRecentLeaf(ws.rootSplit)?.parent ?? null;
}

function findLeafInCurrentTabGroupByFilePath(
	host: TaskPreviewOpenHost,
	filePath: string,
	tabGroup: WorkspaceParent,
): WorkspaceLeaf | null {
	let matchedLeaf: WorkspaceLeaf | null = null;

	host.app.workspace.iterateAllLeaves((leaf) => {
		if (
			matchedLeaf ||
			leaf === host.leaf ||
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
