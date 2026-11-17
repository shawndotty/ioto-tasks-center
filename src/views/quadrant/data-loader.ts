/**
 * 四象限的跨项目轻量扫描（[[Plan-20261115-201917]] §3.3）。
 *
 * 复用 `listProjectTaskFiles` 的 `(mtime, size)` 解析缓存与 `includeContent: false`。
 * 只扫描**未归档**项目（与任务中心 `filterHiddenProjectEntries` 同口径）：
 * 归档项目的任务不进入 `tasks`，切项目范围因此仍然零 IO。
 * 如需在矩阵中查看某个已归档项目，请先在项目中心取消归档。
 */

import type { App } from 'obsidian';

import { mapWithConcurrency } from '../../tasks-center/async';
import { listProjectFolders, listProjectTaskFiles } from '../../tasks-center/data';
import type { TaskFileEntry } from '../../tasks-center/types';

/** 与 `views/tasks-center/data-loader.ts` 同口径；本层私有，不跨层导出。 */
const QUADRANT_PROJECT_CONCURRENCY = 8;

export interface QuadrantProjectOption {
	name: string;
}

export interface QuadrantScanResult {
	status: 'success' | 'root-missing';
	tasks: TaskFileEntry[];
	projects: QuadrantProjectOption[];
}

export async function scanQuadrantTasks(
	app: App,
	tasksRootPath: string,
	hiddenProjectNames: ReadonlySet<string>,
): Promise<QuadrantScanResult> {
	const listing = listProjectFolders(app, tasksRootPath);
	if (listing.status !== 'success') {
		return { status: 'root-missing', tasks: [], projects: [] };
	}

	const visibleProjects = listing.projects.filter(
		(project) => !hiddenProjectNames.has(project.name),
	);
	const projects: QuadrantProjectOption[] = visibleProjects.map(
		(project) => ({ name: project.name }),
	);

	const perProject = await mapWithConcurrency(
		visibleProjects,
		QUADRANT_PROJECT_CONCURRENCY,
		async (project) => {
			const result = await listProjectTaskFiles(
				app,
				tasksRootPath,
				project.name,
				{ includeContent: false },
			);
			return result.tasks;
		},
	);

	return { status: 'success', tasks: perProject.flat(), projects };
}
