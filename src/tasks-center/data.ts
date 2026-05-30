import { App, TFile, TFolder } from 'obsidian';

import {
	ProjectFolderEntry,
	ProjectListResult,
	TASKS_ROOT_PATH,
	TaskFileEntry,
	TaskFileListResult,
	TaskFileStatus,
} from './types';

const OBSIDIAN_COMMENT_BLOCK_PATTERN = /%%[\s\S]*?%%/g;
const HTML_COMMENT_BLOCK_PATTERN = /<!--[\s\S]*?-->/g;
const TASK_LINE_PATTERN = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\](.*)$/;

export function getTasksRootFolder(app: App): TFolder | null {
	const root = app.vault.getAbstractFileByPath(TASKS_ROOT_PATH);
	return root instanceof TFolder ? root : null;
}

export function listProjectFolders(app: App): ProjectListResult {
	const rootFolder = getTasksRootFolder(app);
	if (!rootFolder) {
		return {
			status: 'root-missing',
			projects: [],
		};
	}

	const projects: ProjectFolderEntry[] = rootFolder.children
		.filter((child): child is TFolder => child instanceof TFolder)
		.map((folder) => ({
			name: folder.name,
			path: folder.path,
		}))
		.sort((left, right) =>
			left.name.localeCompare(right.name, 'zh-Hans-CN'),
		);

	return {
		status: 'success',
		projects,
	};
}

export async function listProjectTaskFiles(
	app: App,
	projectName: string,
): Promise<TaskFileListResult> {
	const rootFolder = getTasksRootFolder(app);
	const projectPath = `${TASKS_ROOT_PATH}/${projectName}`;

	if (!rootFolder) {
		return {
			status: 'root-missing',
			projectName,
			projectPath,
			tasks: [],
		};
	}

	const projectFolder = app.vault.getAbstractFileByPath(projectPath);
	if (!(projectFolder instanceof TFolder)) {
		return {
			status: 'project-missing',
			projectName,
			projectPath,
			tasks: [],
		};
	}

	const markdownFiles = projectFolder.children.filter(
		(child): child is TFile =>
			child instanceof TFile && child.extension.toLowerCase() === 'md',
	);
	const tasks: TaskFileEntry[] = (
		await Promise.all(
			markdownFiles.map(async (file) => ({
				name: file.name,
				basename: file.basename,
				path: file.path,
				mtime: file.stat.mtime,
				ctime: file.stat.ctime,
				size: file.stat.size,
				status: await getTaskFileStatus(app, file),
			})),
		)
	).sort((left, right) => {
		const byModifiedTime = right.mtime - left.mtime;
		if (byModifiedTime !== 0) {
			return byModifiedTime;
		}

		return left.basename.localeCompare(right.basename, 'zh-Hans-CN');
	});

	if (tasks.length === 0) {
		return {
			status: 'empty',
			projectName,
			projectPath,
			tasks: [],
		};
	}

	return {
		status: 'success',
		projectName,
		projectPath,
		tasks,
	};
}

async function getTaskFileStatus(
	app: App,
	file: TFile,
): Promise<TaskFileStatus> {
	try {
		const content = await app.vault.cachedRead(file);
		return getTaskFileStatusFromContent(content);
	} catch {
		return getTaskFileStatusFromMetadataCache(app, file);
	}
}

function getTaskFileStatusFromMetadataCache(
	app: App,
	file: TFile,
): TaskFileStatus {
	const cache = app.metadataCache.getFileCache(file);
	const taskItems =
		cache?.listItems?.filter((item) => item.task !== undefined) ?? [];
	const taskMarkers = taskItems.map((item) =>
		item.task !== undefined && item.task !== ' ' ? 'x' : ' ',
	);
	return buildTaskFileStatus(taskMarkers);
}

export function getTaskFileStatusFromContent(content: string): TaskFileStatus {
	const taskMarkers = collectTaskMarkers(content);
	return buildTaskFileStatus(taskMarkers);
}

function collectTaskMarkers(content: string): string[] {
	const sanitizedContent = stripIgnoredContent(content);
	return sanitizedContent
		.split('\n')
		.map((line) => line.match(TASK_LINE_PATTERN))
		.filter((match): match is RegExpMatchArray =>
			Boolean(match && hasEffectiveTaskContent(match[2] ?? '')),
		)
		.map((match) => match[1] ?? ' ');
}

function stripIgnoredContent(content: string): string {
	return content
		.replace(OBSIDIAN_COMMENT_BLOCK_PATTERN, '\n')
		.replace(HTML_COMMENT_BLOCK_PATTERN, '\n');
}

function hasEffectiveTaskContent(taskContent: string): boolean {
	return taskContent.trim().length > 0;
}

function buildTaskFileStatus(taskMarkers: string[]): TaskFileStatus {
	const totalTaskCount = taskMarkers.length;
	const completedTaskCount = taskMarkers.filter(
		(taskMarker) => taskMarker.toLowerCase() === 'x',
	).length;

	if (totalTaskCount === 0) {
		return {
			key: 'empty',
			label: '无任务项',
			totalTaskCount,
			completedTaskCount,
			summary: '未识别到复选框任务',
		};
	}

	if (completedTaskCount === totalTaskCount) {
		return {
			key: 'completed',
			label: '已完成',
			totalTaskCount,
			completedTaskCount,
			summary: `${completedTaskCount}/${totalTaskCount} 项已完成`,
		};
	}

	if (completedTaskCount === 0) {
		return {
			key: 'todo',
			label: '待开始',
			totalTaskCount,
			completedTaskCount,
			summary: `${totalTaskCount} 项待处理`,
		};
	}

	return {
		key: 'in-progress',
		label: '进行中',
		totalTaskCount,
		completedTaskCount,
		summary: `${completedTaskCount}/${totalTaskCount} 项已完成`,
	};
}
