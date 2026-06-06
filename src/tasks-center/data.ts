import { App, TFile, TFolder } from 'obsidian';

import {
	buildTaskStatusSummary,
	getTaskStatusLabel,
	ProjectFolderEntry,
	ProjectListResult,
	TaskFileEntry,
	TaskFileListResult,
	TaskFileStatus,
} from './types';
import { PROJECT_METADATA_FILE_NAME } from './project-metadata';

const OBSIDIAN_COMMENT_BLOCK_PATTERN = /%%[\s\S]*?%%/g;
const HTML_COMMENT_BLOCK_PATTERN = /<!--[\s\S]*?-->/g;
const TASK_LINE_PATTERN = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\](.*)$/;

export function isProjectTaskMarkdownFileName(fileName: string): boolean {
	return (
		fileName.toLowerCase().endsWith('.md') &&
		fileName !== PROJECT_METADATA_FILE_NAME
	);
}

export function getTasksRootFolder(
	app: App,
	tasksRootPath: string,
): TFolder | null {
	const root = app.vault.getAbstractFileByPath(tasksRootPath);
	return root instanceof TFolder ? root : null;
}

export function listProjectFolders(
	app: App,
	tasksRootPath: string,
): ProjectListResult {
	const rootFolder = getTasksRootFolder(app, tasksRootPath);
	if (!rootFolder) {
		return {
			status: 'root-missing',
			projects: [],
		};
	}

	const projects: ProjectFolderEntry[] = rootFolder.children
		.filter((child): child is TFolder => child instanceof TFolder)
		.map((folder) => ({
			name: folder.name,
			path: folder.path,
		}))
		.sort((left, right) =>
			left.name.localeCompare(right.name, 'zh-Hans-CN'),
		);

	return {
		status: 'success',
		projects,
	};
}

export async function listProjectTaskFiles(
	app: App,
	tasksRootPath: string,
	projectName: string,
): Promise<TaskFileListResult> {
	const rootFolder = getTasksRootFolder(app, tasksRootPath);
	const projectPath = `${tasksRootPath}/${projectName}`;

	if (!rootFolder) {
		return {
			status: 'root-missing',
			projectName,
			projectPath,
			tasks: [],
		};
	}

	const projectFolder = app.vault.getAbstractFileByPath(projectPath);
	if (!(projectFolder instanceof TFolder)) {
		return {
			status: 'project-missing',
			projectName,
			projectPath,
			tasks: [],
		};
	}

	const markdownFiles = projectFolder.children.filter(
		(child): child is TFile =>
			child instanceof TFile && isProjectTaskMarkdownFileName(child.name),
	);
	const tasks: TaskFileEntry[] = (
		await Promise.all(
			markdownFiles.map(async (file) => ({
				name: file.name,
				basename: file.basename,
				title: file.basename,
				path: file.path,
				mtime: file.stat.mtime,
				ctime: file.stat.ctime,
				size: file.stat.size,
				priority: await getTaskFilePriority(app, file),
				status: await getTaskFileStatus(app, file),
				upTaskTitles: await getUpTaskTitles(app, file),
			})),
		)
	).sort((left, right) => {
		const byModifiedTime = right.mtime - left.mtime;
		if (byModifiedTime !== 0) {
			return byModifiedTime;
		}

		return left.basename.localeCompare(right.basename, 'zh-Hans-CN');
	});

	if (tasks.length === 0) {
		return {
			status: 'empty',
			projectName,
			projectPath,
			tasks: [],
		};
	}

	return {
		status: 'success',
		projectName,
		projectPath,
		tasks,
	};
}

async function getUpTaskTitles(app: App, file: TFile): Promise<string[]> {
	try {
		const content = await app.vault.cachedRead(file);
		return resolveUpTaskTitlesFromSources({
			content,
			metadataValue:
				app.metadataCache.getFileCache(file)?.frontmatter?.UpTask,
		});
	} catch {
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		return parseUpTaskFrontmatterValue(frontmatter?.UpTask);
	}
}

