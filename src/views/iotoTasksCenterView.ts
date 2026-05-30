import { FileView, ItemView, TFile, WorkspaceLeaf } from 'obsidian';

import { listProjectFolders, listProjectTaskFiles } from '../tasks-center/data';
import {
	ProjectFolderEntry,
	ProjectListResult,
	TASKS_ROOT_PATH,
	TaskFileEntry,
	TaskFileListResult,
} from '../tasks-center/types';

export const IOTO_TASKS_CENTER_VIEW_TYPE = 'IOTOTasksCenter';
type TaskFilterTab = 'incomplete' | 'completed' | 'all';
interface IOTOTasksCenterViewState {
	selectedProject?: string;
	activeTaskFilterTab?: TaskFilterTab;
	openedTaskPath?: string;
	previewLeafId?: string;
}

export class IOTOTasksCenterView extends ItemView {
	private projects: ProjectFolderEntry[] = [];
	private projectIncompleteCounts = new Map<string, number>();
	private selectedProject: string | null = null;
	private tasks: TaskFileEntry[] = [];
	private activeTaskFilterTab: TaskFilterTab = 'incomplete';
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

	getState(): Record<string, unknown> {
		return {
			selectedProject: this.selectedProject ?? undefined,
			activeTaskFilterTab: this.activeTaskFilterTab,
			openedTaskPath: this.openedTaskPath ?? undefined,
			previewLeafId: getWorkspaceLeafId(this.previewLeaf) ?? undefined,
		};
	}

