import type { TFile } from 'obsidian';

export function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '')
		.replace(/\/+$/g, '');
}

export function isPathInsideRoot(path: string, rootPath: string): boolean {
	const normalizedPath = normalizeVaultPath(path);
	const normalizedRootPath = normalizeVaultPath(rootPath);
	return (
		normalizedPath === normalizedRootPath ||
		normalizedPath.startsWith(`${normalizedRootPath}/`)
	);
}

export function isTaskFileInsideTasksRoot(
	file: TFile,
	tasksRootPath: string,
): boolean {
	return isPathInsideRoot(file.path, tasksRootPath);
}
