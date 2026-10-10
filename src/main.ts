import {
	MarkdownView,
	Notice,
	Plugin,
	Scope,
} from 'obsidian';
import { t } from './lang/helpter';
import {
	resolvePriorityFromSources,
	resolveStarredFromSources,
} from './tasks-center/data';
import { invalidateTaskFileFields } from './tasks-center/task-file-cache';
import { PROJECT_METADATA_FILE_NAME } from './tasks-center/project-metadata';
import { VAULT_REFRESH_DEBOUNCE_MS } from './views/tasks-center/constants';
import { normalizeDateTaskDateFormat } from './tasks-center/date-task-format';
import {
	canConvertSelectedTextToSubtask,
	convertSelectedTextToSubtask,
} from './tasks-center/selected-text-subtask';
import {
	type TaskCreationType,
	type TaskTemplateConfig,
	normalizeTaskTemplateConfigMap,
} from './tasks-center/task-template-config';
import {
	DEFAULT_SETTINGS,
	IOTOTasksCenterSettingTab,
	type IOTOTasksCenterSettings,
	type ProjectListGroupMode,
	type ProjectListSortMode,
	type TaskLinkBadgeBackgroundMode,
	type TaskListGroupMode,
	type TaskListSortMode,
	type TaskListTimeFilter,
	type TaskSearchEntryMode,
	type TaskViewAppearanceStyle,
	type TaskViewExportOptions,
	type TaskViewExportWidthMode,
	normalizeConfiguredInputRootPath,
	normalizeConfiguredOutcomeRootPath,
	normalizeConfiguredOutputRootPath,
	normalizeConfiguredTasksRootPath,
	normalizeEnabledTaskCreationTypes,
	normalizeExportImageFixedWidth,
	normalizeExportImageScale,
	normalizeExportImageWidthMode,
	normalizeProjectCategoryOptions,
	normalizeProjectListGroupMode,
	normalizeProjectListSortMode,
	normalizeRecentTaskCount,
	normalizeTaskLinkBadgeBackgroundMode,
	normalizeTaskSearchEntryMode,
} from './settings';
import {
	type BatchTemplateConfig,
	normalizeBatchTemplateConfig,
} from './tasks-center/batch-task-template';
import {
	type EntryTemplateConfig,
	normalizeEntryTemplateConfig,
} from './tasks-center/task-entry-template';
import { isTaskNoteFile, buildTaskNoteMenu } from './tasks-center/task-note-menu';
import { markAllTasksDoneInMarkdown } from './tasks-center/mark-all-tasks-done';
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
// 设置更新实现（update* 薄封装转发，保持插件 public 方法语义不变）
import {
	resolveExportOptions,
	updateAppearanceStyle,
	updateBatchTemplateConfig,
	updateColorTaskTitleByPriority,
	updateDateTaskDateFormat,
	updateEnabledTaskCreationTypes,
	updateEntryTemplateConfig,
	updateExportImageFixedWidth,
	updateExportImageScale,
	updateExportImageWidthMode,
	updateExportImageWithFooter,
	updateExportImageWithHeader,
	updateInputRootPath,
	updateOutcomeRootPath,
	updateOutputRootPath,
	updateProjectListGroupMode,
	updateProjectListSortMode,
	updateRecentTaskCount,
	updateShowTaskHierarchy,
	updateShowTaskInputOutlinkCount,
	updateShowTaskNoteCoreMenu,
	updateShowTaskNotePriorityMenu,
	updateShowTaskOutlinkCounts,
	updateShowTaskOutcomeOutlinkCount,
	updateShowTaskOutputOutlinkCount,
	updateShowTaskPriority,
	updateShowTaskSubtaskCount,
	updateShowTaskViewDeleteButtonOnDesktop,
	updateTaskLinkBadgeBackgroundMode,
	updateTaskListSortMode,
	updateTaskListGroupMode,
	updateTaskListTimeFilter,
	updateTaskSearchEntryMode,
	updateTaskTemplateConfig,
	updateTasksRootPath,
	updateUseIOTOTaskViewAsDefault,
	addProjectCategoryOption,
	setProjectHidden,
} from './settings-updaters';
// 视图路由 / 激活实现
import {
	activateIOTOProjectCenterView,
	activateIOTOTasksCenterView,
	appendTaskViewMenuItems,
	getTasksCenterView,
	openFileAsIOTOTask,
	resolveTaskViewToggleDirection,
	setLeafToMarkdown,
} from './task-view-routing';

