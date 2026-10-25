/**
 * 「点任务视图里的任务文件链接，用哪个视图打开」的唯一判据
 * （[[Plan-20261025-103944]] §3.2）。
 *
 * 为什么单独成文件：`task-view-render` 不能 import `task-view-routing`
 * （后者值导入 `iotoTaskView`，而 `iotoTaskView` 值导入 `task-view-render`，
 * 会构成真实的值级环）。本模块只依赖两个叶子模块，方向恒为
 * `render → open`，无回边。
 *
 * `shouldOpenTaskFileInTaskView` 是纯函数、不碰 obsidian 运行期 API →
 * 可直接进单测（`tests/task-file-link-open.test.mjs`）。
 */
import type { TFile, WorkspaceLeaf } from 'obsidian';

import type { TaskFileLinkViewMode } from '../../settings-types';
import { isTaskNoteFile } from '../../tasks-center/task-note-menu';
import { IOTO_TASK_VIEW_TYPE } from './item-control-bridge';

/**
 * 三条否决理由本身就是规格：设置关掉 / 带锚点 / 目标不是任务笔记，
 * 一律交回核心 `workspace.openLinkText`。
 *
 * 返回 `boolean` 而非类型守卫：调用方必须先 `target !== null &&` 自行窄化，
 * 不要用 `!` 断言（[[Plan-20261025-103944]] §5 坑 11）。
 */
export function shouldOpenTaskFileInTaskView(params: {
	mode: TaskFileLinkViewMode;
	subpath: string;
	target: TFile | null;
	tasksRootPath: string;
}): boolean {
	const { mode, subpath, target, tasksRootPath } = params;
	return (
		mode === 'inherit' &&
		subpath === '' &&
		target !== null &&
		isTaskNoteFile(target, tasksRootPath)
	);
}

/**
 * 把指定叶子就地换成目标任务笔记的任务视图。
 *
 * `state.file` 是核心 `FileView` 认的键；`active: true` 让焦点跟过去，
 * 与 `task-view-routing.ts` 的 `setViewState` 字面量同口径。
 */
export async function setLeafToTaskView(
	leaf: WorkspaceLeaf,
	path: string,
): Promise<void> {
	await leaf.setViewState({
		type: IOTO_TASK_VIEW_TYPE,
		active: true,
		state: { file: path },
	});
}
