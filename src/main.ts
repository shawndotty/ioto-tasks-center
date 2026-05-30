import { Plugin, TAbstractFile, WorkspaceLeaf } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	IOTOTasksCenterSettingTab,
	IOTOTasksCenterSettings,
	ProjectListSortMode,
	normalizeConfiguredTasksRootPath,
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
					() => this.settings.tasksRootPath,
					() => this.settings.projectListSortMode,
					() => this.settings.hiddenProjectNames,
					() => this.settings.taskTemplatePath,
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
		this.settings.tasksRootPath = normalizeConfiguredTasksRootPath(
			this.settings.tasksRootPath,
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

	async updateTasksRootPath(path: string): Promise<void> {
		const nextPath = normalizeConfiguredTasksRootPath(path);
		if (this.settings.tasksRootPath === nextPath) {
			return;
		}

		this.settings.tasksRootPath = nextPath;
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

	async updateTaskTemplatePath(path: string): Promise<void> {
		const nextPath = path.trim();
		if (this.settings.taskTemplatePath === nextPath) {
			return;
		}

		this.settings.taskTemplatePath = nextPath;
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
				void view.handleSettingsChange();
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
