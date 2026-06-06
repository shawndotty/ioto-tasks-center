import { App, Notice, PluginSettingTab, Setting, TFile } from 'obsidian';
import { t } from './lang/helpter';
import IOTOTasksCenter from './main';
import { DEFAULT_DATE_TASK_DATE_FORMAT } from './tasks-center/date-task-format';
import {
	createDefaultTaskTemplateConfigMap,
	type TaskCreationType,
	type TaskTemplateConfigMap,
	type TaskTemplateSourceMode,
} from './tasks-center/task-template-config';
import { ENABLED_TASK_CREATION_TYPE_ORDER } from './tasks-center/enabled-task-creation-types';
import {
	DEFAULT_TASKS_ROOT_PATH,
	normalizeTasksRootPath,
} from './tasks-center/types';
import { ImportModal } from './modals/ImportModal';

export type ProjectListSortMode = 'incomplete-count' | 'name';
export type TaskListSortMode =
	| 'created-desc'
	| 'created-asc'
	| 'updated-desc'
	| 'updated-asc'
	| 'name-asc'
	| 'name-desc'
	| 'priority-desc'
	| 'priority-asc';
export type TaskListGroupMode = 'none' | 'status' | 'priority';

export interface IOTOTasksCenterSettings {
	tasksRootPath: string;
	projectListSortMode: ProjectListSortMode;
	taskListSortMode: TaskListSortMode;
	taskListGroupMode: TaskListGroupMode;
	showTaskPriority: boolean;
	hiddenProjectNames: string[];
	projectCategoryOptions: string[];
	enabledTaskCreationTypes: TaskCreationType[];
	taskTemplateConfigs: TaskTemplateConfigMap;
	dateTaskDateFormat: string;
}

export const DEFAULT_SETTINGS: IOTOTasksCenterSettings = {
	tasksRootPath: DEFAULT_TASKS_ROOT_PATH,
	projectListSortMode: 'incomplete-count',
	taskListSortMode: 'created-desc',
	taskListGroupMode: 'none',
	showTaskPriority: false,
	hiddenProjectNames: [],
	projectCategoryOptions: [],
	enabledTaskCreationTypes: [...ENABLED_TASK_CREATION_TYPE_ORDER],
	taskTemplateConfigs: createDefaultTaskTemplateConfigMap(),
	dateTaskDateFormat: DEFAULT_DATE_TASK_DATE_FORMAT,
};

export { normalizeEnabledTaskCreationTypes } from './tasks-center/enabled-task-creation-types';

export function getProjectListSortModeOptions(): Record<
	ProjectListSortMode,
	string
> {
	return {
		'incomplete-count': t('task.sort.incompleteCount'),
		name: t('task.sort.projectName'),
	};
}

export function getTaskListSortModeOptions(): Record<TaskListSortMode, string> {
	return {
		'created-desc': t('task.sort.createdDesc'),
		'created-asc': t('task.sort.createdAsc'),
		'updated-desc': t('task.sort.updatedDesc'),
		'updated-asc': t('task.sort.updatedAsc'),
		'name-asc': t('task.sort.nameAsc'),
		'name-desc': t('task.sort.nameDesc'),
		'priority-desc': t('task.sort.priorityDesc'),
		'priority-asc': t('task.sort.priorityAsc'),
	};
}

export function getTaskListGroupModeOptions(): Record<
	TaskListGroupMode,
	string
> {
	return {
		none: t('task.group.none'),
		status: t('task.group.status'),
		priority: t('task.group.priority'),
	};
}

export function isProjectListSortMode(
	value: string,
): value is ProjectListSortMode {
	return value === 'incomplete-count' || value === 'name';
}

export function isTaskListSortMode(value: string): value is TaskListSortMode {
	return (
		value === 'created-desc' ||
		value === 'created-asc' ||
		value === 'updated-desc' ||
		value === 'updated-asc' ||
		value === 'name-asc' ||
		value === 'name-desc' ||
		value === 'priority-desc' ||
		value === 'priority-asc'
	);
}

export function isTaskListGroupMode(value: string): value is TaskListGroupMode {
	return value === 'none' || value === 'status' || value === 'priority';
}

export function getTaskTemplateSourceModeOptions(): Record<
	TaskTemplateSourceMode,
	string
> {
	return {
		file: t('task.template.source.file'),
		inline: t('task.template.source.inline'),
	};
}

function getTaskTypeTemplateLabels(): Record<TaskCreationType, string> {
	return {
		date: t('task.type.date'),
		plan: t('task.type.plan'),
		topic: t('task.type.topic'),
		normal: t('task.type.normal'),
	};
}

