import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';

import { listProjectFolders, listProjectTaskFiles } from '../tasks-center/data';
import {
	ProjectFolderEntry,
	ProjectListResult,
	TASKS_ROOT_PATH,
	TaskFileEntry,
	TaskFileListResult,
} from '../tasks-center/types';

export const IOTO_TASKS_CENTER_VIEW_TYPE = 'IOTOTasksCenter';

export class IOTOTasksCenterView extends ItemView {
	private projects: ProjectFolderEntry[] = [];
	private selectedProject: string | null = null;
	private tasks: TaskFileEntry[] = [];
	private openedTaskPath: string | null = null;
	private openingTaskPath: string | null = null;
	private previewLeaf: WorkspaceLeaf | null = null;
	private readonly lastOpenedTaskByProject = new Map<string, string>();
	private projectResult: ProjectListResult = {
		status: 'success',
		projects: [],
	};
	private taskResult: TaskFileListResult | null = null;
	private isProjectsLoading = false;
	private isTasksLoading = false;
	private refreshToken = 0;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.navigation = true;
	}

	getViewType(): string {
		return IOTO_TASKS_CENTER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return '任务中心';
	}

	getIcon(): string {
		return 'folder-kanban';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('ioto-tasks-center-view');
		await this.refreshFromVaultChange();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	async refreshFromVaultChange(): Promise<void> {
		const previousSelection = this.selectedProject;
		await this.loadProjects(previousSelection);
	}

	private async loadProjects(
		preferredProject?: string | null,
	): Promise<void> {
		const token = ++this.refreshToken;
		this.isProjectsLoading = true;
		this.render();

		const result = listProjectFolders(this.app);
		if (token !== this.refreshToken) {
			return;
		}

		this.projectResult = result;
		this.projects = result.projects;
		this.isProjectsLoading = false;

		if (result.status !== 'success' || result.projects.length === 0) {
			this.selectedProject = null;
			this.taskResult = null;
			this.tasks = [];
			this.isTasksLoading = false;
			this.render();
			return;
		}

		const nextProject = this.resolveSelectedProject(preferredProject);
		await this.selectProject(nextProject);
	}

	private resolveSelectedProject(preferredProject?: string | null): string {
		if (
			preferredProject &&
			this.projects.some((project) => project.name === preferredProject)
		) {
			return preferredProject;
		}

		const fallbackProject = this.projects[0];
		if (!fallbackProject) {
			throw new Error('No project is available for selection.');
		}

		return fallbackProject.name;
	}

	private async selectProject(projectName: string): Promise<void> {
		this.selectedProject = projectName;
		this.isTasksLoading = true;
		this.render();
		await this.loadTasks(projectName);
	}

	private async loadTasks(projectName: string): Promise<void> {
		const token = ++this.refreshToken;
		const result = listProjectTaskFiles(this.app, projectName);

		if (token !== this.refreshToken) {
			return;
		}

		this.taskResult = result;
		this.tasks = result.tasks;
		this.isTasksLoading = false;
		this.openedTaskPath = this.getCachedTaskPath(projectName);

		if (result.status === 'project-missing') {
			const nextProject = this.resolveSelectedProject(projectName);
			if (nextProject !== projectName) {
				await this.selectProject(nextProject);
				return;
			}
		}

		this.render();
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();

		const viewEl = root.createDiv({ cls: 'ioto-tasks-center' });
		const projectsPane = viewEl.createDiv({
			cls: 'ioto-tasks-center__pane ioto-tasks-center__pane--projects',
		});
		const tasksPane = viewEl.createDiv({
			cls: 'ioto-tasks-center__pane ioto-tasks-center__pane--tasks',
		});

		this.renderProjectsPane(projectsPane);
		this.renderTasksPane(tasksPane);
	}

	private renderProjectsPane(container: HTMLElement): void {
		container.createDiv({
			cls: 'ioto-tasks-center__section-title',
			text: '项目列表',
		});

		const helperText = this.isProjectsLoading
			? '正在扫描 3-任务 根目录...'
			: '选择一个项目后，在右侧查看对应任务文件。';
		container.createDiv({
			cls: 'ioto-tasks-center__section-desc',
			text: helperText,
		});

		const listEl = container.createDiv({
			cls: 'ioto-tasks-center__project-list',
		});

		if (this.isProjectsLoading) {
			this.renderState(
				listEl,
				'正在加载项目',
				`正在读取 ${TASKS_ROOT_PATH} 下的一级子目录。`,
				'is-loading',
			);
			return;
		}

		if (this.projectResult.status === 'root-missing') {
			this.renderState(
				listEl,
				'未找到任务根目录',
				`请先在 vault 中创建 ${TASKS_ROOT_PATH} 目录。`,
				'is-empty',
			);
			return;
		}

		if (this.projects.length === 0) {
			this.renderState(
				listEl,
				'暂无项目',
				`${TASKS_ROOT_PATH} 下还没有一级项目文件夹。`,
				'is-empty',
			);
			return;
		}

		for (const project of this.projects) {
			const itemEl = listEl.createEl('button', {
				cls: 'ioto-tasks-center__project-item',
				text: project.name,
			});
			itemEl.type = 'button';

			if (project.name === this.selectedProject) {
				itemEl.addClass('is-selected');
			}

			itemEl.addEventListener('click', () => {
				if (
					project.name === this.selectedProject ||
					this.isTasksLoading
				) {
					return;
				}

				void this.selectProject(project.name);
			});
		}
	}

	private renderTasksPane(container: HTMLElement): void {
		container.createDiv({
			cls: 'ioto-tasks-center__section-title',
			text: '任务列表',
		});

		const currentProjectText = this.selectedProject
			? `当前项目：${this.selectedProject}，共 ${this.tasks.length} 个文件，按最近修改时间排序`
			: '当前未选中任何项目';
		container.createDiv({
			cls: 'ioto-tasks-center__section-desc',
			text: currentProjectText,
		});

		const listEl = container.createDiv({
			cls: 'ioto-tasks-center__task-list',
		});

		if (this.projectResult.status === 'root-missing') {
			this.renderState(
				listEl,
				'无法加载任务',
				`${TASKS_ROOT_PATH} 根目录不存在，因此无法读取任务文件。`,
				'is-empty',
			);
			return;
		}

		if (!this.selectedProject) {
			this.renderState(
				listEl,
				'请选择项目',
				'左侧存在项目时会自动选中首项，否则请先创建项目目录。',
				'is-empty',
			);
			return;
		}

		if (this.isTasksLoading) {
			this.renderState(
				listEl,
				'正在加载任务',
				`正在读取 ${TASKS_ROOT_PATH}/${this.selectedProject} 下的 Markdown 文件。`,
				'is-loading',
			);
			return;
		}

		if (!this.taskResult) {
			this.renderState(
				listEl,
				'暂无任务数据',
				'等待视图完成首次任务加载。',
				'is-empty',
			);
			return;
		}

		if (this.taskResult.status === 'project-missing') {
			this.renderState(
				listEl,
				'项目目录不存在',
				`${this.taskResult.projectPath} 当前不可用，视图将在下次刷新时重新校正。`,
				'is-empty',
			);
			return;
		}

		if (this.taskResult.status === 'empty') {
			this.renderState(
				listEl,
				'暂无任务文件',
				`${this.taskResult.projectPath} 下还没有 Markdown 任务文件。`,
				'is-empty',
			);
			return;
		}

		for (const task of this.tasks) {
			const rowEl = listEl.createEl('button', {
				cls: 'ioto-tasks-center__task-row',
			});
			rowEl.type = 'button';

			if (task.path === this.openedTaskPath) {
				rowEl.addClass('is-active');
			}

			if (task.path === this.openingTaskPath) {
				rowEl.addClass('is-opening');
			}

			rowEl.createDiv({
				cls: 'ioto-tasks-center__task-title',
				text: task.basename,
			});
			const statusEl = rowEl.createSpan({
				cls: `ioto-tasks-center__task-status ioto-tasks-center__task-status--${task.status.key}`,
				text: task.status.label,
			});
			statusEl.ariaLabel = `任务状态：${task.status.label}`;

			rowEl.addEventListener('click', () => {
				void this.openTaskFile(task);
			});
		}
	}

	private renderState(
		container: HTMLElement,
		title: string,
		description: string,
		stateClass: 'is-empty' | 'is-loading',
	): void {
		const stateEl = container.createDiv({
			cls: `ioto-tasks-center__state ${stateClass}`,
		});
		stateEl.createDiv({
			cls: 'ioto-tasks-center__state-title',
			text: title,
		});
		stateEl.createDiv({
			cls: 'ioto-tasks-center__state-desc',
			text: description,
		});
	}

	private getCachedTaskPath(projectName: string): string | null {
		const cachedTaskPath = this.lastOpenedTaskByProject.get(projectName);
		if (!cachedTaskPath) {
			return null;
		}

		return this.tasks.some((task) => task.path === cachedTaskPath)
			? cachedTaskPath
			: null;
	}

	private async openTaskFile(task: TaskFileEntry): Promise<void> {
		if (
			task.path === this.openedTaskPath &&
			this.previewLeaf &&
			this.isLeafAvailable(this.previewLeaf)
		) {
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			return;
		}

		this.openingTaskPath = task.path;
		this.render();

		try {
			const leaf = this.ensurePreviewLeaf();
			await leaf.openFile(file, {
				active: false,
			});
			this.previewLeaf = leaf;
			this.openedTaskPath = task.path;
			if (this.selectedProject) {
				this.lastOpenedTaskByProject.set(
					this.selectedProject,
					task.path,
				);
			}
		} finally {
			this.openingTaskPath = null;
			this.render();
		}
	}

	private ensurePreviewLeaf(): WorkspaceLeaf {
		if (this.previewLeaf && this.isLeafAvailable(this.previewLeaf)) {
			return this.previewLeaf;
		}

		const previewLeaf = this.app.workspace.createLeafBySplit(
			this.leaf,
			'vertical',
		);
		this.previewLeaf = previewLeaf;
		return previewLeaf;
	}

	private isLeafAvailable(targetLeaf: WorkspaceLeaf): boolean {
		let exists = false;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf === targetLeaf) {
				exists = true;
			}
		});
		return exists;
	}
}