export default class IOTOTasksCenter extends Plugin {
	settings!: IOTOTasksCenterSettings;
	/** IOTOTask 视图是否支持内联编辑（onload 时做一次能力探测，失败则降级） */
	private supportsInlineEdit = false;
	private vaultRefreshTimer: number | null = null;
	private pendingFullRefresh = false;
	private readonly pendingProjectRefreshes = new Set<string>();

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
					() => this.settings.showTaskViewDeleteButtonOnDesktop,
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
					void openFileAsIOTOTask(
						this.app,
						this.settings.tasksRootPath,
						file,
					);
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
					void setLeafToMarkdown(view.leaf);
				}

				return true;
			},
		});
		// 单键双向切换（[[Discuss-20261008-214919]] 方案 A）：给已存在的两个方向配一个
		// 「状态感知」的合并键，执行路径 100% 复用 openFileAsIOTOTask / setLeafToMarkdown，
		// 不新增切换实现。保留原两条命令不动（避免丢用户已绑定的快捷键）。
		this.addCommand({
			id: 'itc-toggle-task-view',
			name: t('command.toggleTaskView'),
			checkCallback: (checking) => {
				const leaf = this.app.workspace.getMostRecentLeaf();
				if (!leaf) {
					return false;
				}

				const direction = resolveTaskViewToggleDirection(
					leaf,
					this.settings.tasksRootPath,
				);
				if (!direction) {
					return false;
				}

				if (!checking) {
					if (direction === 'to-markdown') {
						void setLeafToMarkdown(leaf);
					} else if (leaf.view instanceof MarkdownView && leaf.view.file) {
						// 显式传入活动叶子作 targetLeaf，贴合「切换作用于眼前这个叶子」的语义。
						void openFileAsIOTOTask(
							this.app,
							this.settings.tasksRootPath,
							leaf.view.file,
							leaf,
						);
					}
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
		// 把当前文件所有任务标记为完成（[[Plan-20261010-142226]] §二.5）。Task View 无核心
		// Editor → 不能用 editorCheckCallback，只能 checkCallback 双分派；两处都无 → 命令隐藏。
		this.addCommand({
			id: 'itc-mark-all-tasks-done',
			name: t('command.markAllTasksDone'),
			checkCallback: (checking) => {
				const md = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (md?.file && md.editor) {
					if (!checking) {
						markAllTasksDoneInMarkdown(md.editor);
					}
					return true;
				}
				const taskView =
					this.app.workspace.getActiveViewOfType(IOTOTaskView);
				if (taskView?.canMarkAllTasksDone()) {
					if (!checking) {
						void taskView.markAllTasksDone();
					}
					return true;
				}
				return false; // 两处都无 → 命令自动隐藏
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
		this.settings.exportImageWithFooter =
			this.settings.exportImageWithFooter === true;
		// Task View 桌面端删除按钮：非 true 一律回落 false（默认关闭）
		this.settings.showTaskViewDeleteButtonOnDesktop =
			this.settings.showTaskViewDeleteButtonOnDesktop === true;
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// --- 设置更新方法（薄封装转发到 settings-updaters，保持 public API 不变） ---

	async updateProjectListSortMode(
		sortMode: ProjectListSortMode,
	): Promise<void> {
		await updateProjectListSortMode(this, sortMode);
	}

	async updateProjectListGroupMode(
		groupMode: ProjectListGroupMode,
	): Promise<void> {
		await updateProjectListGroupMode(this, groupMode);
	}

	async updateTaskListSortMode(sortMode: TaskListSortMode): Promise<void> {
		await updateTaskListSortMode(this, sortMode);
	}

	async updateTaskListGroupMode(groupMode: TaskListGroupMode): Promise<void> {
		await updateTaskListGroupMode(this, groupMode);
	}

	async updateShowTaskHierarchy(show: boolean): Promise<void> {
		await updateShowTaskHierarchy(this, show);
	}

	async updateShowTaskPriority(show: boolean): Promise<void> {
		await updateShowTaskPriority(this, show);
	}

	async updateShowTaskNoteCoreMenu(show: boolean): Promise<void> {
		await updateShowTaskNoteCoreMenu(this, show);
	}

	async updateShowTaskNotePriorityMenu(show: boolean): Promise<void> {
		await updateShowTaskNotePriorityMenu(this, show);
	}

	async updateColorTaskTitleByPriority(color: boolean): Promise<void> {
		await updateColorTaskTitleByPriority(this, color);
	}

	async updateTaskListTimeFilter(filter: TaskListTimeFilter): Promise<void> {
		await updateTaskListTimeFilter(this, filter);
	}

	async updateShowTaskOutlinkCounts(show: boolean): Promise<void> {
		await updateShowTaskOutlinkCounts(this, show);
	}

	async updateTaskSearchEntryMode(mode: TaskSearchEntryMode): Promise<void> {
		await updateTaskSearchEntryMode(this, mode);
	}

	async updateAppearanceStyle(style: TaskViewAppearanceStyle): Promise<void> {
		await updateAppearanceStyle(this, style);
	}

	async updateUseIOTOTaskViewAsDefault(value: boolean): Promise<void> {
		await updateUseIOTOTaskViewAsDefault(this, value);
	}

	async updateRecentTaskCount(value: unknown): Promise<void> {
		await updateRecentTaskCount(this, value);
	}

	async updateShowTaskViewDeleteButtonOnDesktop(
		value: boolean,
	): Promise<void> {
		await updateShowTaskViewDeleteButtonOnDesktop(this, value);
	}

	/**
	 * 组装 Task View 导出图片的运行时设置（供视图构造时注入的 provider 调用）。
	 * 惰性求值：每次导出都重取，改设置后**无需**即时刷视图（[[Plan-20261006-102142]] §2.5）。
	 */
	resolveExportOptions(): TaskViewExportOptions {
		return resolveExportOptions(this.settings);
	}

	async updateExportImageWidthMode(
		mode: TaskViewExportWidthMode,
	): Promise<void> {
		await updateExportImageWidthMode(this, mode);
	}

	async updateExportImageFixedWidth(value: unknown): Promise<void> {
		await updateExportImageFixedWidth(this, value);
	}

	async updateExportImageScale(value: unknown): Promise<void> {
		await updateExportImageScale(this, value);
	}

	async updateExportImageWithHeader(value: boolean): Promise<void> {
		await updateExportImageWithHeader(this, value);
	}

	async updateExportImageWithFooter(value: boolean): Promise<void> {
		await updateExportImageWithFooter(this, value);
	}

	async updateShowTaskSubtaskCount(show: boolean): Promise<void> {
		await updateShowTaskSubtaskCount(this, show);
	}

	async updateTaskLinkBadgeBackgroundMode(
		mode: TaskLinkBadgeBackgroundMode,
	): Promise<void> {
		await updateTaskLinkBadgeBackgroundMode(this, mode);
	}

	async updateShowTaskInputOutlinkCount(show: boolean): Promise<void> {
		await updateShowTaskInputOutlinkCount(this, show);
	}

	async updateShowTaskOutputOutlinkCount(show: boolean): Promise<void> {
		await updateShowTaskOutputOutlinkCount(this, show);
	}

	async updateShowTaskOutcomeOutlinkCount(show: boolean): Promise<void> {
		await updateShowTaskOutcomeOutlinkCount(this, show);
	}

	async updateTasksRootPath(path: string): Promise<void> {
		// 换根后旧 path 的解析缓存永不再命中，整体清掉。
		invalidateTaskFileFields();
		await updateTasksRootPath(this, path);
	}

	async updateInputRootPath(path: string): Promise<void> {
		await updateInputRootPath(this, path);
	}

	async updateOutputRootPath(path: string): Promise<void> {
		await updateOutputRootPath(this, path);
	}

	async updateOutcomeRootPath(path: string): Promise<void> {
		await updateOutcomeRootPath(this, path);
	}

	async setProjectHidden(
		projectName: string,
		hidden: boolean,
	): Promise<void> {
		await setProjectHidden(this, projectName, hidden);
	}

	async updateTaskTemplateConfig(
		type: TaskCreationType,
		config: Partial<TaskTemplateConfig>,
	): Promise<void> {
		await updateTaskTemplateConfig(this, type, config);
	}

	async updateDateTaskDateFormat(format: string): Promise<void> {
		await updateDateTaskDateFormat(this, format);
	}

	async updateEnabledTaskCreationTypes(
		types: TaskCreationType[],
	): Promise<void> {
		await updateEnabledTaskCreationTypes(this, types);
	}

	async addProjectCategoryOption(category: string): Promise<void> {
		await addProjectCategoryOption(this, category);
	}

	async updateBatchTemplateConfig(
		config: BatchTemplateConfig,
	): Promise<void> {
		await updateBatchTemplateConfig(this, config);
	}

	async updateEntryTemplateConfig(
		config: EntryTemplateConfig,
	): Promise<void> {
		await updateEntryTemplateConfig(this, config);
	}

	// --- 视图激活（薄封装转发到 task-view-routing，保持 public API 不变） ---

	async activateIOTOTasksCenterView(): Promise<void> {
		await activateIOTOTasksCenterView(this.app);
	}

	async activateIOTOProjectCenterView(): Promise<void> {
		await activateIOTOProjectCenterView(this.app);
	}

	private getTasksCenterView(): IOTOTasksCenterView | null {
		return getTasksCenterView(this.app);
	}

	// --- 生命周期：vault 事件注册与刷新 ---

	private registerVaultRefreshEvents(): void {
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				this.queueVaultRefresh('create', file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				this.queueVaultRefresh('delete', file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				this.queueVaultRefresh('modify', file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				this.queueVaultRefresh('rename', file.path, oldPath);
			}),
		);
		this.register(() => {
			if (this.vaultRefreshTimer !== null) {
				window.clearTimeout(this.vaultRefreshTimer);
				this.vaultRefreshTimer = null;
			}
		});
	}

	/**
	 * 合并同一窗口内的多次 vault 变更。
	 *
	 * 批量建任务会连着发 N 个 create/modify，原来会触发 N 次整库重扫；
	 * 这里合并成一次，并且只针对改动涉及的项目更新角标。
	 */
	private queueVaultRefresh(
		kind: 'create' | 'delete' | 'modify' | 'rename',
		path: string,
		oldPath?: string,
	): void {
		if (!this.shouldRefreshTasksCenter(path, oldPath)) {
			return;
		}

		// 解析缓存按 (mtime, size) 自失效，这里只清理删除 / 重命名留下的死条目。
		invalidateTaskFileFields(path);
		if (oldPath) {
			invalidateTaskFileFields(oldPath);
		}

		const projectName = this.resolveProjectNameFromPath(path);
		const isProjectMetadata = path.endsWith(`/${PROJECT_METADATA_FILE_NAME}`);
		if (kind !== 'modify' || !projectName || isProjectMetadata) {
			// 结构变化、或分类元数据变化 → 项目表本身要重算，只能全量。
			this.pendingFullRefresh = true;
		} else {
			this.pendingProjectRefreshes.add(projectName);
		}

		if (this.vaultRefreshTimer !== null) {
			return;
		}

		this.vaultRefreshTimer = window.setTimeout(() => {
			this.vaultRefreshTimer = null;
			void this.flushVaultRefresh();
		}, VAULT_REFRESH_DEBOUNCE_MS);
	}

	private async flushVaultRefresh(): Promise<void> {
		const needsFullRefresh = this.pendingFullRefresh;
		const projectNames = [...this.pendingProjectRefreshes];
		this.pendingFullRefresh = false;
		this.pendingProjectRefreshes.clear();

		if (needsFullRefresh || projectNames.length === 0) {
			await this.refreshOpenViews();
			return;
		}

		await this.refreshProjectCountsOnly(projectNames);
	}

	/** 只更新项目角标：改动的不是当前项目时，任务列表无需跟着重载。 */
	private async refreshProjectCountsOnly(
		projectNames: string[],
	): Promise<void> {
		const targets = new Set(projectNames);
		for (const leaf of this.app.workspace.getLeavesOfType(
			IOTO_TASKS_CENTER_VIEW_TYPE,
		)) {
			const view = leaf.view;
			if (!(view instanceof IOTOTasksCenterView)) {
				continue;
			}

			if (
				view.selectedProject !== null &&
				targets.has(view.selectedProject)
			) {
				await view.refreshFromVaultChange();
			} else {
				await view.refreshProjectIncompleteCounts(projectNames);
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

	/** `3-任务/<项目>/...` → `<项目>`；不在任务根下或就是根本身时返回 null。 */
	private resolveProjectNameFromPath(path: string): string | null {
		const root = this.settings.tasksRootPath;
		if (!path.startsWith(`${root}/`)) {
			return null;
		}

		const rest = path.slice(root.length + 1);
		const separatorIndex = rest.indexOf('/');
		return separatorIndex > 0 ? rest.slice(0, separatorIndex) : null;
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
				appendTaskViewMenuItems(
					this.app,
					this.settings.tasksRootPath,
					menu,
					file,
					leaf,
				);

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


	/**
	 * 将当前设置应用到所有已打开的视图。public 以便 settings-updaters 的
	 * SettingsUpdaterHost 接口结构化满足（更新函数在 saveSettings 后调用此方法刷视图）。
	 */
	applySettingsToOpenViews(): void {
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
				view.applyDeleteButtonSetting();
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
