/**
 * 任务链接浏览窗口的**唯一构造点**（[[Plan-20261028-154638]] §4.7）。
 *
 * 三条入口（命令 1 / 命令 2 / 任务行右键）都收敛到 `openTaskLinksWindow`，
 * 差别只在「有没有任务中心视图」——有视图走预览叶（与列表 100% 一致），
 * 没视图退到标签页（无锚点就不该凭空分栏）。
 */

import {
	FileView,
	TFile,
	parseLinktext,
	type App,
	type WorkspaceLeaf,
} from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type {
	IOTOTasksCenterSettings,
	TaskListSortMode,
} from '../../settings-types';
import type { TaskLinksRoots } from '../../tasks-center/types';
import { isTaskNoteFile } from '../../tasks-center/task-note-menu';
import {
	TaskLinksModal,
	type TaskLinkEntryKind,
	type TaskLinksModalOptions,
} from '../../ui/task-links-modal';
import { toExternalOpenUrl } from '../ioto-task/external-link-url';
import { setLeafToTaskView } from '../ioto-task/task-file-link-open';
import { buildTaskLinksSnapshot } from './task-links-snapshot';

export interface TaskLinksLaunchContext {
	app: App;
	taskPath: string;
	roots: TaskLinksRoots;
	sortMode: TaskListSortMode;
	showProjectNameInTaskList: boolean;
	useIOTOTaskViewAsDefault: boolean;
	/** 有视图走预览叶；无视图（命令 1）退到标签页。 */
	view?: IOTOTasksCenterView;
}

/** 由任务中心上下文（右键 / 命令 2）发起。 */
export function openTaskLinksFromView(
	view: IOTOTasksCenterView,
	taskPath: string,
): void {
	openTaskLinksWindow({
		app: view.app,
		taskPath,
		roots: {
			tasksRootPath: view.getTasksRootPath(),
			inputRootPath: view.getInputRootPath(),
			outputRootPath: view.getOutputRootPath(),
			outcomeRootPath: view.getOutcomeRootPath(),
		},
		sortMode: view.getTaskListSortMode(),
		showProjectNameInTaskList: view.getShowProjectNameInTaskList(),
		useIOTOTaskViewAsDefault: view.getUseIOTOTaskViewAsDefault(),
		view,
	});
}

/** 由插件设置上下文（命令 1，任务中心可能没开）发起。 */
export function openTaskLinksFromSettings(
	app: App,
	settings: IOTOTasksCenterSettings,
	taskPath: string,
): void {
	openTaskLinksWindow({
		app,
		taskPath,
		roots: {
			tasksRootPath: settings.tasksRootPath,
			inputRootPath: settings.inputRootPath,
			outputRootPath: settings.outputRootPath,
			outcomeRootPath: settings.outcomeRootPath,
		},
		sortMode: settings.taskListSortMode,
		showProjectNameInTaskList: settings.showProjectNameInTaskList,
		useIOTOTaskViewAsDefault: settings.useIOTOTaskViewAsDefault,
	});
}

function openTaskLinksWindow(context: TaskLinksLaunchContext): void {
	// 先发起扫描再 open()：弹窗骨架立刻出现，扫描与构建并行（§3.5）。
	const snapshot = buildTaskLinksSnapshot({
		app: context.app,
		roots: context.roots,
		taskPath: context.taskPath,
		sortMode: context.sortMode,
		showProjectNameInTaskList: context.showProjectNameInTaskList,
	});

	new TaskLinksModal(context.app, {
		snapshot,
		onOpenEntry: (entry, kind, line) => {
			if (context.view) {
				const file = context.app.vault.getAbstractFileByPath(entry.path);
				if (!(file instanceof TFile)) {
					return;
				}

				void (kind === 'task'
					? context.view.openFileInPreview(file, { line })
					: context.view.openOutlinkFileInPreview(file, { line }));
				return;
			}

			void openLinkedFileInTab(context, entry.path, kind, line);
		},
		...createPreviewLinkHooks(context),
	}).open();
}

/** 预览内链接的两条通路：解析 → 面板内换页；外链 → 系统路由。 */
function createPreviewLinkHooks(
	context: TaskLinksLaunchContext,
): Pick<TaskLinksModalOptions, 'resolvePreviewLink' | 'openExternalLink'> {
	return {
		resolvePreviewLink: (linktext, sourcePath) => {
			// 必须先剥 `#子路径`：整串交给 getFirstLinkpathDest 会返回 null。
			const { path } = parseLinktext(linktext);
			const file = context.app.metadataCache.getFirstLinkpathDest(
				path,
				sourcePath,
			);
			if (!file) {
				return null;
			}

			return {
				path: file.path,
				kind: isTaskNoteFile(file, context.roots.tasksRootPath)
					? 'task'
					: 'note',
			};
		},
		openExternalLink: (href) => {
			window.open(toExternalOpenUrl(href));
		},
	};
}

async function openLinkedFileInTab(
	context: TaskLinksLaunchContext,
	path: string,
	kind: TaskLinkEntryKind,
	line?: number,
): Promise<void> {
	const file = context.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return;
	}

	const leaf =
		findLeafShowingFile(context.app, file.path) ??
		context.app.workspace.getLeaf('tab');

	if (
		kind === 'task' &&
		// 有精确定位诉求时 bypass 任务视图：任务视图没有编辑器，落不了光标
		//（与核心「拒锚」原则同源，task-file-link-open.ts）。
		line == null &&
		context.useIOTOTaskViewAsDefault &&
		isTaskNoteFile(file, context.roots.tasksRootPath)
	) {
		await setLeafToTaskView(leaf, file.path);
	} else {
		await leaf.openFile(file, {
			active: true,
			eState: line != null ? { line } : undefined,
		});
	}

	context.app.workspace.setActiveLeaf(leaf, { focus: true });
}

/** 同一条目点两次不该开出两个标签页。 */
function findLeafShowingFile(app: App, filePath: string): WorkspaceLeaf | null {
	let matchedLeaf: WorkspaceLeaf | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		if (matchedLeaf) {
			return;
		}

		const leafView = leaf.view;
		if (leafView instanceof FileView && leafView.file?.path === filePath) {
			matchedLeaf = leaf;
		}
	});

	return matchedLeaf;
}
