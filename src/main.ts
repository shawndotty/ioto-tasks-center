import {
	Menu,
	Notice,
	Plugin,
	Scope,
	TAbstractFile,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
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
	TaskViewAppearanceStyle,
	TaskViewExportOptions,
	TaskViewExportWidthMode,
	normalizeConfiguredInputRootPath,
	normalizeConfiguredOutcomeRootPath,
	normalizeConfiguredOutputRootPath,
	normalizeConfiguredTasksRootPath,
	normalizeEnabledTaskCreationTypes,
	normalizeExportImageFixedWidth,
	normalizeExportImageScale,
	normalizeExportImageWidthMode,
	normalizeTaskLinkBadgeBackgroundMode,
	normalizeProjectCategoryOptions,
	normalizeProjectListGroupMode,
	normalizeProjectListSortMode,
	normalizeRecentTaskCount,
	normalizeTaskSearchEntryMode,
} from './settings';
import {
	areBatchTemplateConfigsEqual,
	normalizeBatchTemplateConfig,
	type BatchTemplateConfig,
} from './tasks-center/batch-task-template';
import {
	areEntryTemplateConfigsEqual,
	normalizeEntryTemplateConfig,
	type EntryTemplateConfig,
} from './tasks-center/task-entry-template';
import { isTaskNoteFile, buildTaskNoteMenu } from './tasks-center/task-note-menu';
import {
	IOTO_TASKS_CENTER_VIEW_TYPE,
	IOTOTasksCenterView,
} from './views/iotoTasksCenterView';
import {
	IOTO_PROJECT_CENTER_VIEW_TYPE,
	IOTOProjectCenterView,
} from './views/iotoProjectCenterView';
import {
	IOTO_TASK_VIEW_TYPE,
	IOTOTaskView,
	resolveModEnterHost,
	resolveSearchHost,
} from './views/iotoTaskView';
import { probeEmbeddedEditorSupport } from './views/ioto-task/embedded-editor';
import { installItemControlBridge } from './views/ioto-task/item-control-bridge';
import { registerModEnterHandler } from './views/ioto-task/select-mode-scope';
import { registerSearchHandler } from './views/ioto-task/search-scope';
import {
	IOTO_TASK_VIEW_HOVER_SOURCE_ID,
	IOTO_TASKS_CENTER_TASK_HOVER_SOURCE_ID,
} from './views/task-hover-preview';
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
	/** IOTOTask 视图是否支持内联编辑（onload 时做一次能力探测，失败则降级） */
	private supportsInlineEdit = false;

	async onload() {
		await this.loadSettings();
		this.supportsInlineEdit = probeEmbeddedEditorSupport(this.app);
		this.registerHoverLinkSource(IOTO_TASKS_CENTER_TASK_HOVER_SOURCE_ID, {
			display: 'IOTO Tasks Center',
			defaultMod: true,
		});
		// IOTO Task View 里卡片正文 / Section markdown 的双链也走核心 hover 预览
		// （[[Plan-20261004-004408]] §3.2 ②）。
		this.registerHoverLinkSource(IOTO_TASK_VIEW_HOVER_SOURCE_ID, {
			display: 'IOTO Task View',
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
					() => this.settings.showTaskHierarchy,
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
					(show) => this.updateShowTaskHierarchy(show),
					(show) => this.updateShowTaskPriority(show),
					() => this.settings.taskListTimeFilter,
					(filter) => this.updateTaskListTimeFilter(filter),
					(type) => this.settings.taskTemplateConfigs[type],
					() => this.settings.dateTaskDateFormat,
					(projectName, hidden) =>
						this.setProjectHidden(projectName, hidden),
					() => this.settings.batchTemplateConfig,
					() => this.settings.taskSearchEntryMode,
					() => this.settings.useIOTOTaskViewAsDefault,
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
		this.registerView(
			IOTO_TASK_VIEW_TYPE,
			(leaf) =>
				new IOTOTaskView(
					leaf,
					() => this.supportsInlineEdit,
					() => this.settings.appearanceStyle,
					() => this.settings.recentTaskCount,
					() => this.resolveExportOptions(),
					() => this.settings.entryTemplateConfig,
				),
		);

		// IOTOTask 选中态 Mod+Enter（macOS Command / 其它平台 Ctrl）切换完成态。
		// 核心 Keymap 在 window 上的捕获监听会抢先吃掉这个组合，DOM 层收不到，
		// 因此只能走 Scope（见 select-mode-scope.ts 顶部注释）。
		const selectModeScope = new Scope(this.app.scope);
		registerModEnterHandler(selectModeScope, () =>
			resolveModEnterHost(this.app),
		);
		this.app.keymap.pushScope(selectModeScope);
		this.register(() => this.app.keymap.popScope(selectModeScope));

		// IOTOTask 视图 Ctrl/Cmd+F 唤出关键词搜索条。核心 Keymap 在 window 捕获阶段
		// 先吃带修饰键的按键，DOM 收不到，只能走 Scope（见 search-scope.ts）。
		const searchScope = new Scope(this.app.scope);
		registerSearchHandler(searchScope, () => resolveSearchHost(this.app));
		this.app.keymap.pushScope(searchScope);
		this.register(() => this.app.keymap.popScope(searchScope));

		this.addCommand({
			id: 'itc-open-as-ioto-task',
			name: t('command.openAsIOTOTask'),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (
					!file ||
					!isTaskNoteFile(file, this.settings.tasksRootPath)
				) {
					return false;
				}

				if (!checking) {
					void this.openFileAsIOTOTask(file);
				}

				return true;
			},
		});
		this.addCommand({
			id: 'itc-open-as-markdown',
			name: t('command.openAsMarkdown'),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(
					IOTOTaskView,
				);
				if (!view) {
					return false;
				}

				if (!checking) {
					void this.setLeafToMarkdown(view.leaf);
				}

				return true;
			},
		});
		this.addCommand({
			id: 'itc-add-task',
			name: t('command.addTask'),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(
					IOTOTaskView,
				);
				// 仅当 Task View 为 active leaf 且可内联编辑时命令才可用；
				// 与工具栏「添加」按钮只读态 is-hidden 同口径（见 discuss 4.1/4.2 方案 A）。
				if (!view || !view.canAddTask()) {
					return false;
				}

				if (!checking) {
					view.triggerAddTask();
				}

				return true;
			},
		});
		// 低频操作走命令面板（不占工具栏按钮位，[[Discuss-20261006-223908]] §5.3）。
		this.addCommand({
			id: 'itc-insert-entry-template',
			name: t('command.insertEntryTemplate'),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(
					IOTOTaskView,
				);
				if (!view || !view.canInsertEntryTemplate()) {
					return false;
				}

				if (!checking) {
					void view.insertEntryTemplate();
				}

				return true;
			},
		});
		// Ctrl/Cmd+F 的移动端 / 命令面板入口（Q6：低频操作走命令面板，不占工具栏按钮位）。
		this.addCommand({
			id: 'itc-search-task-view',
			name: t('command.searchTaskView'),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(
					IOTOTaskView,
				);
				if (!view) {
					return false;
				}

				if (!checking) {
					view.revealSearch();
				}

				return true;
			},
		});
		// 导出任务视图为图片（[[Plan-20261006-102142]] §2.4）。两条命令共用同一套门控与
		// 视图实现，区别只在最后「落盘附件」还是「写系统剪贴板」。
		this.addCommand({
			id: 'itc-export-task-view-image',
			name: t('command.exportTaskViewImage'),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(
					IOTOTaskView,
				);
				if (!view) {
					return false;
				}

				if (!checking) {
					void view.exportAsImage();
				}

				return true;
			},
		});
		this.addCommand({
			id: 'itc-copy-task-view-image',
			name: t('command.copyTaskViewImage'),
			checkCallback: (checking) => {
				const view = this.app.workspace.getActiveViewOfType(
					IOTOTaskView,
				);
				if (!view) {
					return false;
				}

				if (!checking) {
					void view.copyImageToClipboard();
				}

				return true;
			},
		});

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
		// 「条目控制」桥接：让 IOTOTask 卡片内联编辑态下的 Option+I 可用
		// （[[Plan-20261003-105625]]）；`register` 会在 onunload 时还原原方法。
		this.register(installItemControlBridge(this.app));
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
		this.settings.entryTemplateConfig = normalizeEntryTemplateConfig(
			loadedData?.entryTemplateConfig,
		);
		this.settings.taskSearchEntryMode = normalizeTaskSearchEntryMode(
			loadedData?.taskSearchEntryMode,
		);
		this.settings.recentTaskCount = normalizeRecentTaskCount(
			this.settings.recentTaskCount,
		);
		// 导出图片设置：非数 / 越界一律回落默认（对齐 normalizeRecentTaskCount 的做法）
		this.settings.exportImageWidthMode = normalizeExportImageWidthMode(
			this.settings.exportImageWidthMode,
		);
		this.settings.exportImageFixedWidth = normalizeExportImageFixedWidth(
			this.settings.exportImageFixedWidth,
		);
		this.settings.exportImageScale = normalizeExportImageScale(
			this.settings.exportImageScale,
		);
		this.settings.exportImageWithHeader =
			this.settings.exportImageWithHeader === true;
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

	async updateShowTaskHierarchy(show: boolean): Promise<void> {
		if (this.settings.showTaskHierarchy === show) {
			return;
		}

		this.settings.showTaskHierarchy = show;
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

	async updateAppearanceStyle(
		style: TaskViewAppearanceStyle,
	): Promise<void> {
		if (this.settings.appearanceStyle === style) {
			return;
		}

		this.settings.appearanceStyle = style;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateUseIOTOTaskViewAsDefault(value: boolean): Promise<void> {
		if (this.settings.useIOTOTaskViewAsDefault === value) {
			return;
		}

		this.settings.useIOTOTaskViewAsDefault = value;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	async updateRecentTaskCount(value: unknown): Promise<void> {
		const count = normalizeRecentTaskCount(value);
		if (this.settings.recentTaskCount === count) {
			return;
		}

		this.settings.recentTaskCount = count;
		await this.saveSettings();
		this.applySettingsToOpenViews();
	}

	/**
	 * 组装 Task View 导出图片的运行时设置（供视图构造时注入的 provider 调用）。
	 * 惰性求值：每次导出都重取，改设置后**无需**即时刷视图（[[Plan-20261006-102142]] §2.5）。
	 */
	resolveExportOptions(): TaskViewExportOptions {
		return {
			widthMode: this.settings.exportImageWidthMode,
			fixedWidth: this.settings.exportImageFixedWidth,
			scale: this.settings.exportImageScale,
			withHeader: this.settings.exportImageWithHeader,
		};
	}

	// 导出设置改动**不**即时刷视图（下一次导出才读 provider），故不带 applySettingsToOpenViews。
	async updateExportImageWidthMode(
		mode: TaskViewExportWidthMode,
	): Promise<void> {
		if (this.settings.exportImageWidthMode === mode) {
			return;
		}

		this.settings.exportImageWidthMode = mode;
		await this.saveSettings();
	}

	async updateExportImageFixedWidth(value: unknown): Promise<void> {
		const width = normalizeExportImageFixedWidth(value);
		if (this.settings.exportImageFixedWidth === width) {
			return;
		}

		this.settings.exportImageFixedWidth = width;
		await this.saveSettings();
	}

	async updateExportImageScale(value: unknown): Promise<void> {
		const scale = normalizeExportImageScale(value);
		if (this.settings.exportImageScale === scale) {
			return;
		}

		this.settings.exportImageScale = scale;
		await this.saveSettings();
	}

	async updateExportImageWithHeader(value: boolean): Promise<void> {
		if (this.settings.exportImageWithHeader === value) {
			return;
		}

		this.settings.exportImageWithHeader = value;
		await this.saveSettings();
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

	async updateEntryTemplateConfig(
		config: EntryTemplateConfig,
	): Promise<void> {
		const nextConfig = normalizeEntryTemplateConfig(config);
		if (
			areEntryTemplateConfigsEqual(
				this.settings.entryTemplateConfig,
				nextConfig,
			)
		) {
			return;
		}

		this.settings.entryTemplateConfig = nextConfig;
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
			this.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
				if (!isTaskNoteFile(file, this.settings.tasksRootPath)) {
					return;
				}

				// 「以 IOTO 任务视图打开 / 切回 Markdown」是移动端唯一的互切入口
				// （本插件 isDesktopOnly: false，移动端没有 contextmenu）。
				this.appendTaskViewMenuItems(menu, file, leaf);

				if (
					!this.settings.showTaskNoteCoreMenu &&
					!this.settings.showTaskNotePriorityMenu
				) {
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

	private appendTaskViewMenuItems(
		menu: Menu,
		file: TFile,
		leaf?: WorkspaceLeaf,
	): void {
		menu.addItem((item) =>
			item
				.setTitle(t('menu.openAsIOTOTask'))
				.setIcon('list-todo')
				.onClick(() => {
					void this.openFileAsIOTOTask(file, leaf);
				}),
		);

		const taskLeaf = this.findIOTOTaskLeafForFile(file.path);
		if (!taskLeaf) {
			return;
		}

		menu.addItem((item) =>
			item
				.setTitle(t('menu.openAsMarkdown'))
				.setIcon('file-text')
				.onClick(() => {
					void this.setLeafToMarkdown(taskLeaf);
				}),
		);
	}

	private async openFileAsIOTOTask(
		file: TFile,
		targetLeaf?: WorkspaceLeaf,
	): Promise<void> {
		if (!isTaskNoteFile(file, this.settings.tasksRootPath)) {
			new Notice(t('notice.openAsIOTOTaskNotTaskNote'));
			return;
		}

		const leaf = targetLeaf ?? this.app.workspace.getLeaf(false);
		await leaf.setViewState({
			type: IOTO_TASK_VIEW_TYPE,
			active: true,
			state: { file: file.path },
		});
	}

	private async setLeafToMarkdown(leaf: WorkspaceLeaf): Promise<void> {
		const view = leaf.view;
		const file = view instanceof IOTOTaskView ? view.file : null;
		if (!file) {
			new Notice(t('notice.openAsIOTOTaskNoFile'));
			return;
		}

		await leaf.setViewState({
			type: 'markdown',
			active: true,
			state: {
				file: file.path,
				mode: 'source',
			},
		});
	}

	private findIOTOTaskLeafForFile(path: string): WorkspaceLeaf | null {
		let matchedLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (matchedLeaf) {
				return;
			}
			const view = leaf.view;
			if (view instanceof IOTOTaskView && view.file?.path === path) {
				matchedLeaf = leaf;
			}
		});

		return matchedLeaf;
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

		for (const leaf of this.app.workspace.getLeavesOfType(
			IOTO_TASK_VIEW_TYPE,
		)) {
			const view = leaf.view;
			if (view instanceof IOTOTaskView) {
				view.applyAppearanceStyle();
				view.applyRecentTaskCount();
				view.applyEntryTemplate();
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
