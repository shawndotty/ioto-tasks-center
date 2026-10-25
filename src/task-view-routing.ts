/**
 * 任务视图路由 / 激活助手（从 main.ts 抽出）。
 *
 * 这些函数都不持有插件实例，只依赖 `app` / `tasksRootPath` 等运行时入参，
 * 便于单测与复用。main.ts 的 onload 命令回调与 file-menu 注册直接调用本模块。
 *
 * 注意：`activateIOTOTasksCenterView` / `activateIOTOProjectCenterView` 仍由
 * IOTOTasksCenter 同名 public 方法薄封装转发（设置面板 `plugin.activate*` 仍可用）。
 */
import {
	type App,
	FileView,
	MarkdownView,
	type Menu,
	Notice,
	type TFile,
	type WorkspaceLeaf,
} from 'obsidian';
import { t } from './lang/helpter';
import { isTaskNoteFile } from './tasks-center/task-note-menu';
import {
	IOTO_TASKS_CENTER_VIEW_TYPE,
	IOTOTasksCenterView,
} from './views/iotoTasksCenterView';
import { IOTO_PROJECT_CENTER_VIEW_TYPE } from './views/iotoProjectCenterView';
import { IOTOTaskView } from './views/iotoTaskView';
import { setLeafToTaskView } from './views/ioto-task/task-file-link-open';

/**
 * 「切换 Markdown / 任务视图」命令的方向判据（[[Discuss-20261008-214919]] 方案 A）。
 * 只看「活动叶子的视图类型」而非「文件是否任务笔记」——同一任务笔记可能同时在
 * Markdown 与任务视图两个 Tab 中，切换必须作用于用户眼前的那个叶子。
 * checkCallback 与执行分支共用此判据，避免两处口径日后漂移。
 */
export function resolveTaskViewToggleDirection(
	leaf: WorkspaceLeaf,
	tasksRootPath: string,
): 'to-markdown' | 'to-task-view' | null {
	const view = leaf.view;
	if (view instanceof IOTOTaskView) {
		return 'to-markdown';
	}
	if (
		view instanceof MarkdownView &&
		view.file &&
		isTaskNoteFile(view.file, tasksRootPath)
	) {
		return 'to-task-view';
	}
	return null;
}

export async function openFileAsIOTOTask(
	app: App,
	tasksRootPath: string,
	file: TFile,
	targetLeaf?: WorkspaceLeaf,
): Promise<void> {
	if (!isTaskNoteFile(file, tasksRootPath)) {
		new Notice(t('notice.openAsIOTOTaskNotTaskNote'));
		return;
	}

	const leaf = targetLeaf ?? resolveInPlaceLeaf(app, file);
	await setLeafToTaskView(leaf, file.path);
}

/**
 * 解析「就地替换」的目标叶子。
 * 不能直接用 getLeaf(false)：它内部走 getUnpinnedLeaf()，会跳过被锁定（pin）的
 * 标签页并另开新标签页（见 Discuss-20261008-082657 §一/§二）。
 * 这里优先复用当前正显示该文件的活动叶子（含被锁定的），没有才回退。
 */
export function resolveInPlaceLeaf(app: App, file: TFile): WorkspaceLeaf {
	const activeView = app.workspace.getActiveViewOfType(FileView);
	if (activeView?.file?.path === file.path) {
		return activeView.leaf;
	}
	return app.workspace.getLeaf(false);
}

export async function setLeafToMarkdown(leaf: WorkspaceLeaf): Promise<void> {
	const view = leaf.view;
	const file = view instanceof IOTOTaskView ? view.file : null;
	if (!file) {
		new Notice(t('notice.openAsIOTOTaskNoFile'));
		return;
	}

	await leaf.setViewState({
		type: 'markdown',
		active: true,
		state: {
			file: file.path,
			mode: 'source',
		},
	});
}

/**
 * 按**指定叶子**切换 Markdown / IOTO 任务视图（[[Plan-20261019-190001]] §3.3）。
 * 命令面板与悬浮按钮共用；按钮必须传自己的 leaf，不能依赖 getMostRecentLeaf()。
 * 方向在调用瞬间重新解析，不缓存——按钮即使因漏扫残留也能按当前视图自愈。
 */