async function getTaskFilePriority(
	app: App,
	file: TFile,
): Promise<number | undefined> {
	try {
		const content = await app.vault.cachedRead(file);
		return resolvePriorityFromSources({
			content,
			metadataValue:
				app.metadataCache.getFileCache(file)?.frontmatter?.Priority,
		});
	} catch {
		const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
		return parsePriorityFrontmatterValue(frontmatter?.Priority);
	}
}

export function parseUpTaskFrontmatterValue(value: unknown): string[] {
	if (typeof value === 'string') {
		const normalized = normalizeUpTaskTitle(value);
		return normalized ? [normalized] : [];
	}

	if (Array.isArray(value)) {
		return value
			.filter((item): item is string => typeof item === 'string')
			.map((item) => normalizeUpTaskTitle(item))
			.filter((item) => item.length > 0);
	}

	return [];
}

export function resolveUpTaskTitlesFromSources(options: {
	content?: string | null;
	metadataValue?: unknown;
}): string[] {
	if (typeof options.content === 'string') {
		return getUpTaskTitlesFromContent(options.content);
	}

	return parseUpTaskFrontmatterValue(options.metadataValue);
}

export function getUpTaskTitlesFromContent(content: string): string[] {
	const upTaskValue = extractUpTaskFrontmatterValue(content);
	return parseUpTaskFrontmatterValue(upTaskValue);
}

export function parsePriorityFrontmatterValue(
	value: unknown,
): number | undefined {
	if (typeof value === 'number') {
		return Number.isInteger(value) && value >= 0 ? value : undefined;
	}

	if (typeof value !== 'string') {
		return undefined;
	}

	const normalizedValue = stripMatchingQuotes(value.trim());
	if (!/^\d+$/.test(normalizedValue)) {
		return undefined;
	}

	const priority = Number.parseInt(normalizedValue, 10);
	return Number.isSafeInteger(priority) ? priority : undefined;
}

export function resolvePriorityFromSources(options: {
	content?: string | null;
	metadataValue?: unknown;
}): number | undefined {
	if (typeof options.content === 'string') {
		return getPriorityFromContent(options.content);
	}

	return parsePriorityFrontmatterValue(options.metadataValue);
}

export function getPriorityFromContent(content: string): number | undefined {
	const priorityValue = extractPriorityFrontmatterValue(content);
	return parsePriorityFrontmatterValue(priorityValue);
}

function normalizeUpTaskTitle(value: string): string {
	const trimmedValue = value.trim();
	const wikilinkMatch = trimmedValue.match(/^\[\[([\s\S]*?)\]\]$/);
	const normalizedValue = wikilinkMatch
		? (wikilinkMatch[1] ?? '').trim()
		: trimmedValue;

	return normalizedValue;
}

function extractUpTaskFrontmatterValue(
	content: string,
): string | string[] | undefined {
	const frontmatterBody = extractFrontmatterBody(content);
	if (!frontmatterBody) {
		return undefined;
	}

	const lines = frontmatterBody.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? '';
		const match = line.match(/^\s*UpTask:\s*(.*)$/);
		if (!match) {
			continue;
		}

		const inlineValue = stripMatchingQuotes((match[1] ?? '').trim());
		if (inlineValue) {
			return inlineValue;
		}

		const listValues: string[] = [];
		for (
			let nextIndex = index + 1;
			nextIndex < lines.length;
			nextIndex += 1
		) {
			const nextLine = lines[nextIndex] ?? '';
			if (!nextLine.trim()) {
				if (listValues.length > 0) {
					break;
				}
				continue;
			}

			const listItemMatch = nextLine.match(/^\s*-\s*(.+)\s*$/);
			if (listItemMatch) {
				listValues.push(
					stripMatchingQuotes((listItemMatch[1] ?? '').trim()),
				);
				continue;
			}

			break;
		}

		return listValues;
	}

	return undefined;
}