export class IOTOTasksCenterSettingTab extends PluginSettingTab {
	plugin: IOTOTasksCenter;

	constructor(app: App, plugin: IOTOTasksCenter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const projectSortModeOptions = getProjectListSortModeOptions();

		containerEl.empty();

		new Setting(containerEl)
			.setName(t('settings.heading.main'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.tasksRootPath.name'))
			.setDesc(t('settings.tasksRootPath.desc'))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_TASKS_ROOT_PATH)
					.setValue(this.plugin.settings.tasksRootPath)
					.onChange(async (value) => {
						await this.plugin.updateTasksRootPath(value);
						// this.display();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.viewEntry.name'))
			.setDesc(t('settings.viewEntry.desc'))
			.addButton((button) =>
				button
					.setButtonText(t('settings.viewEntry.button'))
					.onClick(async () => {
						await this.plugin.activateIOTOTasksCenterView();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.projectCenterEntry.name'))
			.setDesc(t('settings.projectCenterEntry.desc'))
			.addButton((button) =>
				button
					.setButtonText(t('settings.projectCenterEntry.button'))
					.onClick(async () => {
						await this.plugin.activateIOTOProjectCenterView();
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.taskListBehavior.name'))
			.setDesc(t('settings.taskListBehavior.desc'));

		new Setting(containerEl)
			.setName(t('settings.autoRefresh.name'))
			.setDesc(
				t('settings.autoRefresh.desc', [
					this.plugin.settings.tasksRootPath,
				]),
			);

		new Setting(containerEl)
			.setName(t('settings.heading.taskCreation'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.enabledTaskTypes.name'))
			.setDesc(t('settings.enabledTaskTypes.desc'));

		const enabledTaskTypes = new Set<TaskCreationType>(
			this.plugin.settings.enabledTaskCreationTypes,
		);
		const taskTypeLabels = getTaskTypeTemplateLabels();
		for (const taskType of ENABLED_TASK_CREATION_TYPE_ORDER) {
			new Setting(containerEl)
				.setName(taskTypeLabels[taskType])
				.addToggle((toggle) =>
					toggle
						.setValue(enabledTaskTypes.has(taskType))
						.onChange(async (value) => {
							if (
								!value &&
								enabledTaskTypes.has(taskType) &&
								enabledTaskTypes.size === 1
							) {
								toggle.setValue(true);
								new Notice(
									t('settings.enabledTaskTypes.atLeastOne'),
								);
								return;
							}

							if (value) {
								enabledTaskTypes.add(taskType);
							} else {
								enabledTaskTypes.delete(taskType);
							}

							await this.plugin.updateEnabledTaskCreationTypes([
								...enabledTaskTypes,
							]);
						}),
				);
		}

		const templaterTemplatesFolder = getTemplaterTemplatesFolder(this.app);
		new Setting(containerEl)
			.setName(t('settings.taskTemplate.name'))
			.setDesc(t('settings.taskTemplate.desc'));

		for (const taskType of TASK_TEMPLATE_TYPES) {
			const taskTypeContainer = containerEl.createDiv({
				cls: 'ioto-tasks-center__task-template-settings',
			});
			this.renderTaskTemplateSettings(
				taskTypeContainer,
				taskType,
				templaterTemplatesFolder,
			);
		}

		new Setting(containerEl)
			.setName(t('settings.dateTaskFormat.name'))
			.setDesc(
				t('settings.dateTaskFormat.desc', [
					DEFAULT_DATE_TASK_DATE_FORMAT,
				]),
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_DATE_TASK_DATE_FORMAT)
					.setValue(this.plugin.settings.dateTaskDateFormat)
					.onChange(async (value) => {
						await this.plugin.updateDateTaskDateFormat(value);
					}),
			);

		new Setting(containerEl)
			.setName(t('settings.heading.projectSort'))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.projectSort.name'))
			.setDesc(t('settings.projectSort.desc'))
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(
					projectSortModeOptions,
				)) {
					dropdown.addOption(value, label);
				}

				dropdown
					.setValue(this.plugin.settings.projectListSortMode)
					.onChange(async (value) => {
						if (!isProjectListSortMode(value)) {
							return;
						}

						await this.plugin.updateProjectListSortMode(value);
						// this.display();
					});
			});
	}

	private renderTaskTemplateSettings(
		containerEl: HTMLElement,
		taskType: TaskCreationType,
		templaterTemplatesFolder: string | null,
	): void {
		containerEl.empty();

		const config = this.plugin.settings.taskTemplateConfigs[taskType];
		const taskTypeLabel = getTaskTypeTemplateLabels()[taskType];
		const sourceModeOptions = getTaskTemplateSourceModeOptions();

		new Setting(containerEl)
			.setName(t('settings.taskTemplate.heading', [taskTypeLabel]))
			.setHeading();

		new Setting(containerEl)
			.setName(t('settings.taskTemplate.source.name'))
			.setDesc(t('settings.taskTemplate.source.desc', [taskTypeLabel]))
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(
					sourceModeOptions,
				)) {
					dropdown.addOption(value, label);
				}

				dropdown.setValue(config.sourceMode).onChange(async (value) => {
					const sourceMode = isTaskTemplateSourceMode(value)
						? value
						: 'file';
					await this.plugin.updateTaskTemplateConfig(taskType, {
						sourceMode,
					});
					this.renderTaskTemplateSettings(
						containerEl,
						taskType,
						templaterTemplatesFolder,
					);
				});
			});

		const fileModeDesc = templaterTemplatesFolder
			? t('settings.taskTemplate.filePath.templater', [
					templaterTemplatesFolder,
				])
			: t('settings.taskTemplate.filePath.templaterGeneric');
		new Setting(containerEl)
			.setName(t('settings.taskTemplate.filePath.name'))
			.setDesc(
				t('settings.taskTemplate.filePath.desc', [
					fileModeDesc,
					config.sourceMode === 'file'
						? ''
						: t('settings.taskTemplate.sourceDisabled'),
				]),
			)
			.addText((text) =>
				text
					// .setPlaceholder(
					// 	t('settings.taskTemplate.filePath.placeholder'),
					// )
					.setValue(config.templatePath)
					.onChange(async (value) => {
						await this.plugin.updateTaskTemplateConfig(taskType, {
							templatePath: value.trim(),
						});
					}),
			)
			.addButton((button) => {
				button
					.setButtonText(t('settings.taskTemplate.selectButton'))
					.onClick(() => {
						new ImportModal(
							this.app,
							(file: TFile) => {
								void (async () => {
									await this.plugin.updateTaskTemplateConfig(
										taskType,
										{
											templatePath: file.path,
										},
									);
									this.renderTaskTemplateSettings(
										containerEl,
										taskType,
										templaterTemplatesFolder,
									);
								})();
							},
							[templaterTemplatesFolder || ''],
						).open();
					});
			})
			.addButton((button) => {
				button
					.setButtonText(t('settings.taskTemplate.clearButton'))
					.onClick(() => {
						void (async () => {
							await this.plugin.updateTaskTemplateConfig(
								taskType,
								{
									templatePath: '',
								},
							);
							this.renderTaskTemplateSettings(
								containerEl,
								taskType,
								templaterTemplatesFolder,
							);
						})();
					});
			});

		new Setting(containerEl)
			.setName(t('settings.taskTemplate.inline.name'))
			.setDesc(
				t('settings.taskTemplate.inline.desc', [
					config.sourceMode === 'inline'
						? ''
						: t('settings.taskTemplate.sourceDisabled'),
				]),
			)
			.addTextArea((text) =>
				text
					.setPlaceholder(
						t('settings.taskTemplate.inline.placeholder', [
							taskTypeLabel,
						]),
					)
					.setValue(config.inlineContent)
					.onChange(async (value) => {
						await this.plugin.updateTaskTemplateConfig(taskType, {
							inlineContent: value,
						});
					}),
			);
	}
}

function getTemplaterTemplatesFolder(app: App): string | null {
	const templater = (
		app as App & {
			plugins?: {
				plugins?: Record<
					string,
					{ settings?: { templates_folder?: unknown } }
				>;
			};
		}
	).plugins?.plugins?.['templater-obsidian'];
	const templatesFolder = templater?.settings?.templates_folder;
	return typeof templatesFolder === 'string' && templatesFolder.length > 0
		? templatesFolder
		: null;
}

export function normalizeConfiguredTasksRootPath(path: string): string {
	return normalizeTasksRootPath(path);
}

export function normalizeProjectCategoryOptions(input: unknown): string[] {
	if (!Array.isArray(input)) {
		return [];
	}

	const set = new Set<string>();
	for (const item of input) {
		if (typeof item !== 'string') {
			continue;
		}

		const normalized = item.trim();
		if (normalized) {
			set.add(normalized);
		}
	}

	return [...set].sort((left, right) =>
		left.localeCompare(right, undefined, { numeric: true }),
	);
}

export function isTaskTemplateSourceMode(
	value: string,
): value is TaskTemplateSourceMode {
	return value === 'file' || value === 'inline';
}

const TASK_TEMPLATE_TYPES: TaskCreationType[] = [
	'normal',
	'topic',
	'plan',
	'date',
];
