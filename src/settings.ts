import { App, PluginSettingTab, Setting, TFile } from 'obsidian';
import IOTOTasksCenter from './main';
import { listProjectFolders, listProjectTaskFiles } from './tasks-center/data';
import { DEFAULT_DATE_TASK_DATE_FORMAT } from './tasks-center/date-task-format';
import { sortProjectEntries } from './tasks-center/project-sort';
import {
	createDefaultTaskTemplateConfigMap,
	type TaskCreationType,
	type TaskTemplateConfigMap,
	type TaskTemplateSourceMode,
} from './tasks-center/task-template-config';
import type { ProjectFolderEntry } from './tasks-center/types';
import {
	DEFAULT_TASKS_ROOT_PATH,
	normalizeTasksRootPath,
} from './tasks-center/types';
import { ImportModal } from './modals/ImportModal';

export type ProjectListSortMode = 'incomplete-count' | 'name';

export interface IOTOTasksCenterSettings {
	tasksRootPath: string;
	projectListSortMode: ProjectListSortMode;
	hiddenProjectNames: string[];
	taskTemplateConfigs: TaskTemplateConfigMap;
	dateTaskDateFormat: string;
}

export const DEFAULT_SETTINGS: IOTOTasksCenterSettings = {
	tasksRootPath: DEFAULT_TASKS_ROOT_PATH,
	projectListSortMode: 'incomplete-count',
	hiddenProjectNames: [],
	taskTemplateConfigs: createDefaultTaskTemplateConfigMap(),
	dateTaskDateFormat: DEFAULT_DATE_TASK_DATE_FORMAT,
};

export const PROJECT_LIST_SORT_MODE_OPTIONS: Record<
	ProjectListSortMode,
	string
> = {
	'incomplete-count': '按未完成任务数量',
	name: '按项目名称',
};

export function isProjectListSortMode(
	value: string,
): value is ProjectListSortMode {
	return value === 'incomplete-count' || value === 'name';
}

export const TASK_TEMPLATE_SOURCE_MODE_OPTIONS: Record<
	TaskTemplateSourceMode,
	string
> = {
	file: '使用模板文件',
	inline: '直接输入模板内容',
};

const TASK_TYPE_TEMPLATE_LABELS: Record<TaskCreationType, string> = {
	date: '日期任务',
	plan: '计划任务',
	topic: '主题任务',
	normal: '普通任务',
};

export class IOTOTasksCenterSettingTab extends PluginSettingTab {
	plugin: IOTOTasksCenter;

