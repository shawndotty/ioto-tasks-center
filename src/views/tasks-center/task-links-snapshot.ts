/**
 * 任务链接浏览窗口的数据快照（[[Plan-20261028-154638]] §4.6）。
 *
 * 与视图解耦：命令 1 在任务中心**没打开**时也要能凑齐五类链接，所以子任务
 * 走 vault 级反向索引（扫描全部项目），而不是复用 `view.tasks`。
 */

import { FileSystemAdapter, TFile, TFolder, type App } from 'obsidian';

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
	collectOtherOutlinkPaths,
	getLeafFolderName,
	resolveTaskParentPaths,
	toTaskLinkEntry,
} from '../../tasks-center/task-links-index';
import { groupTaskOutlinksByRootPaths } from '../../tasks-center/task-outlink-counts';
import {
	fileUrlToVaultPath,
	getExternalFileName,
	getExternalHost,
	parseExternalLinks,
	type ParsedExternalLink,
} from '../../tasks-center/external-links';
import { isTaskNoteFile } from '../../tasks-center/task-note-menu';
import { t } from '../../lang/helpter';
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

	const subtaskEntries = (index.childrenByParentPath.get(taskPath) ?? []).map(
		(task) => toTaskLinkEntry(task, options.showProjectNameInTaskList),
	);

	// 外链要读正文：扫描时 `includeContent: false`，而 metadataCache 不收外链。
	const externalEntries = await buildExternalSection(app, taskPath, roots);

	return {
		taskPath,
		taskTitle: toTaskLinkEntry(selfTask, options.showProjectNameInTaskList)
			.title,
		parents,
		sections: {
			subtask: subtaskEntries,
			...buildOutlinkSections(app, taskPath, roots, {
				taskPath,
				subtaskPaths: subtaskEntries.map((entry) => entry.path),
			}),
			external: externalEntries,
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

/**
 * 外部链接分类（第 6 个 tab，[[Plan-20261102-113642]] §4.5）。
 *
 * 顺序 = 正文出现顺序（不排序，§4.2）；第二行只写「第一行看不出来的那一半」：
 * - 网页：域名（第一行已带域名就不写，避免重复占位）
 * - 库内文件：`库内 · <叶子文件夹>`（无目录时只有「库内」）
 * - 库外文件：有链接文字 → 文件名（两个 `[PDF](…)` 才分得开）；没文字 → 「本地文件」
 */
async function buildExternalSection(
	app: App,
	taskPath: string,
	roots: TaskLinksRoots,
): Promise<TaskLinkEntry[]> {
	const file = app.vault.getAbstractFileByPath(taskPath);
	if (!(file instanceof TFile)) {
		return [];
	}

	let raw = '';
	try {
		raw = await app.vault.cachedRead(file);
	} catch {
		return []; // 读不到正文 = 没有外链，不该让整个窗口空掉
	}

	const basePath = getVaultBasePath(app);
	const entries: TaskLinkEntry[] = [];
	for (const link of parseExternalLinks(raw)) {
		const target = resolveInVaultTarget(app, link, basePath);
		const title = buildExternalTitle(link);
		entries.push({
			path: link.url,
			title,
			// tooltip 给完整地址：第一行被省略号截断时还能看到原样 URL。
			subPath: link.url,
			kind: 'external',
			subtitle: buildExternalSubtitle(link, target, title),
			...(target
				? {
						targetPath: target.path,
						targetKind: isTaskNoteFile(target, roots.tasksRootPath)
							? ('task' as const)
							: ('note' as const),
					}
				: {}),
		});
	}
	return entries;
}

/** 库根路径：手机端 adapter 不是 `FileSystemAdapter`，拿不到就整类按「库外」处理。 */
function getVaultBasePath(app: App): string | null {
	const adapter = app.vault.adapter;
	return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null;
}

/** `file://` 命中本库文件才返回 TFile；映射到前缀但文件已不在 → 当库外（不猜）。 */
function resolveInVaultTarget(
	app: App,
	link: ParsedExternalLink,
	basePath: string | null,
): TFile | null {
	if (link.scheme !== 'file' || !basePath) {
		return null;
	}
	const vaultPath = fileUrlToVaultPath(link.url, basePath);
	if (!vaultPath) {
		return null;
	}
	const file = app.vault.getAbstractFileByPath(vaultPath);
	return file instanceof TFile ? file : null;
}

/** 没有链接文字时的第一行：本地文件用文件名，网页去掉 scheme（把宽度留给路径）。 */
function buildExternalTitle(link: ParsedExternalLink): string {
	if (link.label) {
		return link.label;
	}
	if (link.scheme === 'file') {
		return getExternalFileName(link.url) || link.url;
	}
	return link.url.replace(/^https?:\/\//i, '');
}

function buildExternalSubtitle(
	link: ParsedExternalLink,
	target: TFile | null,
	title: string,
): string {
	if (link.scheme === 'file') {
		if (target) {
			const folder = getLeafFolderName(target.path);
			return folder
				? `${t('taskLinks.external.inVault')} · ${folder}`
				: t('taskLinks.external.inVault');
		}
		return link.label
			? getExternalFileName(link.url)
			: t('taskLinks.external.hostFile');
	}

	const host = getExternalHost(link.url);
	if (!host) {
		return '';
	}
	// 第一行已经是 `github.com/x/y` 这种裸链 → 第二行不再重复域名。
	return title.toLowerCase().includes(host.toLowerCase()) ? '' : host;
}

function buildOutlinkSections(
	app: App,
	taskPath: string,
	roots: TaskLinksRoots,
	excluded: { taskPath: string; subtaskPaths: readonly string[] },
): Omit<TaskLinksSnapshot['sections'], 'subtask' | 'external'> {
	const resolvedLinks = app.metadataCache.resolvedLinks?.[taskPath];
	const targets = groupTaskOutlinksByRootPaths(resolvedLinks, roots);
	const otherPaths = collectOtherOutlinkPaths(
		Object.keys(resolvedLinks ?? {}),
		roots,
		[excluded.taskPath, ...excluded.subtaskPaths],
	);

	return {
		input: toOutlinkEntries(app, targets.input, roots.tasksRootPath),
		output: toOutlinkEntries(app, targets.output, roots.tasksRootPath),
		outcome: toOutlinkEntries(app, targets.outcome, roots.tasksRootPath),
		other: toOutlinkEntries(app, otherPaths, roots.tasksRootPath),
	};
}

function toOutlinkEntries(
	app: App,
	paths: readonly string[],
	tasksRootPath: string,
): TaskLinkEntry[] {
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
			kind: isTaskNoteFile(file, tasksRootPath) ? 'task' : 'note',
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
