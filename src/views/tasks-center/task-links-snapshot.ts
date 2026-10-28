/**
 * 任务链接浏览窗口的数据快照（[[Plan-20261028-154638]] §4.6）。
 *
 * 与视图解耦：命令 1 在任务中心**没打开**时也要能凑齐五类链接，所以子任务
 * 走 vault 级反向索引（扫描全部项目），而不是复用 `view.tasks`。
 */

import { TFile, TFolder, type App } from 'obsidian';

import type {
	TaskFileEntry,
	TaskLinkEntry,
	TaskLinksRoots,
	TaskLinksSnapshot,
} from '../../tasks-center/types';
import type { TaskListSortMode } from '../../settings-types';
import {
	listProjectFolders,
	listProjectTaskFiles,
	parseTaskFileFields,
} from '../../tasks-center/data';
import { mapWithConcurrency } from '../../tasks-center/async';
import {
	buildTaskLinksIndex,
	resolveTaskParentPaths,
	toTaskLinkEntry,
} from '../../tasks-center/task-links-index';
import { groupTaskOutlinksByRootPaths } from '../../tasks-center/task-outlink-counts';
import { sortTasksForPresentation } from '../task-list-presentation';

/**
 * 项目级并发刻意取小：每个项目内部已按 `TASK_SCAN_CONCURRENCY = 24` 并发读，
 * 再乘上去会瞬间放出上百个 `cachedRead`。
 */
const PROJECT_SCAN_CONCURRENCY = 4;

export interface BuildTaskLinksSnapshotOptions {
	app: App;
	roots: TaskLinksRoots;
	taskPath: string;
	/** 子任务顺序与列表一致：调用方的 `taskListSortMode`。 */
	sortMode: TaskListSortMode;
	showProjectNameInTaskList: boolean;
}

export async function buildTaskLinksSnapshot(
	options: BuildTaskLinksSnapshotOptions,
): Promise<TaskLinksSnapshot> {
	const { app, roots, taskPath } = options;
	const tasks = await scanVaultTasks(app, roots.tasksRootPath);
	const orderedTasks = sortTasksForPresentation(tasks, options.sortMode);
	const resolveTitle = (title: string, sourcePath: string): string | null =>
		app.metadataCache.getFirstLinkpathDest(title, sourcePath)?.path ?? null;
	const index = buildTaskLinksIndex(orderedTasks, resolveTitle);

	// 当前任务不在扫描结果里（任务根目录刚改、文件新建未缓存）→ 直接读文件兜底，
	// 不抛错：面板至少还能显示它自己的出链。
	const selfTask =
		index.taskByPath.get(taskPath) ??
		(await readTaskEntryFallback(app, taskPath));

	if (!selfTask) {
		throw new Error(`Task links: task note not found: ${taskPath}`);
	}

	const parents = resolveTaskParentPaths(index, selfTask, resolveTitle)
		.map((path) => index.taskByPath.get(path))
		.filter((task): task is TaskFileEntry => Boolean(task))
		.map((task) => toTaskLinkEntry(task, options.showProjectNameInTaskList));

	return {
		taskPath,
		taskTitle: toTaskLinkEntry(selfTask, options.showProjectNameInTaskList)
			.title,
		parents,
		sections: {
			subtask: (index.childrenByParentPath.get(taskPath) ?? []).map(
				(task) =>
					toTaskLinkEntry(task, options.showProjectNameInTaskList),
			),
			...buildOutlinkSections(app, taskPath, roots),
		},
		missingRoots: collectMissingRoots(app, roots),
	};
}

async function scanVaultTasks(
	app: App,
	tasksRootPath: string,
): Promise<TaskFileEntry[]> {
	const projectResult = listProjectFolders(app, tasksRootPath);
	const projectTasks = await mapWithConcurrency(
		projectResult.projects,
		PROJECT_SCAN_CONCURRENCY,
		(project) =>
			listProjectTaskFiles(app, tasksRootPath, project.name, {
				includeContent: false,
			}),
	);

	return projectTasks.flatMap((result) => result.tasks);
}

async function readTaskEntryFallback(
	app: App,
	taskPath: string,
): Promise<TaskFileEntry | null> {
	const file = app.vault.getAbstractFileByPath(taskPath);
	if (!(file instanceof TFile)) {
		return null;
	}

	const content = await app.vault.cachedRead(file);
	const fields = parseTaskFileFields(content);
	return {
		name: file.name,
		basename: file.basename,
		title: file.basename,
		path: file.path,
		mtime: file.stat.mtime,
		ctime: file.stat.ctime,
		size: file.stat.size,
		starred: fields.starred,
		priority: fields.priority,
		status: fields.status,
		upTaskTitles: fields.upTaskTitles,
		content: '',
	};
}

function buildOutlinkSections(
	app: App,
	taskPath: string,
	roots: TaskLinksRoots,
): Pick<TaskLinksSnapshot['sections'], 'input' | 'output' | 'outcome'> {
	const targets = groupTaskOutlinksByRootPaths(
		app.metadataCache.resolvedLinks?.[taskPath],
		roots,
	);

	return {
		input: toOutlinkEntries(app, targets.input),
		output: toOutlinkEntries(app, targets.output),
		outcome: toOutlinkEntries(app, targets.outcome),
	};
}

function toOutlinkEntries(app: App, paths: readonly string[]): TaskLinkEntry[] {
	const entries: TaskLinkEntry[] = [];
	for (const path of paths) {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			continue;
		}

		entries.push({
			path: file.path,
			title: file.basename,
			subPath: file.path.replace(/\.md$/i, ''),
		});
	}

	// 取数函数按**完整路径**排序，outlink popover 又按 basename 重排一次；
	// 面板要与 popover 顺序一致，这里必须再排一次（§2.2 第 3 条）。
	return entries.sort((left, right) =>
		left.title.localeCompare(right.title, undefined, { numeric: true }),
	);
}

function collectMissingRoots(
	app: App,
	roots: TaskLinksRoots,
): Partial<Record<'input' | 'output' | 'outcome', string>> {
	const missingRoots: Partial<Record<'input' | 'output' | 'outcome', string>> =
		{};
	const candidates = [
		['input', roots.inputRootPath],
		['output', roots.outputRootPath],
		['outcome', roots.outcomeRootPath],
	] as const;

	for (const [category, rootPath] of candidates) {
		if (!(app.vault.getAbstractFileByPath(rootPath) instanceof TFolder)) {
			missingRoots[category] = rootPath;
		}
	}

	return missingRoots;
}
