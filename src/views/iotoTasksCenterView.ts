import {
	FileView,
	ItemView,
	Menu,
	Notice,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';

import { listProjectFolders, listProjectTaskFiles } from '../tasks-center/data';
import { createProjectFolder } from '../tasks-center/project-creation';
import {
	filterHiddenProjectEntries,
	sortProjectEntries,
} from '../tasks-center/project-sort';
import {
	createTaskFile,
	type TaskCreationType,
} from '../tasks-center/task-creation';
import type { ProjectListSortMode } from '../settings';
import {
	ProjectFolderEntry,
	ProjectListResult,
	TaskFileEntry,
	TaskFileListResult,
} from '../tasks-center/types';
import { TaskNameModal } from '../ui/taskNameModal';
import {
	resolveActiveTaskPath,
	shouldSkipOpeningTask,
} from './task-preview-state';

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
	private isCreatingProject = false;
	private isCreatingTask = false;
	private refreshToken = 0;
	private readonly getTasksRootPath: () => string;
	private readonly getProjectListSortMode: () => ProjectListSortMode;
	private readonly getHiddenProjectNames: () => string[];
	private readonly getTaskTemplatePath: () => string;

	constructor(
		leaf: WorkspaceLeaf,
		getTasksRootPath: () => string,
		getProjectListSortMode: () => ProjectListSortMode,
		getHiddenProjectNames: () => string[],
		getTaskTemplatePath: () => string,
	) {
		super(leaf);
		this.navigation = true;
		this.getTasksRootPath = getTasksRootPath;
		this.getProjectListSortMode = getProjectListSortMode;
		this.getHiddenProjectNames = getHiddenProjectNames;
		this.getTaskTemplatePath = getTaskTemplatePath;
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

	async handleSettingsChange(): Promise<void> {
		await this.refreshFromVaultChange();
	}

	private async loadProjects(
		preferredProject?: string | null,
	): Promise<void> {
		const token = ++this.refreshToken;
		this.isProjectsLoading = true;
		this.render();

		const result = listProjectFolders(this.app, this.getTasksRootPath());
		if (token !== this.refreshToken) {
			return;
		}

		this.projectResult = result;
		this.projects = filterHiddenProjectEntries(
			result.projects,
			this.getHiddenProjectNames(),
		);
		this.projectIncompleteCounts = await this.buildProjectIncompleteCounts(
			result.projects,
		);
		this.applyProjectSorting();
		this.isProjectsLoading = false;

		if (result.status !== 'success' || this.projects.length === 0) {
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
		const result = await listProjectTaskFiles(
			this.app,
			this.getTasksRootPath(),
			projectName,
		);

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
		const tasksRootPath = this.getTasksRootPath();
		const headerEl = container.createDiv({
			cls: 'ioto-tasks-center__section-header',
		});
		headerEl.createDiv({
			cls: 'ioto-tasks-center__section-title',
			text: '项目列表',
		});
		const actionsEl = headerEl.createDiv({
			cls: 'ioto-tasks-center__section-actions',
		});
		const addProjectButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-tasks-center__icon-button',
			text: '+',
		});
		addProjectButtonEl.type = 'button';
		addProjectButtonEl.disabled = !this.canCreateProject();
		addProjectButtonEl.ariaLabel = this.getAddProjectButtonLabel();
		addProjectButtonEl.title = this.getAddProjectButtonLabel();
		addProjectButtonEl.addEventListener('click', () => {
			void this.handleCreateProject();
		});

		const helperText = this.isProjectsLoading
			? `正在扫描 ${tasksRootPath} 根目录...`
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
				`正在读取 ${tasksRootPath} 下的一级子目录。`,
				'is-loading',
			);
			return;
		}

		if (this.projectResult.status === 'root-missing') {
			this.renderState(
				listEl,
				'未找到任务根目录',
				`请先在 vault 中创建 ${tasksRootPath} 目录。`,
				'is-empty',
			);
			return;
		}

		if (this.projects.length === 0) {
			const isFilteredByHiddenProjects =
				this.projectResult.projects.length > 0;
			this.renderState(
				listEl,
				isFilteredByHiddenProjects ? '当前没有可见项目' : '暂无项目',
				isFilteredByHiddenProjects
					? '所有项目都已被隐藏，可在插件设置中随时取消隐藏。'
					: `${tasksRootPath} 下还没有一级项目文件夹。`,
				'is-empty',
			);
			return;
		}

		for (const project of this.projects) {
			const incompleteCount =
				this.projectIncompleteCounts.get(project.name) ?? 0;
			const itemEl = listEl.createEl('button', {
				cls: 'ioto-tasks-center__project-item',
			});
			itemEl.type = 'button';
			itemEl.createSpan({
				cls: 'ioto-tasks-center__project-name',
				text: project.name,
			});
			if (incompleteCount > 0) {
				itemEl.createSpan({
					cls: 'ioto-tasks-center__project-count',
					text: `${incompleteCount}`,
				});
			}

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
		const tasksRootPath = this.getTasksRootPath();
		const headerEl = container.createDiv({
			cls: 'ioto-tasks-center__section-header',
		});
		headerEl.createDiv({
			cls: 'ioto-tasks-center__section-title',
			text: '任务列表',
		});
		const actionsEl = headerEl.createDiv({
			cls: 'ioto-tasks-center__section-actions',
		});
		const addTaskButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-tasks-center__add-task-button',
			text: this.isCreatingTask ? '创建中...' : '添加任务',
		});
		addTaskButtonEl.type = 'button';
		addTaskButtonEl.disabled = !this.canCreateTask();
		addTaskButtonEl.ariaLabel = this.getAddTaskButtonLabel();
		addTaskButtonEl.title = this.getAddTaskButtonLabel();
		addTaskButtonEl.addEventListener('click', (event) => {
			void this.showTaskCreationMenu(event);
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
				`${tasksRootPath} 根目录不存在，因此无法读取任务文件。`,
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
				`正在读取 ${tasksRootPath}/${this.selectedProject} 下的 Markdown 文件。`,
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

		const activeTaskPath = this.getActiveTaskPath();

		for (const task of visibleTasks) {
			const rowEl = listEl.createEl('button', {
				cls: 'ioto-tasks-center__task-row',
			});
			rowEl.type = 'button';

			if (task.path === activeTaskPath) {
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

	private canCreateTask(): boolean {
		return Boolean(
			this.selectedProject &&
			!this.isProjectsLoading &&
			!this.isTasksLoading &&
			!this.isCreatingTask &&
			this.projects.some(
				(project) => project.name === this.selectedProject,
			),
		);
	}

	private getAddTaskButtonLabel(): string {
		if (this.isCreatingTask) {
			return '正在创建任务文件';
		}

		if (!this.selectedProject) {
			return '请先选择一个项目';
		}

		if (this.isProjectsLoading || this.isTasksLoading) {
			return '任务列表加载完成后才能创建';
		}

		return `在 ${this.selectedProject} 项目下添加任务`;
	}

	private canCreateProject(): boolean {
		return (
			!this.isProjectsLoading &&
			!this.isCreatingProject &&
			this.projectResult.status !== 'root-missing'
		);
	}

	private getAddProjectButtonLabel(): string {
		const tasksRootPath = this.getTasksRootPath();
		if (this.isCreatingProject) {
			return '正在创建项目';
		}

		if (this.isProjectsLoading) {
			return '项目列表加载完成后才能创建';
		}

		if (this.projectResult.status === 'root-missing') {
			return `请先创建 ${tasksRootPath} 目录`;
		}

		return `在 ${tasksRootPath} 下添加项目`;
	}

	private async handleCreateProject(): Promise<void> {
		if (!this.canCreateProject()) {
			return;
		}

		const projectNameResult = await new TaskNameModal(
			this.app,
			'新建项目',
			'输入项目名称',
			{
				descriptionText: '请输入新项目的名称。',
				confirmButtonText: '创建',
			},
		).openAndGetValue();
		if (!projectNameResult) {
			return;
		}

		this.isCreatingProject = true;
		this.render();

		try {
			const result = await createProjectFolder(
				this.app,
				this.getTasksRootPath(),
				projectNameResult,
			);
			if (!result.created) {
				new Notice('该项目已存在，已为你选中现有项目。');
			}
			await this.loadProjects(result.name);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : '创建项目失败。';
			new Notice(message);
		} finally {
			this.isCreatingProject = false;
			this.render();
		}
	}

	private async showTaskCreationMenu(event: MouseEvent): Promise<void> {
		if (!this.canCreateTask()) {
			return;
		}

		const menu = new Menu();
		for (const option of TASK_CREATION_OPTIONS) {
			menu.addItem((item) =>
				item.setTitle(option.label).onClick(() => {
					void this.handleCreateTask(option.key);
				}),
			);
		}
		menu.showAtMouseEvent(event);
	}

	private async handleCreateTask(type: TaskCreationType): Promise<void> {
		const projectName = this.selectedProject;
		if (
			!projectName ||
			!this.projects.some((project) => project.name === projectName)
		) {
			new Notice('当前项目不可用，请重新选择后再试。');
			return;
		}

		let customName: string | undefined;
		if (type !== 'date') {
			const customNameResult = await new TaskNameModal(
				this.app,
				type === 'plan' ? '新建计划任务' : '新建主题任务',
				type === 'plan' ? '输入计划名称' : '输入主题名称',
				{
					descriptionText: '请输入新任务文件的名称。',
					confirmButtonText: '创建',
				},
			).openAndGetValue();
			if (!customNameResult) {
				return;
			}
			customName = customNameResult;
		}

		this.isCreatingTask = true;
		this.render();

		try {
			const previewLeaf = this.ensurePreviewLeaf();
			const result = await createTaskFile({
				app: this.app,
				tasksRootPath: this.getTasksRootPath(),
				projectName,
				type,
				customName,
				templatePath: this.getTaskTemplatePath(),
				targetLeaf: previewLeaf,
				sourceLeaf: this.leaf,
			});
			this.previewLeaf = previewLeaf;
			this.lastOpenedTaskByProject.set(projectName, result.file.path);
			await this.refreshFromVaultChange();
			await this.openFileInPreview(result.file);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : '创建任务文件失败。';
			new Notice(message);
		} finally {
			this.isCreatingTask = false;
			this.render();
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

		return isIncompleteTaskStatus(task.status.key);
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

	private async buildProjectIncompleteCounts(
		projects: ProjectFolderEntry[],
	): Promise<Map<string, number>> {
		const tasksRootPath = this.getTasksRootPath();
		const entries = await Promise.all(
			projects.map(async (project) => {
				const result = await listProjectTaskFiles(
					this.app,
					tasksRootPath,
					project.name,
				);
				const incompleteCount = result.tasks.filter((task) =>
					isIncompleteTaskStatus(task.status.key),
				).length;
				return [project.name, incompleteCount] as const;
			}),
		);

		return new Map(entries);
	}

	private applyProjectSorting(): void {
		this.projects = sortProjectEntries(
			this.projects,
			this.projectIncompleteCounts,
			this.getProjectListSortMode(),
		);
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
		const previewLeafAvailable = Boolean(
			this.previewLeaf && this.isLeafAvailable(this.previewLeaf),
		);
		const previewedFilePath = this.getPreviewLeafFilePath();
		if (
			shouldSkipOpeningTask({
				targetTaskPath: task.path,
				openedTaskPath: this.openedTaskPath,
				previewLeafAvailable,
				previewedFilePath,
			})
		) {
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			return;
		}

		await this.openFileInPreview(file);
	}

	private async openFileInPreview(file: TFile): Promise<void> {
		this.openingTaskPath = file.path;
		this.render();

		try {
			const leaf = this.ensurePreviewLeaf();
			await leaf.openFile(file, {
				active: false,
			});
			this.previewLeaf = leaf;
			this.openedTaskPath = file.path;
			if (this.selectedProject) {
				this.lastOpenedTaskByProject.set(
					this.selectedProject,
					file.path,
				);
			}
		} finally {
			this.openingTaskPath = null;
			this.render();
		}
	}

	private getActiveTaskPath(): string | null {
		return resolveActiveTaskPath({
			openedTaskPath: this.openedTaskPath,
			previewLeafAvailable: Boolean(
				this.previewLeaf && this.isLeafAvailable(this.previewLeaf),
			),
			previewedFilePath: this.getPreviewLeafFilePath(),
		});
	}

	private getPreviewLeafFilePath(): string | null {
		if (!this.previewLeaf || !this.isLeafAvailable(this.previewLeaf)) {
			return null;
		}

		const view = this.previewLeaf.view;
		return view instanceof FileView && view.file ? view.file.path : null;
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

const TASK_CREATION_OPTIONS: Array<{ key: TaskCreationType; label: string }> = [
	{ key: 'date', label: '日期任务' },
	{ key: 'plan', label: '计划任务' },
	{ key: 'topic', label: '主题任务' },
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

function isIncompleteTaskStatus(
	statusKey: TaskFileEntry['status']['key'],
): boolean {
	return statusKey === 'todo' || statusKey === 'in-progress';
}
