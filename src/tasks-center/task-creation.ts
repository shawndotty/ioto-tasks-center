import { App, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';

import {
	formatDateByPattern,
	normalizeDateTaskDateFormat,
} from './date-task-format';
import {
	resolveTaskTemplateSource,
	type TaskCreationType,
	type TaskTemplateConfig,
} from './task-template-config';

export interface CreateTaskFileOptions {
	app: App;
	tasksRootPath: string;
	projectName: string;
	type: TaskCreationType;
	customName?: string;
	targetDirectoryPath?: string;
	templateConfig: TaskTemplateConfig;
	dateTaskDateFormat: string;
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
	dateTaskDateFormat: string,
	customName?: string,
): string {
	if (type === 'date') {
		return `${projectName}-${formatDate(date, dateTaskDateFormat)}.md`;
	}

	const normalizedName = normalizeCustomTaskName(customName ?? '');
	if (!normalizedName) {
		throw new Error('任务名称不能为空。');
	}

	if (type === 'normal') {
		return `${normalizedName}.md`;
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
	tasksRootPath: string,
	projectName: string,
	fileName: string,
	targetDirectoryPath?: string,
): string {
	const baseDirectoryPath =
		targetDirectoryPath && targetDirectoryPath.trim().length > 0
			? targetDirectoryPath
			: `${tasksRootPath}/${projectName}`;
	return normalizeVaultPath(`${baseDirectoryPath}/${fileName}`);
}

export function getTemplaterCommandId(templatePath: string): string {
	return `templater-obsidian:${templatePath}`;
}

export function buildProjectPropertyFrontmatter(projectName: string): string {
	return buildListPropertyFrontmatter('Project', projectName);
}

export function buildListPropertyFrontmatterLines(
	propertyName: string,
	values: string[],
): string[] {
	const normalizedValues = normalizeListPropertyValues(values);
	if (normalizedValues.length === 0) {
		return [];
	}

	return [
		`${propertyName}:`,
		...normalizedValues.map((value) => `  - ${JSON.stringify(value)}`),
	];
}

export function buildListPropertyFrontmatter(
	propertyName: string,
	value: string,
): string {
	return buildListPropertyFrontmatterLines(propertyName, [value]).join('\n');
}

export function upsertProjectProperty(
	content: string,
	projectName: string,
): string {
	return upsertListPropertyValues(content, 'Project', [projectName]);
}

export function upsertListProperty(
	content: string,
	propertyName: string,
	value: string,
): string {
	return upsertListPropertyValues(content, propertyName, [value]);
}

export function upsertListPropertyValues(
	content: string,
	propertyName: string,
	values: string[],
): string {
	const propertyLines = buildListPropertyFrontmatterLines(
		propertyName,
		values,
	);
	if (propertyLines.length === 0) {
		return removeListProperty(content, propertyName);
	}

	const propertyBlock = propertyLines.join('\n');
	const frontmatterMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---((?:\r?\n)?[\s\S]*)$/,
	);

	if (!frontmatterMatch) {
		if (content.length === 0) {
			return `---\n${propertyBlock}\n---\n`;
		}

		return `---\n${propertyBlock}\n---\n\n${content}`;
	}

	const existingFrontmatterBody = frontmatterMatch[1] ?? '';
	const remainingContent = frontmatterMatch[2] ?? '';
	const cleanedFrontmatterBody = removeListPropertyFromFrontmatter(
		existingFrontmatterBody,
		propertyName,
	);
	const nextFrontmatterBody = cleanedFrontmatterBody
		? `${cleanedFrontmatterBody}\n${propertyBlock}`
		: propertyBlock;

	return `---\n${nextFrontmatterBody}\n---${remainingContent}`;
}

export function extractListPropertyValuesFromContent(
	content: string,
	propertyName: string,
): string[] {
	const frontmatterMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
	);
	if (!frontmatterMatch) {
		return [];
	}

	const frontmatterBody = frontmatterMatch[1] ?? '';
	const lines = frontmatterBody.split(/\r?\n/);
	const propertyPattern = new RegExp(
		`^${escapeRegExp(propertyName)}\\s*:\\s*(.*)$`,
	);

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		const match = line.match(propertyPattern);
		if (!match) {
			continue;
		}

		const inlineValue = normalizeFrontmatterScalarValue(match[1] ?? '');
		if (inlineValue) {
			return [inlineValue];
		}

		const values: string[] = [];
		for (
			let nextIndex = index + 1;
			nextIndex < lines.length;
			nextIndex += 1
		) {
			const nextLine = lines[nextIndex] ?? '';
			if (nextLine.trim() === '') {
				continue;
			}
			if (!/^[ \t]+/.test(nextLine)) {
				break;
			}

			const listMatch = nextLine.match(/^\s*-\s*(.*)$/);
			if (!listMatch) {
				continue;
			}

			const normalizedValue = normalizeFrontmatterScalarValue(
				listMatch[1] ?? '',
			);
			if (normalizedValue) {
				values.push(normalizedValue);
			}
		}

		return normalizeListPropertyValues(values);
	}

	return [];
}

