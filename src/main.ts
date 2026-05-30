import { Plugin, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	IOTOTasksCenterSettingTab,
	IOTOTasksCenterSettings,
	ProjectListSortMode,
} from './settings';
import {
	IOTO_TASKS_CENTER_VIEW_TYPE,
	IOTOTasksCenterView,
} from './views/iotoTasksCenterView';

export default class IOTOTasksCenter extends Plugin {
	settings!: IOTOTasksCenterSettings;

	async onload() {
		await this.loadSettings();
		this.registerView(
			IOTO_TASKS_CENTER_VIEW_TYPE,
			(leaf) =>
				new IOTOTasksCenterView(
					leaf,
					() => this.settings.projectListSortMode,
				),
		);

		this.addCommand({
			id: 'open-tasks-center-view',
			name: '打开任务中心视图',
			callback: () => this.activateIOTOTasksCenterView(),
		});

		this.addSettingTab(new IOTOTasksCenterSettingTab(this.app, this));
		this.registerVaultRefreshEvents();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<IOTOTasksCenterSettings>,
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

	private getOrCreateIOTOTasksCenterLeaf(): WorkspaceLeaf {
		const existingLeaf = this.app.workspace.getLeavesOfType(
			IOTO_TASKS_CENTER_VIEW_TYPE,
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

		const leaves = this.app.workspace.getLeavesOfType(
			IOTO_TASKS_CENTER_VIEW_TYPE,
		);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof IOTOTasksCenterView) {
				await view.refreshFromVaultChange();
			}
		}
	}

	private applySettingsToOpenViews(): void {
		const leaves = this.app.workspace.getLeavesOfType(
			IOTO_TASKS_CENTER_VIEW_TYPE,
		);
		for (const leaf of leaves) {
			const view = leaf.view;
			if (view instanceof IOTOTasksCenterView) {
				view.handleSettingsChange();
			}
		}
	}

	private shouldRefreshTasksCenter(path: string, oldPath?: string): boolean {
		return [path, oldPath]
			.filter((value): value is string => Boolean(value))
			.some(
				(candidate) =>
					candidate === '3-任务' || candidate.startsWith('3-任务/'),
			);
	}
}
