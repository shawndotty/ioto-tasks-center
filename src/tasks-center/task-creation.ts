import { App, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';

import { TASKS_ROOT_PATH } from './types';

export type TaskCreationType = 'date' | 'plan' | 'topic';

export interface CreateTaskFileOptions {
	app: App;
	projectName: string;
	type: TaskCreationType;
	customName?: string;
	templatePath: string;
	targetLeaf?: WorkspaceLeaf | null;
	sourceLeaf?: WorkspaceLeaf | null;
}

export interface CreateTaskFileResult {
	file: TFile;
	created: boolean;
	templaterApplied: boolean;
}

interface TemplaterPlugin {
	settings: {
		enabled_templates_hotkeys?: string[];
		[key: string]: unknown;
	};
	save_settings: () => Promise<void>;
}

interface CommandRegistryLike {
	commands?: Record<string, unknown>;
	executeCommandById?: (commandId: string) => boolean | Promise<boolean>;
}

export function buildTaskFileName(
	projectName: string,
	type: TaskCreationType,
	date: Date,
	customName?: string,
): string {
	if (type === 'date') {
		return `${projectName}-${formatDate(date)}.md`;
	}

	const normalizedName = normalizeCustomTaskName(customName ?? '');
	if (!normalizedName) {
		throw new Error('任务名称不能为空。');
	}

	const typeLabel = type === 'plan' ? '计划' : '主题';
	return `${projectName}-${typeLabel}-${normalizedName}.md`;
}

export function normalizeCustomTaskName(input: string): string | null {
	const normalized = input
		.trim()
		.replace(/[\\/:*?"<>|#[\]^]+/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^-+|-+$/g, '');

	return normalized.length > 0 ? normalized : null;
}

export function resolveTaskTargetPath(
	projectName: string,
	fileName: string,
): string {
	return normalizeVaultPath(`${TASKS_ROOT_PATH}/${projectName}/${fileName}`);
}

export function getTemplaterCommandId(templatePath: string): string {
	return `templater-obsidian:${templatePath}`;
}

export async function createTaskFile(
	options: CreateTaskFileOptions,
): Promise<CreateTaskFileResult> {
	const {
		app,
		projectName,
		type,
		customName,
		templatePath,
		targetLeaf,
		sourceLeaf,
	} = options;
	const fileName = buildTaskFileName(
		projectName,
		type,
		new Date(),
		customName,
	);
	const targetPath = resolveTaskTargetPath(projectName, fileName);
	const projectFolder = app.vault.getAbstractFileByPath(
		normalizeVaultPath(`${TASKS_ROOT_PATH}/${projectName}`),
	);
	if (!(projectFolder instanceof TFolder)) {
		throw new Error(`项目目录不存在：${projectName}`);
	}

	const existingFile = app.vault.getAbstractFileByPath(targetPath);
	if (existingFile instanceof TFile) {
		new Notice('该任务文件已存在，已为你打开现有文件。');
		return {
			file: existingFile,
			created: false,
			templaterApplied: false,
		};
	}

	if (existingFile) {
		throw new Error(`目标路径不可用：${targetPath}`);
	}

	const file = await app.vault.create(targetPath, '');
	const templateFile = getTemplateFile(app, templatePath);

	if (!templateFile) {
		return {
			file,
			created: true,
			templaterApplied: false,
		};
	}

	const templaterApplied = await applyTemplateToFile(
		app,
		file,
		templateFile,
		targetLeaf,
		sourceLeaf,
	);
	return {
		file,
		created: true,
		templaterApplied,
	};
}

async function applyTemplateToFile(
	app: App,
	file: TFile,
	templateFile: TFile,
	targetLeaf?: WorkspaceLeaf | null,
	sourceLeaf?: WorkspaceLeaf | null,
): Promise<boolean> {
	if (targetLeaf) {
		const commandId = await ensureTemplateCommandEnabled(
			app,
			templateFile.path,
		);
		if (commandId) {
			const executed = await executeTemplaterTemplate(
				app,
				targetLeaf,
				file,
				commandId,
				sourceLeaf,
			);
			if (executed) {
				return true;
			}
		}
	}

	const content = await app.vault.cachedRead(templateFile);
	await app.vault.modify(file, content);
	new Notice('模板已插入原文，未自动执行 templater 语法。');
	return false;
}

async function executeTemplaterTemplate(
	app: App,
	targetLeaf: WorkspaceLeaf,
	file: TFile,
	commandId: string,
	sourceLeaf?: WorkspaceLeaf | null,
): Promise<boolean> {
	await targetLeaf.openFile(file, { active: true });
	app.workspace.setActiveLeaf(targetLeaf, { focus: true });

	try {
		const commandRegistry = (
			app as App & { commands?: CommandRegistryLike }
		).commands;
		if (!commandRegistry?.executeCommandById) {
			return false;
		}

		const result = await commandRegistry.executeCommandById(commandId);
		return result !== false;
	} catch {
		return false;
	} finally {
		if (sourceLeaf) {
			app.workspace.setActiveLeaf(sourceLeaf, { focus: false });
		}
	}
}

async function ensureTemplateCommandEnabled(
	app: App,
	templatePath: string,
): Promise<string | null> {
	const templater = getTemplaterPlugin(app);
	if (!templater) {
		return null;
	}

	const normalizedTemplatePath = normalizeVaultPath(templatePath);
	const enabledTemplateHotkeys = Array.isArray(
		templater.settings.enabled_templates_hotkeys,
	)
		? templater.settings.enabled_templates_hotkeys
		: [];

	if (!enabledTemplateHotkeys.includes(normalizedTemplatePath)) {
		templater.settings.enabled_templates_hotkeys = [
			...enabledTemplateHotkeys,
			normalizedTemplatePath,
		];
		await templater.save_settings();
	}

	const commandId = getTemplaterCommandId(normalizedTemplatePath);
	const commands = (app as App & { commands?: CommandRegistryLike }).commands
		?.commands;
	return commands && commandId in commands ? commandId : null;
}

function getTemplateFile(app: App, templatePath: string): TFile | null {
	const normalizedTemplatePath = normalizeVaultPath(templatePath.trim());
	if (!normalizedTemplatePath) {
		return null;
	}

	const templateFile = app.vault.getAbstractFileByPath(
		normalizedTemplatePath,
	);
	return templateFile instanceof TFile ? templateFile : null;
}

function getTemplaterPlugin(app: App): TemplaterPlugin | null {
	const plugin = (
		app as App & {
			plugins?: { plugins?: Record<string, TemplaterPlugin | undefined> };
		}
	).plugins?.plugins?.['templater-obsidian'];

	return plugin ?? null;
}

function formatDate(date: Date): string {
	const year = date.getFullYear();
	const month = `${date.getMonth() + 1}`.padStart(2, '0');
	const day = `${date.getDate()}`.padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '')
		.replace(/\/+$/g, '');
}