export function removeListProperty(
	content: string,
	propertyName: string,
): string {
	const frontmatterMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---((?:\r?\n)?[\s\S]*)$/,
	);

	if (!frontmatterMatch) {
		return content;
	}

	const existingFrontmatterBody = frontmatterMatch[1] ?? '';
	const remainingContent = frontmatterMatch[2] ?? '';
	const cleanedFrontmatterBody = removeListPropertyFromFrontmatter(
		existingFrontmatterBody,
		propertyName,
	);

	if (!cleanedFrontmatterBody) {
		if (!remainingContent) {
			return '';
		}

		const contentWithoutLeadingBreak = remainingContent.replace(
			/^\r?\n/,
			'',
		);
		return contentWithoutLeadingBreak;
	}

	return `---\n${cleanedFrontmatterBody}\n---${remainingContent}`;
}

export async function createTaskFile(
	options: CreateTaskFileOptions,
): Promise<CreateTaskFileResult> {
	const {
		app,
		tasksRootPath,
		projectName,
		type,
		customName,
		targetDirectoryPath,
		templateConfig,
		dateTaskDateFormat,
		targetLeaf,
		sourceLeaf,
	} = options;
	const normalizedCustomName = customName
		? normalizeCustomTaskName(customName)
		: null;
	const fileName = buildTaskFileName(
		projectName,
		type,
		new Date(),
		dateTaskDateFormat,
		normalizedCustomName ?? undefined,
	);
	const targetPath = resolveTaskTargetPath(
		tasksRootPath,
		projectName,
		fileName,
		targetDirectoryPath,
	);
	const targetDirectory = app.vault.getAbstractFileByPath(
		normalizeVaultPath(
			targetDirectoryPath ?? `${tasksRootPath}/${projectName}`,
		),
	);
	if (!(targetDirectory instanceof TFolder)) {
		throw new Error(
			`任务目录不存在：${targetDirectoryPath ?? projectName}`,
		);
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
	const resolvedTemplateSource = resolveTaskTemplateSource(templateConfig);
	if (resolvedTemplateSource.kind === 'none') {
		await applyTaskPropertiesToFile(app, file, {
			projectName,
			type,
			customName: normalizedCustomName,
		});
		return {
			file,
			created: true,
			templaterApplied: false,
		};
	}

	const templaterApplied =
		resolvedTemplateSource.kind === 'inline'
			? await applyInlineTemplateToFile(
					app,
					file,
					resolvedTemplateSource.inlineContent,
				)
			: await applyTemplateFileToFile(
					app,
					file,
					resolvedTemplateSource.templatePath,
					targetLeaf,
					sourceLeaf,
				);
	await applyTaskPropertiesToFile(app, file, {
		projectName,
		type,
		customName: normalizedCustomName,
	});
	return {
		file,
		created: true,
		templaterApplied,
	};
}

async function applyInlineTemplateToFile(
	app: App,
	file: TFile,
	inlineContent: string,
): Promise<boolean> {
	await app.vault.modify(file, inlineContent);
	return false;
}

async function applyTemplateFileToFile(
	app: App,
	file: TFile,
	templatePath: string,
	targetLeaf?: WorkspaceLeaf | null,
	sourceLeaf?: WorkspaceLeaf | null,
): Promise<boolean> {
	const templateFile = getTemplateFile(app, templatePath);
	if (!templateFile) {
		return false;
	}

	if (targetLeaf) {
		const initialContent = await app.vault.read(file);
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
				await waitForFileContentChange(app, file, initialContent);
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

async function applyTaskPropertiesToFile(
	app: App,
	file: TFile,
	options: {
		projectName: string;
		type: TaskCreationType;
		customName: string | null;
	},
): Promise<void> {
	const { projectName, type, customName } = options;
	let nextContent = await app.vault.read(file);

	nextContent = upsertListProperty(nextContent, 'Project', projectName);

	for (const propertyName of getPropertiesToRemove(type)) {
		nextContent = removeListProperty(nextContent, propertyName);
	}

	if (type === 'topic' && customName) {
		nextContent = upsertListProperty(nextContent, 'Subject', customName);
	}

	if (type === 'plan' && customName) {
		nextContent = upsertListProperty(nextContent, 'Plan', customName);
	}

	const currentContent = await app.vault.read(file);
	if (nextContent !== currentContent) {
		await app.vault.modify(file, nextContent);
	}
}

async function waitForFileContentChange(
	app: App,
	file: TFile,
	initialContent: string,
): Promise<void> {
	const maxAttempts = 20;
	const delayMs = 50;

	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const currentContent = await app.vault.read(file);
		if (currentContent !== initialContent) {
			return;
		}

		await delay(delayMs);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

export function resolveValidDateTaskDateFormat(format: string): string {
	return normalizeDateTaskDateFormat(format);
}

function formatDate(date: Date, dateTaskDateFormat: string): string {
	const validFormat = resolveValidDateTaskDateFormat(dateTaskDateFormat);
	return formatDateByPattern(date, validFormat);
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '')
		.replace(/\/+$/g, '');
}

function normalizeListPropertyValues(values: string[]): string[] {
	const normalizedValues: string[] = [];
	const seenValues = new Set<string>();

	for (const value of values) {
		const normalizedValue = normalizeFrontmatterScalarValue(value);
		if (!normalizedValue || seenValues.has(normalizedValue)) {
			continue;
		}

		seenValues.add(normalizedValue);
		normalizedValues.push(normalizedValue);
	}

	return normalizedValues;
}

function normalizeFrontmatterScalarValue(value: string): string {
	const trimmedValue = value.trim();
	if (!trimmedValue) {
		return '';
	}

	const quotedMatch = trimmedValue.match(/^(['"])([\s\S]*)\1$/);
	return quotedMatch ? (quotedMatch[2] ?? '').trim() : trimmedValue;
}

function removeListPropertyFromFrontmatter(
	frontmatterBody: string,
	propertyName: string,
): string {
	const lines = frontmatterBody.split(/\r?\n/);
	const nextLines: string[] = [];
	let skippingProjectProperty = false;
	const propertyPattern = new RegExp(`^${escapeRegExp(propertyName)}\\s*:`);

	for (const line of lines) {
		if (!skippingProjectProperty && propertyPattern.test(line)) {
			skippingProjectProperty = true;
			continue;
		}

		if (skippingProjectProperty) {
			if (/^[ \t]+/.test(line) || line.trim() === '') {
				continue;
			}

			skippingProjectProperty = false;
		}

		nextLines.push(line);
	}

	return nextLines.join('\n').trim();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPropertiesToRemove(type: TaskCreationType): string[] {
	switch (type) {
		case 'topic':
			return ['Plan'];
		case 'plan':
			return ['Subject'];
		case 'date':
		case 'normal':
			return ['Subject', 'Plan'];
	}
}
