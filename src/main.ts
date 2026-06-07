import { Notice, Plugin, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { t } from './lang/helpter';
import { normalizeDateTaskDateFormat } from './tasks-center/date-task-format';
import {
	canConvertSelectedTextToSubtask,
	convertSelectedTextToSubtask,
} from './tasks-center/selected-text-subtask';
import {
	areTaskTemplateConfigsEqual,
	mergeTaskTemplateConfig,
	normalizeTaskTemplateConfigMap,
	type TaskCreationType,
	type TaskTemplateConfig,
} from './tasks-center/task-template-config';
import {
	DEFAULT_SETTINGS,
	IOTOTasksCenterSettingTab,
	IOTOTasksCenterSettings,
	ProjectListGroupMode,
	ProjectListSortMode,
	TaskListGroupMode,
	TaskListSortMode,
	normalizeConfiguredInputRootPath,
	normalizeConfiguredOutputRootPath,
	normalizeConfiguredResultRootPath,
	normalizeConfiguredTasksRootPath,
	normalizeEnabledTaskCreationTypes,
	normalizeProjectCategoryOptions,
	normalizeProjectListGroupMode,
	normalizeProjectListSortMode,
} from './settings';
import {
	IOTO_TASKS_CENTER_VIEW_TYPE,
	IOTOTasksCenterView,
} from './views/iotoTasksCenterView';
import {
	IOTO_PROJECT_CENTER_VIEW_TYPE,
	IOTOProjectCenterView,
} from './views/iotoProjectCenterView';
import { IOTO_TASKS_CENTER_TASK_HOVER_SOURCE_ID } from './views/task-hover-preview';

export default class IOTOTasksCenter extends Plugin {
	settings!: IOTOTasksCenterSettings;

	async onload() {
		await this.loadSettings();
		this.registerHoverLinkSource(IOTO_TASKS_CENTER_TASK_HOVER_SOURCE_ID, {
			display: 'IOTO Tasks Center',
			defaultMod: true,
		});
		this.registerView(
			IOTO_TASKS_CENTER_VIEW_TYPE,
			(leaf) =>
				new IOTOTasksCenterView(
					leaf,
					() => this.settings.tasksRootPath,
					() => this.settings.projectListSortMode,
					() => this.settings.projectListGroupMode,
					() => this.settings.taskListSortMode,
					() => this.settings.taskListGroupMode,
					() => this.settings.showTaskPriority,
					() => this.settings.hiddenProjectNames,
					() => this.settings.enabledTaskCreationTypes,
					(sortMode) => this.updateProjectListSortMode(sortMode),
					(groupMode) => this.updateProjectListGroupMode(groupMode),
					(sortMode) => this.updateTaskListSortMode(sortMode),
					(groupMode) => this.updateTaskListGroupMode(groupMode),
					(show) => this.updateShowTaskPriority(show),
					(type) => this.settings.taskTemplateConfigs[type],
					() => this.settings.dateTaskDateFormat,
				),
		);
		this.registerView(
			IOTO_PROJECT_CENTER_VIEW_TYPE,
			(leaf) =>
				new IOTOProjectCenterView(
					leaf,
					() => this.settings.tasksRootPath,
					() => this.settings.hiddenProjectNames,
					(projectName, hidden) =>
						this.setProjectHidden(projectName, hidden),
					() => this.settings.projectCategoryOptions,
					(category) => this.addProjectCategoryOption(category),
				),
		);

		this.addCommand({
			id: 'open-tasks-center-view',
			name: t('command.openTasksCenterView'),
			callback: () => this.activateIOTOTasksCenterView(),
		});
		this.addCommand({
			id: 'open-project-center-view',
			name: t('command.openProjectCenterView'),
			callback: () => this.activateIOTOProjectCenterView(),
		});

		this.addCommand({
			id: 'convert-selected-text-to-subtask',
			name: t('command.convertSelectedTextToSubtask'),
			editorCheckCallback: (checking, editor, ctx) => {
				const canExecute = canConvertSelectedTextToSubtask(
					ctx.file,
					editor.getSelection(),
					this.settings.tasksRootPath,
				);
				if (!canExecute) {
					return false;
				}

				if (!checking) {
					void convertSelectedTextToSubtask({
						app: this.app,
						editor,
						ctx,
						tasksRootPath: this.settings.tasksRootPath,
						templateConfig:
							this.settings.taskTemplateConfigs.normal,
						dateTaskDateFormat: this.settings.dateTaskDateFormat,
					}).catch((error: unknown) => {
						const message =
							error instanceof Error
								? error.message
								: t(
										'notice.convertSelectedTextToSubtaskFailed',
									);
						new Notice(message);
					});
				}

				return true;
			},
		});

		this.addSettingTab(new IOTOTasksCenterSettingTab(this.app, this));
		this.registerVaultRefreshEvents();
	}

	async loadSettings() {
		const loadedData = (await this.loadData()) as
			| (Partial<IOTOTasksCenterSettings> & { taskTemplatePath?: string })
			| null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData ?? {});
		this.settings.tasksRootPath = normalizeConfiguredTasksRootPath(
			this.settings.tasksRootPath,
		);
		this.settings.inputRootPath = normalizeConfiguredInputRootPath(
			this.settings.inputRootPath,
		);
		this.settings.outputRootPath = normalizeConfiguredOutputRootPath(
			this.settings.outputRootPath,
		);
		this.settings.resultRootPath = normalizeConfiguredResultRootPath(
			this.settings.resultRootPath,
		);
		this.settings.taskTemplateConfigs = normalizeTaskTemplateConfigMap(
			loadedData?.taskTemplateConfigs,
			loadedData?.taskTemplatePath,
		);
		this.settings.projectListSortMode = normalizeProjectListSortMode(
			loadedData?.projectListSortMode,
		);
		this.settings.projectListGroupMode = normalizeProjectListGroupMode(
			loadedData?.projectListGroupMode,
		);
		this.settings.enabledTaskCreationTypes =
			normalizeEnabledTaskCreationTypes(
				loadedData?.enabledTaskCreationTypes,
			);
		this.settings.dateTaskDateFormat = normalizeDateTaskDateFormat(
			this.settings.dateTaskDateFormat,
		);
		this.settings.projectCategoryOptions = normalizeProjectCategoryOptions(
			loadedData?.projectCategoryOptions,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async updateProjectListSortMode(
		sortMode: ProjectListSortMode,
	): Promise<void> {
		if (this.settings.projectListSortMode === sortMode) {
			return;
		}

		this.settings.projectListSortMode = sortMode;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateProjectListGroupMode(
		groupMode: ProjectListGroupMode,
	): Promise<void> {
		if (this.settings.projectListGroupMode === groupMode) {
			return;
		}

		this.settings.projectListGroupMode = groupMode;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateTaskListSortMode(sortMode: TaskListSortMode): Promise<void> {
		if (this.settings.taskListSortMode === sortMode) {
			return;
		}

		this.settings.taskListSortMode = sortMode;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateTaskListGroupMode(groupMode: TaskListGroupMode): Promise<void> {
		if (this.settings.taskListGroupMode === groupMode) {
			return;
		}

		this.settings.taskListGroupMode = groupMode;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateShowTaskPriority(show: boolean): Promise<void> {
		if (this.settings.showTaskPriority === show) {
			return;
		}

		this.settings.showTaskPriority = show;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateTasksRootPath(path: string): Promise<void> {
		const nextPath = normalizeConfiguredTasksRootPath(path);
		if (this.settings.tasksRootPath === nextPath) {
			return;
		}

		this.settings.tasksRootPath = nextPath;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateInputRootPath(path: string): Promise<void> {
		const nextPath = normalizeConfiguredInputRootPath(path);
		if (this.settings.inputRootPath === nextPath) {
			return;
		}

		this.settings.inputRootPath = nextPath;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateOutputRootPath(path: string): Promise<void> {
		const nextPath = normalizeConfiguredOutputRootPath(path);
		if (this.settings.outputRootPath === nextPath) {
			return;
		}

		this.settings.outputRootPath = nextPath;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateResultRootPath(path: string): Promise<void> {
		const nextPath = normalizeConfiguredResultRootPath(path);
		if (this.settings.resultRootPath === nextPath) {
			return;
		}

		this.settings.resultRootPath = nextPath;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async setProjectHidden(
		projectName: string,
		hidden: boolean,
	): Promise<void> {
		const hiddenProjectNameSet = new Set(this.settings.hiddenProjectNames);
		if (hidden) {
			hiddenProjectNameSet.add(projectName);
		} else {
			hiddenProjectNameSet.delete(projectName);
		}

		const nextHiddenProjectNames = [...hiddenProjectNameSet].sort(
			(left, right) =>
				left.localeCompare(right, undefined, { numeric: true }),
		);
		if (
			areStringArraysEqual(
				this.settings.hiddenProjectNames,
				nextHiddenProjectNames,
			)
		) {
			return;
		}

		this.settings.hiddenProjectNames = nextHiddenProjectNames;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateTaskTemplateConfig(
		type: TaskCreationType,
		config: Partial<TaskTemplateConfig>,
	): Promise<void> {
		const currentConfig = this.settings.taskTemplateConfigs[type];
		const nextConfig = mergeTaskTemplateConfig(currentConfig, config);
		if (areTaskTemplateConfigsEqual(currentConfig, nextConfig)) {
			return;
		}

		this.settings.taskTemplateConfigs = {
			...this.settings.taskTemplateConfigs,
			[type]: nextConfig,
		};
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateDateTaskDateFormat(format: string): Promise<void> {
		const nextFormat = normalizeDateTaskDateFormat(format);

		if (this.settings.dateTaskDateFormat === nextFormat) {
			return;
		}

		this.settings.dateTaskDateFormat = nextFormat;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateEnabledTaskCreationTypes(
		types: TaskCreationType[],
	): Promise<void> {
		const nextTypes = normalizeEnabledTaskCreationTypes(types);
		if (
			areStringArraysEqual(
				this.settings.enabledTaskCreationTypes,
				nextTypes,
			)
		) {
			return;
		}

		this.settings.enabledTaskCreationTypes = nextTypes;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async addProjectCategoryOption(category: string): Promise<void> {
		const normalized = category.trim();
		if (!normalized) {
			return;
		}

		const categorySet = new Set(this.settings.projectCategoryOptions);
		categorySet.add(normalized);
		const nextCategories = [...categorySet].sort((left, right) =>
			left.localeCompare(right, undefined, { numeric: true }),
		);
		if (
			areStringArraysEqual(
				this.settings.projectCategoryOptions,
				nextCategories,
			)
		) {
			return;
		}

		this.settings.projectCategoryOptions = nextCategories;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	private registerVaultRefreshEvents(): void {
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				void this.handleVaultChange(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				void this.handleVaultChange(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				void this.handleVaultChange(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				void this.handleVaultChange(file, oldPath);
			}),
		);
	}

	async activateIOTOTasksCenterView(): Promise<void> {
		const leaf = this.getOrCreateIOTOTasksCenterLeaf();
		await leaf.setViewState({
			type: IOTO_TASKS_CENTER_VIEW_TYPE,
			active: true,
		});
	}

	async activateIOTOProjectCenterView(): Promise<void> {
		const leaf = this.getOrCreateIOTOProjectCenterLeaf();
		await leaf.setViewState({
			type: IOTO_PROJECT_CENTER_VIEW_TYPE,
			active: true,
		});
	}

	private getOrCreateIOTOTasksCenterLeaf(): WorkspaceLeaf {
		const existingLeaf = this.app.workspace.getLeavesOfType(
			IOTO_TASKS_CENTER_VIEW_TYPE,
		)[0];
		return existingLeaf ?? this.app.workspace.getLeaf(true);
	}

	private getOrCreateIOTOProjectCenterLeaf(): WorkspaceLeaf {
		const existingLeaf = this.app.workspace.getLeavesOfType(
			IOTO_PROJECT_CENTER_VIEW_TYPE,
		)[0];
		return existingLeaf ?? this.app.workspace.getLeaf(true);
	}

	private async handleVaultChange(
		file: TAbstractFile,
		oldPath?: string,
	): Promise<void> {
		if (!this.shouldRefreshTasksCenter(file.path, oldPath)) {
			return;
		}

		await this.refreshOpenViews();
	}

	private applySettingsToOpenViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			IOTO_TASKS_CENTER_VIEW_TYPE,
		)) {
			const view = leaf.view;
			if (view instanceof IOTOTasksCenterView) {
				void view.handleSettingsChange();
			}
		}

		for (const leaf of this.app.workspace.getLeavesOfType(
			IOTO_PROJECT_CENTER_VIEW_TYPE,
		)) {
			const view = leaf.view;
			if (view instanceof IOTOProjectCenterView) {
				void view.handleSettingsChange();
			}
		}
	}

	private async refreshOpenViews(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(
			IOTO_TASKS_CENTER_VIEW_TYPE,
		)) {
			const view = leaf.view;
			if (view instanceof IOTOTasksCenterView) {
				await view.refreshFromVaultChange();
			}
		}

		for (const leaf of this.app.workspace.getLeavesOfType(
			IOTO_PROJECT_CENTER_VIEW_TYPE,
		)) {
			const view = leaf.view;
			if (view instanceof IOTOProjectCenterView) {
				await view.refreshFromVaultChange();
			}
		}
	}

	private shouldRefreshTasksCenter(path: string, oldPath?: string): boolean {
		const tasksRootPath = this.settings.tasksRootPath;
		return [path, oldPath]
			.filter((value): value is string => Boolean(value))
			.some(
				(candidate) =>
					candidate === tasksRootPath ||
					candidate.startsWith(`${tasksRootPath}/`),
			);
	}
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}
