import { Notice, Plugin, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import { t } from './lang/helpter';
import {
	resolvePriorityFromSources,
	resolveStarredFromSources,
} from './tasks-center/data';
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
	TaskLinkBadgeBackgroundMode,
	TaskListGroupMode,
	TaskListSortMode,
	TaskListTimeFilter,
	TaskSearchEntryMode,
	normalizeConfiguredInputRootPath,
	normalizeConfiguredOutcomeRootPath,
	normalizeConfiguredOutputRootPath,
	normalizeConfiguredTasksRootPath,
	normalizeEnabledTaskCreationTypes,
	normalizeTaskLinkBadgeBackgroundMode,
	normalizeProjectCategoryOptions,
	normalizeProjectListGroupMode,
	normalizeProjectListSortMode,
	normalizeTaskSearchEntryMode,
} from './settings';
import {
	areBatchTemplateConfigsEqual,
	normalizeBatchTemplateConfig,
	type BatchTemplateConfig,
} from './tasks-center/batch-task-template';
import { isTaskNoteFile, buildTaskNoteMenu } from './tasks-center/task-note-menu';
import {
	IOTO_TASKS_CENTER_VIEW_TYPE,
	IOTOTasksCenterView,
} from './views/iotoTasksCenterView';
import {
	IOTO_PROJECT_CENTER_VIEW_TYPE,
	IOTOProjectCenterView,
} from './views/iotoProjectCenterView';
import { IOTO_TASKS_CENTER_TASK_HOVER_SOURCE_ID } from './views/task-hover-preview';
// import {
// 	batchClearPriority,
// 	batchRemoveUpTask,
// 	batchSetStarred,
// 	confirmAndBatchDeleteTasks,
// } from './views/tasks-center/batch-edit-operations';
// import {
// 	showBatchAssignUpTaskModal,
// 	showBatchPriorityMenu,
// } from './views/tasks-center/menus';

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
					() => this.settings.colorTaskTitleByPriority,
					() => this.settings.inputRootPath,
					() => this.settings.outputRootPath,
					() => this.settings.outcomeRootPath,
					() => this.settings.showTaskSubtaskCount,
					() => this.settings.taskLinkBadgeBackgroundMode,
					() => this.settings.showTaskOutlinkCounts,
					() => this.settings.showTaskInputOutlinkCount,
					() => this.settings.showTaskOutputOutlinkCount,
					() => this.settings.showTaskOutcomeOutlinkCount,
					() => this.settings.hiddenProjectNames,
					() => this.settings.enabledTaskCreationTypes,
					(sortMode) => this.updateProjectListSortMode(sortMode),
					(groupMode) => this.updateProjectListGroupMode(groupMode),
					(sortMode) => this.updateTaskListSortMode(sortMode),
					(groupMode) => this.updateTaskListGroupMode(groupMode),
					(show) => this.updateShowTaskPriority(show),
					() => this.settings.taskListTimeFilter,
					(filter) => this.updateTaskListTimeFilter(filter),
					(type) => this.settings.taskTemplateConfigs[type],
					() => this.settings.dateTaskDateFormat,
					(projectName, hidden) =>
						this.setProjectHidden(projectName, hidden),
					() => this.settings.batchTemplateConfig,
					() => this.settings.taskSearchEntryMode,
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

		this.addCommand({
			id: 'batch-create-tasks-from-template',
			name: t('command.batchCreateTasksFromTemplate'),
			callback: () => {
				const existingLeaf = this.app.workspace.getLeavesOfType(
					IOTO_TASKS_CENTER_VIEW_TYPE,
				)[0];
				const existingView = existingLeaf?.view;
				if (existingView instanceof IOTOTasksCenterView) {
					void existingView.triggerBatchCreateFromTemplate();
					return;
				}

				void this.activateIOTOTasksCenterView().then(() => {
					const leaf = this.app.workspace.getLeavesOfType(
						IOTO_TASKS_CENTER_VIEW_TYPE,
					)[0];
					const view = leaf?.view;
					if (view instanceof IOTOTasksCenterView) {
						void view.triggerBatchCreateFromTemplate();
					}
				});
			},
		});

		this.addCommand({
			id: 'itc-toggle-batch-edit-mode',
			name: t('command.toggleBatchEditMode'),
			callback: () => {
				const view = this.getTasksCenterView();
				if (view) {
					view.toggleBatchEditMode();
					return;
				}
				void this.activateIOTOTasksCenterView().then(() => {
					this.getTasksCenterView()?.toggleBatchEditMode();
				});
			},
		});

		this.addCommand({
			id: 'itc-focus-task-search',
			name: t('command.focusTaskSearch'),
			callback: () => {
				const view = this.getTasksCenterView();
				if (view) {
					view.focusTaskSearch();
					return;
				}

				void this.activateIOTOTasksCenterView().then(() => {
					this.getTasksCenterView()?.focusTaskSearch();
				});
			},
		});

		this.addCommand({
			id: 'itc-clear-task-search',
			name: t('command.clearTaskSearch'),
			callback: () => {
				this.getTasksCenterView()?.clearTaskSearch();
			},
		});

		// this.addCommand({
		// 	id: 'itc-batch-select-all',
		// 	name: t('command.batchSelectAll'),
		// 	callback: () => {
		// 		this.getTasksCenterView()?.selectAllVisibleTasks();
		// 	},
		// });

		// this.addCommand({
		// 	id: 'itc-batch-delete-tasks',
		// 	name: t('command.batchDeleteTasks'),
		// 	callback: () => {
		// 		const view = this.getTasksCenterView();
		// 		if (!view) {
		// 			return;
		// 		}
		// 		void confirmAndBatchDeleteTasks(view);
		// 	},
		// });

		// this.addCommand({
		// 	id: 'itc-batch-set-priority',
		// 	name: t('command.batchSetPriority'),
		// 	callback: () => {
		// 		const view = this.getTasksCenterView();
		// 		if (!view) {
		// 			return;
		// 		}
		// 		showBatchPriorityMenu(view);
		// 	},
		// });

		// this.addCommand({
		// 	id: 'itc-batch-clear-priority',
		// 	name: t('command.batchClearPriority'),
		// 	callback: () => {
		// 		const view = this.getTasksCenterView();
		// 		if (!view) {
		// 			return;
		// 		}
		// 		void batchClearPriority(view);
		// 	},
		// });

		// this.addCommand({
		// 	id: 'itc-batch-set-starred',
		// 	name: t('command.batchSetStarred'),
		// 	callback: () => {
		// 		const view = this.getTasksCenterView();
		// 		if (!view) {
		// 			return;
		// 		}
		// 		void batchSetStarred(view, true);
		// 	},
		// });

		// this.addCommand({
		// 	id: 'itc-batch-clear-starred',
		// 	name: t('command.batchClearStarred'),
		// 	callback: () => {
		// 		const view = this.getTasksCenterView();
		// 		if (!view) {
		// 			return;
		// 		}
		// 		void batchSetStarred(view, false);
		// 	},
		// });

		// this.addCommand({
		// 	id: 'itc-batch-assign-up-task',
		// 	name: t('command.batchAssignUpTask'),
		// 	callback: () => {
		// 		const view = this.getTasksCenterView();
		// 		if (!view) {
		// 			return;
		// 		}
		// 		void showBatchAssignUpTaskModal(view);
		// 	},
		// });

		// this.addCommand({
		// 	id: 'itc-batch-remove-up-task',
		// 	name: t('command.batchRemoveUpTask'),
		// 	callback: () => {
		// 		const view = this.getTasksCenterView();
		// 		if (!view) {
		// 			return;
		// 		}
		// 		void batchRemoveUpTask(view);
		// 	},
		// });

		this.addSettingTab(new IOTOTasksCenterSettingTab(this.app, this));
		this.registerVaultRefreshEvents();
		this.registerTaskNoteMenuEvent();
	}

	async loadSettings() {
		const loadedData = (await this.loadData()) as
			| (Partial<IOTOTasksCenterSettings> & {
					taskTemplatePath?: string;
					resultRootPath?: string;
			  })
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
		if (
			loadedData &&
			!('outcomeRootPath' in loadedData) &&
			typeof loadedData.resultRootPath === 'string'
		) {
			this.settings.outcomeRootPath = loadedData.resultRootPath;
		}
		this.settings.outcomeRootPath = normalizeConfiguredOutcomeRootPath(
			this.settings.outcomeRootPath,
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
		this.settings.taskLinkBadgeBackgroundMode =
			normalizeTaskLinkBadgeBackgroundMode(
				loadedData?.taskLinkBadgeBackgroundMode,
			);
		this.settings.dateTaskDateFormat = normalizeDateTaskDateFormat(
			this.settings.dateTaskDateFormat,
		);
		this.settings.projectCategoryOptions = normalizeProjectCategoryOptions(
			loadedData?.projectCategoryOptions,
		);
		this.settings.batchTemplateConfig = normalizeBatchTemplateConfig(
			loadedData?.batchTemplateConfig,
		);
		this.settings.taskSearchEntryMode = normalizeTaskSearchEntryMode(
			loadedData?.taskSearchEntryMode,
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

	// 这两个开关只在下次打开菜单时生效，不影响已渲染的视图，无需刷新。
	async updateShowTaskNoteCoreMenu(show: boolean): Promise<void> {
		if (this.settings.showTaskNoteCoreMenu === show) {
			return;
		}

		this.settings.showTaskNoteCoreMenu = show;
		await this.saveSettings();
	}

	async updateShowTaskNotePriorityMenu(show: boolean): Promise<void> {
		if (this.settings.showTaskNotePriorityMenu === show) {
			return;
		}

		this.settings.showTaskNotePriorityMenu = show;
		await this.saveSettings();
	}

	async updateColorTaskTitleByPriority(color: boolean): Promise<void> {
		if (this.settings.colorTaskTitleByPriority === color) {
			return;
		}

		this.settings.colorTaskTitleByPriority = color;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateTaskListTimeFilter(filter: TaskListTimeFilter): Promise<void> {
		if (this.settings.taskListTimeFilter === filter) {
			return;
		}

		this.settings.taskListTimeFilter = filter;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateShowTaskOutlinkCounts(show: boolean): Promise<void> {
		if (this.settings.showTaskOutlinkCounts === show) {
			return;
		}

		this.settings.showTaskOutlinkCounts = show;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateTaskSearchEntryMode(
		mode: TaskSearchEntryMode,
	): Promise<void> {
		if (this.settings.taskSearchEntryMode === mode) {
			return;
		}

		this.settings.taskSearchEntryMode = mode;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateShowTaskSubtaskCount(show: boolean): Promise<void> {
		if (this.settings.showTaskSubtaskCount === show) {
			return;
		}

		this.settings.showTaskSubtaskCount = show;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateTaskLinkBadgeBackgroundMode(
		mode: TaskLinkBadgeBackgroundMode,
	): Promise<void> {
		if (this.settings.taskLinkBadgeBackgroundMode === mode) {
			return;
		}

		this.settings.taskLinkBadgeBackgroundMode = mode;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateShowTaskInputOutlinkCount(show: boolean): Promise<void> {
		if (this.settings.showTaskInputOutlinkCount === show) {
			return;
		}

		this.settings.showTaskInputOutlinkCount = show;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateShowTaskOutputOutlinkCount(show: boolean): Promise<void> {
		if (this.settings.showTaskOutputOutlinkCount === show) {
			return;
		}

		this.settings.showTaskOutputOutlinkCount = show;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateShowTaskOutcomeOutlinkCount(show: boolean): Promise<void> {
		if (this.settings.showTaskOutcomeOutlinkCount === show) {
			return;
		}

		this.settings.showTaskOutcomeOutlinkCount = show;
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

	async updateOutcomeRootPath(path: string): Promise<void> {
		const nextPath = normalizeConfiguredOutcomeRootPath(path);
		if (this.settings.outcomeRootPath === nextPath) {
			return;
		}

		this.settings.outcomeRootPath = nextPath;
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

	async updateBatchTemplateConfig(
		config: BatchTemplateConfig,
	): Promise<void> {
		const nextConfig = normalizeBatchTemplateConfig(config);
		if (
			areBatchTemplateConfigsEqual(
				this.settings.batchTemplateConfig,
				nextConfig,
			)
		) {
			return;
		}

		this.settings.batchTemplateConfig = nextConfig;
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

	// 让用户在文件列表右键、标签页右键、笔记标题栏 ⋯ 菜单以及内部链接右键中，
	// 直接给任务笔记设置核心任务与优先级，无需回到任务中心。
	private registerTaskNoteMenuEvent(): void {
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (
					!this.settings.showTaskNoteCoreMenu &&
					!this.settings.showTaskNotePriorityMenu
				) {
					return;
				}

				if (!isTaskNoteFile(file, this.settings.tasksRootPath)) {
					return;
				}

				const frontmatter =
					this.app.metadataCache.getFileCache(file)?.frontmatter;
				buildTaskNoteMenu({
					app: this.app,
					file,
					menu,
					settings: {
						showCore: this.settings.showTaskNoteCoreMenu,
						showPriority: this.settings.showTaskNotePriorityMenu,
					},
					starred: resolveStarredFromSources({
						metadataValue: frontmatter?.['Starred'],
					}),
					priority: resolvePriorityFromSources({
						metadataValue: frontmatter?.['Priority'],
					}),
				});
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

	private getTasksCenterView(): IOTOTasksCenterView | null {
		const leaf = this.app.workspace.getLeavesOfType(
			IOTO_TASKS_CENTER_VIEW_TYPE,
		)[0];
		const view = leaf?.view;
		return view instanceof IOTOTasksCenterView ? view : null;
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