	constructor(app: App, plugin: IOTOTasksCenter) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl).setName('任务中心').setHeading();

		new Setting(containerEl)
			.setName('任务根目录')
			.setDesc(
				'填写一个 vault 相对路径。任务中心会将该目录的一级子文件夹识别为项目列表。',
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_TASKS_ROOT_PATH)
					.setValue(this.plugin.settings.tasksRootPath)
					.onChange(async (value) => {
						await this.plugin.updateTasksRootPath(value);
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName('视图入口')
			.setDesc(
				'可通过命令面板执行“打开任务中心视图”，也可以在这里直接打开任务中心。',
			)
			.addButton((button) =>
				button.setButtonText('打开任务中心').onClick(async () => {
					await this.plugin.activateIOTOTasksCenterView();
				}),
			);

		new Setting(containerEl)
			.setName('任务列表行为')
			.setDesc(
				'右侧仅显示当前项目目录下的一级 Markdown 文件。点击任务项会在任务中心右侧固定 pane 中打开对应文件。',
			);

		new Setting(containerEl)
			.setName('自动刷新')
			.setDesc(
				`当 ${this.plugin.settings.tasksRootPath} 目录下发生创建、删除、重命名或内容修改时，已打开的任务中心视图会自动刷新。`,
			);

		new Setting(containerEl).setName('任务创建').setHeading();

		const templaterTemplatesFolder = getTemplaterTemplatesFolder(this.app);
		new Setting(containerEl)
			.setName('任务模板')
			.setDesc(
				'可以为四种任务类型分别设置模板，并分别选择使用模板文件或直接输入模板内容。',
			);

		for (const taskType of TASK_TEMPLATE_TYPES) {
			this.renderTaskTemplateSettings(
				containerEl,
				taskType,
				templaterTemplatesFolder,
			);
		}

		new Setting(containerEl)
			.setName('日期任务日期格式')
			.setDesc(
				`支持 Moment/Day.js 风格格式，例如 ${DEFAULT_DATE_TASK_DATE_FORMAT}、YYYY年MM月DD日。若填写无效格式，会自动回退为默认值。`,
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_DATE_TASK_DATE_FORMAT)
					.setValue(this.plugin.settings.dateTaskDateFormat)
					.onChange(async (value) => {
						await this.plugin.updateDateTaskDateFormat(value);
						this.display();
					}),
			);

		new Setting(containerEl).setName('项目列表排序').setHeading();

		new Setting(containerEl)
			.setName('排序规则')
			.setDesc(
				'控制左侧项目列表的排序方式。默认按未完成任务数量从多到少显示。',
			)
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(
					PROJECT_LIST_SORT_MODE_OPTIONS,
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
						this.display();
					});
			});

		new Setting(containerEl).setName('隐藏项目列表').setHeading();

		const hiddenProjectsDesc = containerEl.createDiv();
		hiddenProjectsDesc.addClass('setting-item-description');
		hiddenProjectsDesc.setText(
			'勾选后，对应项目会从左侧项目列表中隐藏。修改后立即生效，并会自动保存。',
		);

		const hiddenProjectsContainer = containerEl.createDiv();
		void this.displayHiddenProjectSettings(hiddenProjectsContainer);
	}

	private renderTaskTemplateSettings(
		containerEl: HTMLElement,
		taskType: TaskCreationType,
		templaterTemplatesFolder: string | null,
	): void {
		const config = this.plugin.settings.taskTemplateConfigs[taskType];
		const taskTypeLabel = TASK_TYPE_TEMPLATE_LABELS[taskType];

		new Setting(containerEl).setName(`${taskTypeLabel}模板`).setHeading();

		new Setting(containerEl)
			.setName('模板来源')
			.setDesc(`为${taskTypeLabel}选择模板来源。`)
			.addDropdown((dropdown) => {
				for (const [value, label] of Object.entries(
					TASK_TEMPLATE_SOURCE_MODE_OPTIONS,
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
					this.display();
				});
			});

		const fileModeDesc = templaterTemplatesFolder
			? `该模式支持 Templater，当前 Templater 模板目录：${templaterTemplatesFolder}`
			: '该模式支持 Templater';
		new Setting(containerEl)
			.setName('模板文件路径')
			.setDesc(
				`${fileModeDesc}${config.sourceMode === 'file' ? '' : ' 当前未启用此来源。'}`,
			)
			.addText((text) =>
				text
					.setPlaceholder(
						'0-辅助/IOTO/Templates/Templater/OBIOTO/IOTO-加载器-创建任务.md',
					)
					.setValue(config.templatePath)
					.onChange(async (value) => {
						await this.plugin.updateTaskTemplateConfig(taskType, {
							templatePath: value.trim(),
						});
					}),
			)
			.addButton((button) => {
				button
					.setButtonText('选择模板')
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
									await this.plugin.saveSettings();
									this.display();
								})();
							},
							[templaterTemplatesFolder || ''],
						).open();
					});
			})
			.addButton((button) => {
				button.setButtonText('清空').onClick(() => {
					void (async () => {
						await this.plugin.updateTaskTemplateConfig(taskType, {
							templatePath: '',
						});
						await this.plugin.saveSettings();
						this.display();
					})();
				});
			});

		new Setting(containerEl)
			.setName('模板内容')
			.setDesc(
				`直接把这里输入的内容写入新文件，不执行 Templater。${config.sourceMode === 'inline' ? '' : ' 当前未启用此来源。'}`,
			)
			.addTextArea((text) =>
				text
					.setPlaceholder(`# ${taskTypeLabel}\n\n在这里输入模板内容`)
					.setValue(config.inlineContent)
					.onChange(async (value) => {
						await this.plugin.updateTaskTemplateConfig(taskType, {
							inlineContent: value,
						});
					}),
			);
	}

	private async displayHiddenProjectSettings(
		containerEl: HTMLElement,
	): Promise<void> {
		containerEl.empty();
		containerEl.createDiv({
			text: '正在加载项目列表...',
		});

		const tasksRootPath = this.plugin.settings.tasksRootPath;
		const projectsResult = listProjectFolders(this.app, tasksRootPath);
		if (projectsResult.status === 'root-missing') {
			containerEl.empty();
			new Setting(containerEl)
				.setName('未找到任务根目录')
				.setDesc(`请先在 vault 中创建 ${tasksRootPath} 目录。`);
			return;
		}

		if (projectsResult.projects.length === 0) {
			containerEl.empty();
			new Setting(containerEl)
				.setName('暂无可配置项目')
				.setDesc(`${tasksRootPath} 下还没有一级项目文件夹。`);
			return;
		}

		const incompleteCounts = await buildProjectIncompleteCounts(
			this.app,
			tasksRootPath,
			projectsResult.projects,
		);
		const allProjects = sortProjectEntries(
			projectsResult.projects,
			incompleteCounts,
			this.plugin.settings.projectListSortMode,
		);

		containerEl.empty();

		for (const project of allProjects) {
			const incompleteCount = incompleteCounts.get(project.name) ?? 0;
			const hidden = this.plugin.settings.hiddenProjectNames.includes(
				project.name,
			);
			const description =
				incompleteCount > 0
					? `当前有 ${incompleteCount} 个未完成任务`
					: '当前无未完成任务';

			new Setting(containerEl)
				.setName(project.name)
				.setDesc(description)
				.addToggle((toggle) =>
					toggle.setValue(hidden).onChange(async (value) => {
						await this.plugin.setProjectHidden(project.name, value);
						await this.displayHiddenProjectSettings(containerEl);
					}),
				);
		}
	}
}

async function buildProjectIncompleteCounts(
	app: App,
	tasksRootPath: string,
	projects: ProjectFolderEntry[],
): Promise<Map<string, number>> {
	const entries = await Promise.all(
		projects.map(async (project) => {
			const result = await listProjectTaskFiles(
				app,
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

function isIncompleteTaskStatus(statusKey: string): boolean {
	return statusKey === 'todo' || statusKey === 'in-progress';
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
