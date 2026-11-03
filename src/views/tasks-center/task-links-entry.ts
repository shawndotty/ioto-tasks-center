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
import type {
	TaskLinkEntry,
	TaskLinksRoots,
} from '../../tasks-center/types';
import {
	isTaskNoteFile,
	isTaskSwitchTargetFile,
} from '../../tasks-center/task-note-menu';
import {
	TaskLinksModal,
	type TaskLinkEntryKind,
	type TaskLinksModalOptions,
} from '../../ui/task-links-modal';
import { toExternalOpenUrl } from '../ioto-task/external-link-url';
import { setLeafToTaskView } from '../ioto-task/task-file-link-open';
import { openExternalUrl } from './open-external-url';
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
		// 就地切换：`roots` / `sortMode` / `showProjectName…` 只在入口层手上，
		// 弹窗按架构不 import 视图模块（ui → views 的值级依赖边禁止）。
		buildSnapshot: (taskPath) =>
			buildTaskLinksSnapshot({
				app: context.app,
				roots: context.roots,
				taskPath,
				sortMode: context.sortMode,
				showProjectNameInTaskList: context.showProjectNameInTaskList,
			}),
		// 「切换」图标的候选：任务根目录下的任务笔记（点击时现取，排除项目元数据 _project.md）。
		listSwitchTargets: () =>
			context.app.vault
				.getMarkdownFiles()
				.filter((file) =>
					isTaskSwitchTargetFile(file, context.roots.tasksRootPath),
				),
		onOpenEntry: (entry, kind, line) => {
			// 外部条目：库内文件走与「输入/输出」完全一致的打开路径，其余交给
			// Web viewer / 系统浏览器。必须在 vault 查文件之前分叉。
			if (kind === 'external') {
				openExternalEntry(context, entry);
				return;
			}
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

/**
 * 外部条目的打开路由（四个分支，顺序不能换）：
 * 1. `targetPath` 命中库内文件 → 与其它 tab 完全一致的打开（视图内预览 / 标签页）；
 * 2. 网页 / 库外 `file://` → Web viewer；
 * 3. Web viewer 不可用（关着 / 手机）→ 系统浏览器。
 * 映射命中但文件已不在（改名 / 移出库）→ 落到 2，不弹错。
 */
function openExternalEntry(
	context: TaskLinksLaunchContext,
	entry: TaskLinkEntry,
): void {
	const targetPath = entry.targetPath;
	if (targetPath) {
		const file = context.app.vault.getAbstractFileByPath(targetPath);
		if (file instanceof TFile) {
			const kind = entry.targetKind ?? 'note';
			if (context.view) {
				void (kind === 'task'
					? context.view.openFileInPreview(file)
					: context.view.openOutlinkFileInPreview(file));
				return;
			}
			void openLinkedFileInTab(context, targetPath, kind);
			return;
		}
	}

	openExternalUrl(context.app, entry.path);
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
