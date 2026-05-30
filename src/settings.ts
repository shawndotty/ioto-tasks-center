import { App, PluginSettingTab, Setting } from 'obsidian';
import IOTOTasksCenter from './main';
import { listProjectFolders, listProjectTaskFiles } from './tasks-center/data';
import { sortProjectEntries } from './tasks-center/project-sort';
import type { ProjectFolderEntry } from './tasks-center/types';
import { TASKS_ROOT_PATH } from './tasks-center/types';

export type ProjectListSortMode = 'incomplete-count' | 'name';

export interface IOTOTasksCenterSettings {
	projectListSortMode: ProjectListSortMode;
	hiddenProjectNames: string[];
	taskTemplatePath: string;
}

export const DEFAULT_SETTINGS: IOTOTasksCenterSettings = {
	projectListSortMode: 'incomplete-count',
	hiddenProjectNames: [],
	taskTemplatePath: '',
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
				`当前视图固定从 vault 中读取 ${TASKS_ROOT_PATH} 目录，并将其一级子文件夹识别为项目列表。`,
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
				'当 3-任务 目录下发生创建、删除、重命名或内容修改时，已打开的任务中心视图会自动刷新。',
			);

		new Setting(containerEl).setName('任务创建').setHeading();

		const templaterTemplatesFolder = getTemplaterTemplatesFolder(this.app);
		const templateSettingDesc = templaterTemplatesFolder
			? `填写一个 vault 相对路径的 Markdown 模板文件。支持 Templater 语法；若可用将优先自动执行，失败时回退为写入模板原文。当前 Templater 模板目录：${templaterTemplatesFolder}`
			: '填写一个 vault 相对路径的 Markdown 模板文件。支持 Templater 语法；若可用将优先自动执行，失败时回退为写入模板原文。';

		new Setting(containerEl)
			.setName('任务模板文件')
			.setDesc(templateSettingDesc)
			.addText((text) =>
				text
					.setPlaceholder(
						'0-辅助/IOTO/Templates/Templater/OBIOTO/IOTO-加载器-创建任务.md',
					)
					.setValue(this.plugin.settings.taskTemplatePath)
					.onChange(async (value) => {
						await this.plugin.updateTaskTemplatePath(value);
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

	private async displayHiddenProjectSettings(
		containerEl: HTMLElement,
	): Promise<void> {
		containerEl.empty();
		containerEl.createDiv({
			text: '正在加载项目列表...',
		});

		const projectsResult = listProjectFolders(this.app);
		if (projectsResult.status === 'root-missing') {
			containerEl.empty();
			new Setting(containerEl)
				.setName('未找到任务根目录')
				.setDesc(`请先在 vault 中创建 ${TASKS_ROOT_PATH} 目录。`);
			return;
		}

		if (projectsResult.projects.length === 0) {
			containerEl.empty();
			new Setting(containerEl)
				.setName('暂无可配置项目')
				.setDesc(`${TASKS_ROOT_PATH} 下还没有一级项目文件夹。`);
			return;
		}

		const incompleteCounts = await buildProjectIncompleteCounts(
			this.app,
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
	projects: ProjectFolderEntry[],
): Promise<Map<string, number>> {
	const entries = await Promise.all(
		projects.map(async (project) => {
			const result = await listProjectTaskFiles(app, project.name);
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
