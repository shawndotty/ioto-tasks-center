/**
 * 任务标题的展示口径（[[Research-20261018-185512]] §2.2）。
 *
 * 项目名不是单独渲染的字段，而是文件名的字面前缀（`buildTaskFileName` 生成
 * `${projectName}-…`）。这里只负责「展示层」的剥离，不改变数据层的 `title`
 * （它仍表示真实文件名，被 UpTask 赋值、拖拽去重与搜索索引依赖）。
 */

import type { TaskFileEntry } from './types';

/** 任务文件所在的项目文件夹名：`3-任务/<Project>/<file>.md` → `<Project>`。 */
export function getTaskProjectNameFromPath(taskPath: string): string {
	const segments = taskPath.split('/');
	return segments.length >= 2 ? (segments[segments.length - 2] ?? '') : '';
}

/**
 * 隐藏任务标题开头的「项目名-」前缀。
 * - 只认精确匹配（区分大小写），避免误伤 `IOTO2-…` 这类同前缀项目
 * - 剥完为空则回退原名，绝不产出空标题
 */
export function stripProjectNamePrefix(
	title: string,
	projectName: string,
): string {
	const prefix = projectName.trim();
	if (!prefix) {
		return title;
	}

	const marker = `${prefix}-`;
	if (!title.startsWith(marker)) {
		return title;
	}

	const rest = title.slice(marker.length).trimStart();
	return rest.length > 0 ? rest : title;
}

/**
 * 任务列表实际展示的标题（视图与链接面板共用，[[Plan-20261028-154638]] §4.4）。
 * 抽成纯函数是为了让面板与列表用同一份口径，不复制 `stripProjectNamePrefix`
 * 的调用条件。
 */
export function resolveTaskDisplayTitle(
	task: Pick<TaskFileEntry, 'title' | 'path'>,
	showProjectNameInTaskList: boolean,
): string {
	if (showProjectNameInTaskList) {
		return task.title;
	}

	return stripProjectNamePrefix(
		task.title,
		getTaskProjectNameFromPath(task.path),
	);
}