export async function toggleTaskViewForLeaf(
	app: App,
	tasksRootPath: string,
	leaf: WorkspaceLeaf,
): Promise<void> {
	const direction = resolveTaskViewToggleDirection(leaf, tasksRootPath);
	if (!direction) return;

	if (direction === 'to-markdown') {
		const view = leaf.view;
		if (view instanceof IOTOTaskView) {
			// 高频入口必须显式落盘：blur 提交与 setViewState 销毁视图存在竞态。
			await view.flushInlineEdits();
			await view.flushZoomEdit(); // zoomLine === null 时内部短路，可无条件调
		}
		await setLeafToMarkdown(leaf);
		return;
	}

	const view = leaf.view;
	if (view instanceof MarkdownView && view.file) {
		await openFileAsIOTOTask(app, tasksRootPath, view.file, leaf);
	}
}

export function findIOTOTaskLeafForFile(
	app: App,
	path: string,
): WorkspaceLeaf | null {
	let matchedLeaf: WorkspaceLeaf | null = null;
	app.workspace.iterateAllLeaves((leaf) => {
		if (matchedLeaf) {
			return;
		}
		const view = leaf.view;
		if (view instanceof IOTOTaskView && view.file?.path === path) {
			matchedLeaf = leaf;
		}
	});

	return matchedLeaf;
}

export async function activateIOTOTasksCenterView(app: App): Promise<void> {
	const leaf = getOrCreateIOTOTasksCenterLeaf(app);
	await leaf.setViewState({
		type: IOTO_TASKS_CENTER_VIEW_TYPE,
		active: true,
	});
}

export async function activateIOTOProjectCenterView(app: App): Promise<void> {
	const leaf = getOrCreateIOTOProjectCenterLeaf(app);
	await leaf.setViewState({
		type: IOTO_PROJECT_CENTER_VIEW_TYPE,
		active: true,
	});
}

export function getOrCreateIOTOTasksCenterLeaf(app: App): WorkspaceLeaf {
	const existingLeaf = app.workspace.getLeavesOfType(
		IOTO_TASKS_CENTER_VIEW_TYPE,
	)[0];
	return existingLeaf ?? app.workspace.getLeaf(true);
}

export function getOrCreateIOTOProjectCenterLeaf(app: App): WorkspaceLeaf {
	const existingLeaf = app.workspace.getLeavesOfType(
		IOTO_PROJECT_CENTER_VIEW_TYPE,
	)[0];
	return existingLeaf ?? app.workspace.getLeaf(true);
}

export function getTasksCenterView(app: App): IOTOTasksCenterView | null {
	const leaf = app.workspace.getLeavesOfType(IOTO_TASKS_CENTER_VIEW_TYPE)[0];
	const view = leaf?.view;
	return view instanceof IOTOTasksCenterView ? view : null;
}

/**
 * 给文件菜单追加「以 IOTO 任务视图打开 / 切回 Markdown」两项。
 * 「以 IOTO 任务视图打开 / 切回 Markdown」是移动端唯一的互切入口
 * （本插件 isDesktopOnly: false，移动端没有 contextmenu）。
 */
export function appendTaskViewMenuItems(
	app: App,
	tasksRootPath: string,
	menu: Menu,
	file: TFile,
	leaf?: WorkspaceLeaf,
): void {
	menu.addItem((item) =>
		item
			.setTitle(t('menu.openAsIOTOTask'))
			.setIcon('list-todo')
			.onClick(() => {
				void openFileAsIOTOTask(app, tasksRootPath, file, leaf);
			}),
	);

	const taskLeaf = findIOTOTaskLeafForFile(app, file.path);
	if (!taskLeaf) {
		return;
	}

	menu.addItem((item) =>
		item
			.setTitle(t('menu.openAsMarkdown'))
			.setIcon('file-text')
			.onClick(() => {
				void setLeafToMarkdown(taskLeaf);
			}),
	);
}
