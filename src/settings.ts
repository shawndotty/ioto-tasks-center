import { App, PluginSettingTab, Setting } from 'obsidian';
import IOTOTasksCenter from './main';
import { TASKS_ROOT_PATH } from './tasks-center/types';

export type ProjectListSortMode = 'incomplete-count' | 'name';

export interface IOTOTasksCenterSettings {
	projectListSortMode: ProjectListSortMode;
}

export const DEFAULT_SETTINGS: IOTOTasksCenterSettings = {
	projectListSortMode: 'incomplete-count',
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
					});
			});
	}
}
