import { App, PluginSettingTab, Setting } from 'obsidian';
import IOTOTasksCenter from './main';
import { TASKS_ROOT_PATH } from './tasks-center/types';

export type IOTOTasksCenterSettings = Record<string, never>;

export const DEFAULT_SETTINGS: IOTOTasksCenterSettings = {};

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
				'右侧仅显示当前项目目录下的一级 Markdown 文件。点击任务项会在新标签页中直接打开对应文件。',
			);

		new Setting(containerEl)
			.setName('自动刷新')
			.setDesc(
				'当 3-任务 目录下发生创建、删除、重命名或内容修改时，已打开的任务中心视图会自动刷新。',
			);
	}
}
