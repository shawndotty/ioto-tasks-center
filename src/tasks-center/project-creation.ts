import { App, TFolder } from 'obsidian';
import { t } from '../lang/helpter';

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

export function resolveProjectTargetPath(
	tasksRootPath: string,
	projectName: string,
): string {
	return normalizeVaultPath(`${tasksRootPath}/${projectName}`);
}

export async function createProjectFolder(
	app: App,
	tasksRootPath: string,
	projectName: string,
): Promise<CreateProjectFolderResult> {
	const normalizedName = normalizeProjectName(projectName);
	if (!normalizedName) {
		throw new Error(t('error.projectNameEmpty'));
	}

	const rootFolder = app.vault.getAbstractFileByPath(tasksRootPath);
	if (!(rootFolder instanceof TFolder)) {
		throw new Error(t('error.createProjectRootMissing', [tasksRootPath]));
	}

	const targetPath = resolveProjectTargetPath(tasksRootPath, normalizedName);
	const existingFile = app.vault.getAbstractFileByPath(targetPath);
	if (existingFile instanceof TFolder) {
		return {
			name: existingFile.name,
			path: existingFile.path,
			created: false,
		};
	}

	if (existingFile) {
		throw new Error(t('error.targetPathUnavailable', [targetPath]));
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
