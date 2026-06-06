import { App, Notice, TFile, TFolder, WorkspaceLeaf } from 'obsidian';
import { t } from '../lang/helpter';

import {
	formatDateByPattern,
	normalizeDateTaskDateFormat,
} from './date-task-format';
import { PROJECT_METADATA_FILE_NAME } from './project-metadata';
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
	command_handler?: {
		add_template_hotkey?: (
			previousPath: string | null,
			nextPath: string,
		) => void | Promise<void>;
	};
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
		throw new Error(t('error.taskNameEmpty'));
	}

	if (type === 'normal') {
		if (`${normalizedName}.md` === PROJECT_METADATA_FILE_NAME) {
			throw new Error(t('error.taskNameReservedProjectMeta'));
		}
		return `${normalizedName}.md`;
	}

	const typeLabel =
		type === 'plan'
			? t('task.type.fileName.plan')
			: t('task.type.fileName.topic');
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

		return `---\n${propertyBlock}\n---\n${content}`;
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

		const rawInlineValue = match[1] ?? '';
		const inlineArrayValues =
			parseFrontmatterInlineArrayValues(rawInlineValue) ??
			parseFrontmatterInlineArrayValues(
				normalizeFrontmatterScalarValue(rawInlineValue),
			);
		if (inlineArrayValues) {
			return normalizeListPropertyValues(inlineArrayValues);
		}

		const inlineValue = normalizeFrontmatterScalarValue(rawInlineValue);
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
		new Notice(t('notice.taskFileExists'));
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
			);
			if (executed) {
				await waitForFileContentToStabilize(app, file, initialContent);
			}
			if (sourceLeaf) {
				app.workspace.setActiveLeaf(sourceLeaf, { focus: false });
			}
			if (executed) {
				return true;
			}
		}
	}

	const content = await app.vault.cachedRead(templateFile);
	await app.vault.modify(file, content);
	new Notice(t('notice.templateInsertedOnly'));
	return false;
}

async function executeTemplaterTemplate(
	app: App,
	targetLeaf: WorkspaceLeaf,
	file: TFile,
	commandId: string,
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
	}
}

export async function ensureTemplateCommandEnabled(
	app: App,
	templatePath: string,
): Promise<string | null> {
	const templater = getTemplaterPlugin(app);
	if (!templater) {
		return null;
	}

	const normalizedTemplatePath = normalizeVaultPath(templatePath);
	if (!normalizedTemplatePath) {
		return null;
	}

	const commandId = getTemplaterCommandId(normalizedTemplatePath);
	if (hasRegisteredCommand(app, commandId)) {
		return commandId;
	}

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

	if (hasRegisteredCommand(app, commandId)) {
		return commandId;
	}

	await templater.command_handler?.add_template_hotkey?.(
		null,
		normalizedTemplatePath,
	);

	return hasRegisteredCommand(app, commandId) ? commandId : null;
}

function hasRegisteredCommand(app: App, commandId: string): boolean {
	const commands = (app as App & { commands?: CommandRegistryLike }).commands
		?.commands;
	return Boolean(commands && commandId in commands);
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

export async function waitForFileContentToStabilize(
	app: App,
	file: TFile,
	initialContent: string,
): Promise<void> {
	const maxAttempts = 40;
	const delayMs = 50;
	const stableReadCountRequired = 3;
	let lastContent = initialContent;
	let hasChanged = false;
	let stableReadCount = 0;

	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const currentContent = await app.vault.read(file);
		if (currentContent !== lastContent) {
			lastContent = currentContent;
			hasChanged = currentContent !== initialContent || hasChanged;
			stableReadCount = hasChanged ? 1 : 0;
		} else if (hasChanged) {
			stableReadCount += 1;
			if (stableReadCount >= stableReadCountRequired) {
				return;
			}
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

export function normalizeDateTaskFileNameSegment(input: string): string {
	return input
		.trim()
		.replace(/[\\/:*?"<>|]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^-+|-+$/g, '');
}

function formatDate(date: Date, dateTaskDateFormat: string): string {
	const validFormat = resolveValidDateTaskDateFormat(dateTaskDateFormat);
	const formattedDate = formatDateByPattern(date, validFormat);
	return normalizeDateTaskFileNameSegment(formattedDate);
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

function parseFrontmatterInlineArrayValues(value: string): string[] | null {
	const trimmedValue = value.trim();
	if (!trimmedValue.startsWith('[') || !trimmedValue.endsWith(']')) {
		return null;
	}

	try {
		const parsed = JSON.parse(trimmedValue) as unknown;
		if (Array.isArray(parsed)) {
			return parsed
				.map((item) =>
					typeof item === 'string'
						? item
						: item == null
							? ''
							: String(item),
				)
				.map((item) => normalizeFrontmatterScalarValue(item))
				.filter((item) => item.length > 0);
		}
	} catch {}

	const inner = trimmedValue.slice(1, -1);
	const values: string[] = [];
	let current = '';
	let inSingleQuote = false;
	let inDoubleQuote = false;

	for (let index = 0; index < inner.length; index += 1) {
		const char = inner[index] ?? '';
		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			current += char;
			continue;
		}
		if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			current += char;
			continue;
		}

		if (char === ',' && !inSingleQuote && !inDoubleQuote) {
			const normalized = normalizeFrontmatterScalarValue(current);
			if (normalized) {
				values.push(normalized);
			}
			current = '';
			continue;
		}

		current += char;
	}

	const lastNormalized = normalizeFrontmatterScalarValue(current);
	if (lastNormalized) {
		values.push(lastNormalized);
	}

	return values;
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
