import { t } from '../lang/helpter';

export const DEFAULT_TASKS_ROOT_PATH = '3-任务';
export const DEFAULT_INPUT_ROOT_PATH = '1-输入';
export const DEFAULT_OUTPUT_ROOT_PATH = '2-输出';
export const DEFAULT_OUTCOME_ROOT_PATH = '4-成果';

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

export function normalizeOutcomeRootPath(input: string): string {
	return normalizeVaultRelativePath(input, DEFAULT_OUTCOME_ROOT_PATH);
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
	content: string;
}

export interface TaskFileStatus {
	key: TaskFileStatusKey;
	label: string;
	totalTaskCount: number;
	completedTaskCount: number;
	summary: string;
}

export interface IncompleteChecklistItem {
	text: string;
	line: number;
	lineText: string;
	selectionStartCh: number;
	selectionEndCh: number;
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

/** 任务链接浏览窗口的分类（tab 顺序见 `TASK_LINK_CATEGORIES`）。 */
export type TaskLinkCategory =
	| 'subtask'
	| 'input'
	| 'output'
	| 'outcome'
	| 'other';

/** 条目的打开语义：任务笔记走任务视图，其余走普通文件。 */
export type TaskLinkEntryKind = 'task' | 'note';

export interface TaskLinkEntry {
	path: string;
	/** 主标题：与任务列表 / outlink popover 同一展示口径。 */
	title: string;
	/** 次级行：vault 相对路径（已去 `.md`），用于同名消歧。 */
	subPath: string;
	/** 打开语义由快照判定，列表不再按分类猜（第 5 个分类必然猜错）。 */
	kind: TaskLinkEntryKind;
}

export interface TaskLinksRoots {
	tasksRootPath: string;
	inputRootPath: string;
	outputRootPath: string;
	outcomeRootPath: string;
}

export interface TaskLinksSnapshot {
	taskPath: string;
	taskTitle: string;
	/** UpTask 是数组，故父级可为多个；空数组 = 不渲染该行。 */
	parents: TaskLinkEntry[];
	/** 未经过搜索过滤的完整列表。 */
	sections: Record<TaskLinkCategory, TaskLinkEntry[]>;
	/** 分类 → 在 vault 中找不到的根目录路径（第三种空态判据）。 */
	missingRoots: Partial<Record<TaskLinkCategory, string>>;
}
