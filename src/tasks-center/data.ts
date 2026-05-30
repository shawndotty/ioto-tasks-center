import { App, TFile, TFolder } from 'obsidian';

import {
	ProjectFolderEntry,
	ProjectListResult,
	TASKS_ROOT_PATH,
	TaskFileEntry,
	TaskFileListResult,
	TaskFileStatus,
} from './types';

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

export function listProjectTaskFiles(
	app: App,
	projectName: string,
): TaskFileListResult {
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

	const tasks: TaskFileEntry[] = projectFolder.children
		.filter(
			(child): child is TFile =>
				child instanceof TFile &&
				child.extension.toLowerCase() === 'md',
		)
		.map((file) => ({
			name: file.name,
			basename: file.basename,
			path: file.path,
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
			size: file.stat.size,
			status: getTaskFileStatus(app, file),
		}))
		.sort((left, right) => {
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

function getTaskFileStatus(app: App, file: TFile): TaskFileStatus {
	const cache = app.metadataCache.getFileCache(file);
	const taskItems =
		cache?.listItems?.filter((item) => item.task !== undefined) ?? [];
	const totalTaskCount = taskItems.length;
	const completedTaskCount = taskItems.filter(
		(item) => item.task !== undefined && item.task !== ' ',
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
