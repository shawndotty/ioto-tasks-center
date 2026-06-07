import { t } from '../lang/helpter';

export const DEFAULT_TASKS_ROOT_PATH = '3-任务';
export const DEFAULT_INPUT_ROOT_PATH = '1-输入';
export const DEFAULT_OUTPUT_ROOT_PATH = '2-输出';
export const DEFAULT_RESULT_ROOT_PATH = '4-成果';

export function normalizeVaultRelativePath(
	input: string,
	fallback: string,
): string {
	const normalized = input
		.trim()
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '')
		.replace(/^\/+/, '')
		.replace(/\/+$/g, '');

	return normalized.length > 0 ? normalized : fallback;
}

export function normalizeTasksRootPath(input: string): string {
	return normalizeVaultRelativePath(input, DEFAULT_TASKS_ROOT_PATH);
}

export function normalizeInputRootPath(input: string): string {
	return normalizeVaultRelativePath(input, DEFAULT_INPUT_ROOT_PATH);
}

export function normalizeOutputRootPath(input: string): string {
	return normalizeVaultRelativePath(input, DEFAULT_OUTPUT_ROOT_PATH);
}

export function normalizeResultRootPath(input: string): string {
	return normalizeVaultRelativePath(input, DEFAULT_RESULT_ROOT_PATH);
}

export interface ProjectFolderEntry {
	name: string;
	path: string;
}

export interface TaskFileEntry {
	name: string;
	basename: string;
	title: string;
	path: string;
	mtime: number;
	ctime: number;
	size: number;
	starred: boolean;
	priority?: number;
	status: TaskFileStatus;
	upTaskTitles: string[];
	indentLevel?: number;
}

export interface TaskFileStatus {
	key: TaskFileStatusKey;
	label: string;
	totalTaskCount: number;
	completedTaskCount: number;
	summary: string;
}

export type TaskFileStatusKey = 'todo' | 'in-progress' | 'completed' | 'empty';

export function getTaskStatusLabel(statusKey: TaskFileStatusKey): string {
	switch (statusKey) {
		case 'todo':
			return t('task.status.todo');
		case 'in-progress':
			return t('task.status.inProgress');
		case 'completed':
			return t('task.status.completed');
		case 'empty':
			return t('task.status.empty');
	}
}

export function buildTaskStatusSummary(
	statusKey: TaskFileStatusKey,
	totalTaskCount: number,
	completedTaskCount: number,
): string {
	switch (statusKey) {
		case 'empty':
			return t('task.status.summary.empty');
		case 'todo':
			return t('task.status.summary.todo', [String(totalTaskCount)]);
		case 'completed':
		case 'in-progress':
			return t('task.status.summary.completed', [
				String(completedTaskCount),
				String(totalTaskCount),
			]);
	}
}

export interface ProjectListResult {
	status: 'root-missing' | 'success';
	projects: ProjectFolderEntry[];
}

export interface TaskFileListResult {
	status: 'root-missing' | 'project-missing' | 'empty' | 'success';
	projectName: string;
	projectPath: string;
	tasks: TaskFileEntry[];
}