	async setState(state: unknown): Promise<void> {
		const viewState = parseViewState(state);
		this.selectedProject = viewState.selectedProject ?? null;
		this.openedTaskPath = viewState.openedTaskPath ?? null;
		this.activeTaskFilterTab =
			viewState.activeTaskFilterTab ?? 'incomplete';
		this.previewLeaf =
			(viewState.previewLeafId
				? this.findLeafById(viewState.previewLeafId)
				: null) ?? null;
		await this.refreshFromVaultChange();
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
		this.projectIncompleteCounts = this.buildProjectIncompleteCounts(
			result.projects,
		);
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
			});
			itemEl.type = 'button';
			itemEl.createSpan({
				cls: 'ioto-tasks-center__project-name',
				text: project.name,
			});
			itemEl.createSpan({
				cls: 'ioto-tasks-center__project-count',
				text: `${this.projectIncompleteCounts.get(project.name) ?? 0}`,
			});

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

		this.renderTaskTabs(container);

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

		const visibleTasks = this.getVisibleTasks();
		if (visibleTasks.length === 0) {
			this.renderTaskFilterEmptyState(listEl);
			return;
		}

		for (const task of visibleTasks) {
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

	private renderTaskTabs(container: HTMLElement): void {
		const tabListEl = container.createDiv({
			cls: 'ioto-tasks-center__tabs',
		});
		const counts = this.getTaskFilterCounts();

		for (const tab of TASK_FILTER_TABS) {
			const tabButtonEl = tabListEl.createEl('button', {
				cls: 'ioto-tasks-center__tab',
			});
			tabButtonEl.type = 'button';
			tabButtonEl.createSpan({
				cls: 'ioto-tasks-center__tab-label',
				text: tab.label,
			});
			tabButtonEl.createSpan({
				cls: 'ioto-tasks-center__tab-count',
				text: `${counts[tab.key]}`,
			});

			if (tab.key === this.activeTaskFilterTab) {
				tabButtonEl.addClass('is-active');
			}

			tabButtonEl.addEventListener('click', () => {
				if (tab.key === this.activeTaskFilterTab) {
					return;
				}

				this.activeTaskFilterTab = tab.key;
				this.render();
			});
		}
	}

	private getVisibleTasks(): TaskFileEntry[] {
		return this.tasks.filter((task) =>
			this.matchesTaskFilterTab(task, this.activeTaskFilterTab),
		);
	}

	private getTaskFilterCounts(): Record<TaskFilterTab, number> {
		return {
			incomplete: this.tasks.filter((task) =>
				this.matchesTaskFilterTab(task, 'incomplete'),
			).length,
			completed: this.tasks.filter((task) =>
				this.matchesTaskFilterTab(task, 'completed'),
			).length,
			all: this.tasks.length,
		};
	}

	private matchesTaskFilterTab(
		task: TaskFileEntry,
		tab: TaskFilterTab,
	): boolean {
		if (tab === 'all') {
			return true;
		}

		if (tab === 'completed') {
			return task.status.key === 'completed';
		}

		return task.status.key !== 'completed';
	}

	private renderTaskFilterEmptyState(container: HTMLElement): void {
		const tabLabel =
			TASK_FILTER_TABS.find((tab) => tab.key === this.activeTaskFilterTab)
				?.label ?? '当前筛选';
		this.renderState(
			container,
			'当前筛选下暂无任务',
			`${tabLabel} 标签下没有可显示的任务文件。`,
			'is-empty',
		);
	}

	private buildProjectIncompleteCounts(
		projects: ProjectFolderEntry[],
	): Map<string, number> {
		const counts = new Map<string, number>();

		for (const project of projects) {
			const result = listProjectTaskFiles(this.app, project.name);
			const incompleteCount = result.tasks.filter(
				(task) => task.status.key !== 'completed',
			).length;
			counts.set(project.name, incompleteCount);
		}

		return counts;
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

		const recoveredLeaf = this.findReusablePreviewLeaf();
		if (recoveredLeaf) {
			this.previewLeaf = recoveredLeaf;
			return recoveredLeaf;
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

	private findReusablePreviewLeaf(): WorkspaceLeaf | null {
		if (this.openedTaskPath) {
			const openedFileLeaf = this.findLeafByFilePath(this.openedTaskPath);
			if (openedFileLeaf && openedFileLeaf !== this.leaf) {
				return openedFileLeaf;
			}
		}

		return null;
	}

	private findLeafByFilePath(filePath: string): WorkspaceLeaf | null {
		let matchedLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (matchedLeaf || leaf === this.leaf) {
				return;
			}

			const view = leaf.view;
			if (view instanceof FileView && view.file?.path === filePath) {
				matchedLeaf = leaf;
			}
		});

		return matchedLeaf;
	}

	private findLeafById(leafId: string): WorkspaceLeaf | null {
		let matchedLeaf: WorkspaceLeaf | null = null;

		this.app.workspace.iterateAllLeaves((leaf) => {
			if (matchedLeaf) {
				return;
			}

			if (getWorkspaceLeafId(leaf) === leafId) {
				matchedLeaf = leaf;
			}
		});

		return matchedLeaf;
	}
}

const TASK_FILTER_TABS: Array<{ key: TaskFilterTab; label: string }> = [
	{ key: 'incomplete', label: '未完成' },
	{ key: 'completed', label: '已完成' },
	{ key: 'all', label: '全部' },
];

function getWorkspaceLeafId(leaf: WorkspaceLeaf | null): string | null {
	if (!leaf) {
		return null;
	}

	const candidate = leaf as WorkspaceLeaf & { id?: unknown };
	return typeof candidate.id === 'string' ? candidate.id : null;
}

function parseViewState(state: unknown): IOTOTasksCenterViewState {
	if (!state || typeof state !== 'object') {
		return {};
	}

	const candidate = state as Record<string, unknown>;
	return {
		selectedProject:
			typeof candidate.selectedProject === 'string'
				? candidate.selectedProject
				: undefined,
		openedTaskPath:
			typeof candidate.openedTaskPath === 'string'
				? candidate.openedTaskPath
				: undefined,
		previewLeafId:
			typeof candidate.previewLeafId === 'string'
				? candidate.previewLeafId
				: undefined,
		activeTaskFilterTab: isTaskFilterTab(candidate.activeTaskFilterTab)
			? candidate.activeTaskFilterTab
			: undefined,
	};
}

function isTaskFilterTab(value: unknown): value is TaskFilterTab {
	return value === 'incomplete' || value === 'completed' || value === 'all';
}
