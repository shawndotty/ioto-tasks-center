/**
 * 四象限的跨项目轻量扫描（[[Plan-20261115-201917]] §3.3）。
 *
 * 一次扫描**所有**项目（含存档），范围过滤留给纯模型做：切项目范围因此零 IO。
 * 复用 `listProjectTaskFiles` 的 `(mtime, size)` 解析缓存与 `includeContent: false`。
 */

import type { App } from 'obsidian';

import { mapWithConcurrency } from '../../tasks-center/async';
import { listProjectFolders, listProjectTaskFiles } from '../../tasks-center/data';
import type { TaskFileEntry } from '../../tasks-center/types';

/** 与 `views/tasks-center/data-loader.ts` 同口径；本层私有，不跨层导出。 */
const QUADRANT_PROJECT_CONCURRENCY = 8;

export interface QuadrantProjectOption {
	name: string;
	archived: boolean;
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

	const projects = listing.projects.map((project) => ({
		name: project.name,
		archived: hiddenProjectNames.has(project.name),
	}));

	const perProject = await mapWithConcurrency(
		listing.projects,
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
