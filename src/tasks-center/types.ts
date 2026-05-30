export const TASKS_ROOT_PATH = '3-任务';

export interface ProjectFolderEntry {
	name: string;
	path: string;
}

export interface TaskFileEntry {
	name: string;
	basename: string;
	path: string;
	mtime: number;
	ctime: number;
	size: number;
	status: TaskFileStatus;
}

export interface TaskFileStatus {
	key: 'todo' | 'in-progress' | 'completed' | 'empty';
	label: '待开始' | '进行中' | '已完成' | '无任务项';
	totalTaskCount: number;
	completedTaskCount: number;
	summary: string;
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
