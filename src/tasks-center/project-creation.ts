import { App, TFolder } from 'obsidian';

import { TASKS_ROOT_PATH } from './types';

export interface CreateProjectFolderResult {
	name: string;
	path: string;
	created: boolean;
}

export function normalizeProjectName(input: string): string | null {
	const normalized = input
		.trim()
		.replace(/[\\/:*?"<>|#[\]^]+/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^-+|-+$/g, '');

	return normalized.length > 0 ? normalized : null;
}

export function resolveProjectTargetPath(projectName: string): string {
	return normalizeVaultPath(`${TASKS_ROOT_PATH}/${projectName}`);
}

export async function createProjectFolder(
	app: App,
	projectName: string,
): Promise<CreateProjectFolderResult> {
	const normalizedName = normalizeProjectName(projectName);
	if (!normalizedName) {
		throw new Error('项目名称不能为空。');
	}

	const rootFolder = app.vault.getAbstractFileByPath(TASKS_ROOT_PATH);
	if (!(rootFolder instanceof TFolder)) {
		throw new Error(`请先创建 ${TASKS_ROOT_PATH} 目录。`);
	}

	const targetPath = resolveProjectTargetPath(normalizedName);
	const existingFile = app.vault.getAbstractFileByPath(targetPath);
	if (existingFile instanceof TFolder) {
		return {
			name: existingFile.name,
			path: existingFile.path,
			created: false,
		};
	}

	if (existingFile) {
		throw new Error(`目标路径不可用：${targetPath}`);
	}

	await app.vault.adapter.mkdir(targetPath);
	return {
		name: normalizedName,
		path: targetPath,
		created: true,
	};
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '')
		.replace(/\/+$/g, '');
}