function extractPriorityFrontmatterValue(content: string): string | undefined {
	const frontmatterBody = extractFrontmatterBody(content);
	if (!frontmatterBody) {
		return undefined;
	}

	for (const line of frontmatterBody.split(/\r?\n/)) {
		const match = line.match(/^\s*Priority:\s*(.*)$/);
		if (!match) {
			continue;
		}

		const value = stripMatchingQuotes((match[1] ?? '').trim());
		return value || undefined;
	}

	return undefined;
}

function extractFrontmatterBody(content: string): string | null {
	const frontmatterMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
	);
	return frontmatterMatch?.[1] ?? null;
}

function stripMatchingQuotes(value: string): string {
	if (value.length < 2) {
		return value;
	}

	const firstChar = value[0];
	const lastChar = value[value.length - 1];
	if (
		(firstChar === '"' && lastChar === '"') ||
		(firstChar === "'" && lastChar === "'")
	) {
		return value.slice(1, -1).trim();
	}

	return value;
}

async function getTaskFileStatus(
	app: App,
	file: TFile,
): Promise<TaskFileStatus> {
	try {
		const content = await app.vault.cachedRead(file);
		return getTaskFileStatusFromContent(content);
	} catch {
		return getTaskFileStatusFromMetadataCache(app, file);
	}
}

function getTaskFileStatusFromMetadataCache(
	app: App,
	file: TFile,
): TaskFileStatus {
	const cache = app.metadataCache.getFileCache(file);
	const taskItems =
		cache?.listItems?.filter((item) => item.task !== undefined) ?? [];
	const taskMarkers = taskItems.map((item) =>
		item.task !== undefined && item.task !== ' ' ? 'x' : ' ',
	);
	return buildTaskFileStatus(taskMarkers);
}

export function getTaskFileStatusFromContent(content: string): TaskFileStatus {
	const taskMarkers = collectTaskMarkers(content);
	return buildTaskFileStatus(taskMarkers);
}

function collectTaskMarkers(content: string): string[] {
	const sanitizedContent = stripIgnoredContent(content);
	return sanitizedContent
		.split('\n')
		.map((line) => line.match(TASK_LINE_PATTERN))
		.filter((match): match is RegExpMatchArray =>
			Boolean(match && hasEffectiveTaskContent(match[2] ?? '')),
		)
		.map((match) => match[1] ?? ' ');
}

function stripIgnoredContent(content: string): string {
	return content
		.replace(OBSIDIAN_COMMENT_BLOCK_PATTERN, '\n')
		.replace(HTML_COMMENT_BLOCK_PATTERN, '\n');
}

function hasEffectiveTaskContent(taskContent: string): boolean {
	return taskContent.trim().length > 0;
}

function buildTaskFileStatus(taskMarkers: string[]): TaskFileStatus {
	const totalTaskCount = taskMarkers.length;
	const completedTaskCount = taskMarkers.filter(
		(taskMarker) => taskMarker.toLowerCase() === 'x',
	).length;

	if (totalTaskCount === 0) {
		return {
			key: 'empty',
			label: getTaskStatusLabel('empty'),
			totalTaskCount,
			completedTaskCount,
			summary: buildTaskStatusSummary(
				'empty',
				totalTaskCount,
				completedTaskCount,
			),
		};
	}

	if (completedTaskCount === totalTaskCount) {
		return {
			key: 'completed',
			label: getTaskStatusLabel('completed'),
			totalTaskCount,
			completedTaskCount,
			summary: buildTaskStatusSummary(
				'completed',
				totalTaskCount,
				completedTaskCount,
			),
		};
	}

	if (completedTaskCount === 0) {
		return {
			key: 'todo',
			label: getTaskStatusLabel('todo'),
			totalTaskCount,
			completedTaskCount,
			summary: buildTaskStatusSummary(
				'todo',
				totalTaskCount,
				completedTaskCount,
			),
		};
	}

	return {
		key: 'in-progress',
		label: getTaskStatusLabel('in-progress'),
		totalTaskCount,
		completedTaskCount,
		summary: buildTaskStatusSummary(
			'in-progress',
			totalTaskCount,
			completedTaskCount,
		),
	};
}
