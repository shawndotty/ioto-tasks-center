import { App, TFile, TFolder } from 'obsidian';

import {
	buildTaskStatusSummary,
	getTaskStatusLabel,
	type IncompleteChecklistItem,
	type ProjectFolderEntry,
	type ProjectListResult,
	type TaskFileEntry,
	type TaskFileListResult,
	type TaskFileStatus,
} from './types';
import { PROJECT_METADATA_FILE_NAME } from './project-metadata';
import {
	TASK_LINE_PATTERN,
	stripCommentContentFromLine,
} from './note-structure';
import {
	peekTaskFileFields,
	rememberTaskFileFields,
	type TaskFileFields,
} from './task-file-cache';
import { mapWithConcurrency, TASK_SCAN_CONCURRENCY } from './async';

/** 与 `project-sort.ts` 同口径；复用 Collator 实例避免每次比较重建排序上下文。 */
const TASK_NAME_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

const PROJECT_NAME_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

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
			PROJECT_NAME_COLLATOR.compare(left.name, right.name),
		);

	return {
		status: 'success',
		projects,
	};
}

export interface ListProjectTaskFilesOptions {
	/**
	 * 是否把正文读进 `TaskFileEntry.content`。默认 true 保持既有行为。
	 * 只统计项目未完成任务数时传 false：正文不必驻留内存，且解析结果命中缓存时
	 * 连文件都不用读。
	 */
	includeContent?: boolean;
}

/**
 * 一次解析出整个任务文件的全部派生字段。
 *
 * 旧实现为 Starred / Priority / UpTask 各跑一遍 `extractFrontmatterBody`
 * （每次都是一次全文正则 + 一次 split），这里只跑一遍再逐字段扫描。
 */
export function parseTaskFileFields(content: string): TaskFileFields {
	const frontmatterBody = extractFrontmatterBody(content);
	return {
		status: getTaskFileStatusFromContent(content),
		...parseFrontmatterFields(frontmatterBody),
	};
}

function parseFrontmatterFields(
	frontmatterBody: string | null,
): Omit<TaskFileFields, 'status'> {
	if (!frontmatterBody) {
		return {
			starred: false,
			priority: undefined,
			upTaskTitles: [],
		};
	}

	const lines = frontmatterBody.split(/\r?\n/);
	return {
		starred: parseStarredFrontmatterValue(
			extractStarredFrontmatterValueFromLines(lines),
		),
		priority: parsePriorityFrontmatterValue(
			extractPriorityFrontmatterValueFromLines(lines),
		),
		upTaskTitles: parseUpTaskFrontmatterValue(
			extractUpTaskFrontmatterValueFromLines(lines),
		),
	};
}

/**
 * 取一个任务文件的解析结果，必要时附带正文。
 *
 * 缓存命中且不需要正文时完全不读文件；需要正文时才 `cachedRead`，
 * 且解析结果顺手回填缓存，让后续只需要字段的扫描零 IO。
 */
async function loadTaskFileFields(
	app: App,
	file: TFile,
	includeContent: boolean,
): Promise<{ fields: TaskFileFields; content: string }> {
	const cached = peekTaskFileFields(file);
	if (cached !== null && !includeContent) {
		return { fields: cached, content: '' };
	}

	const content = await app.vault.cachedRead(file);
	if (cached !== null) {
		return { fields: cached, content };
	}

	const fields = parseTaskFileFields(content);
	rememberTaskFileFields(file, fields);
	return { fields, content: includeContent ? content : '' };
}

export async function listProjectTaskFiles(
	app: App,
	tasksRootPath: string,
	projectName: string,
	options: ListProjectTaskFilesOptions = {},
): Promise<TaskFileListResult> {
	const includeContent = options.includeContent !== false;
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
		await mapWithConcurrency(
			markdownFiles,
			TASK_SCAN_CONCURRENCY,
			async (file) => {
				const { fields, content } = await loadTaskFileFields(
					app,
					file,
					includeContent,
				);

				return {
					name: file.name,
					basename: file.basename,
					title: file.basename,
					path: file.path,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					size: file.stat.size,
					starred: fields.starred,
					priority: fields.priority,
					status: fields.status,
					upTaskTitles: fields.upTaskTitles,
					content,
				};
			},
		)
	).sort((left, right) => {
		const byModifiedTime = right.mtime - left.mtime;
		if (byModifiedTime !== 0) {
			return byModifiedTime;
		}

		return TASK_NAME_COLLATOR.compare(left.basename, right.basename);
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
	const frontmatterBody = extractFrontmatterBody(content);
	if (!frontmatterBody) {
		return [];
	}

	return parseUpTaskFrontmatterValue(
		extractUpTaskFrontmatterValueFromLines(frontmatterBody.split(/\r?\n/)),
	);
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
	const frontmatterBody = extractFrontmatterBody(content);
	if (!frontmatterBody) {
		return undefined;
	}

	return parsePriorityFrontmatterValue(
		extractPriorityFrontmatterValueFromLines(frontmatterBody.split(/\r?\n/)),
	);
}

export function parseStarredFrontmatterValue(value: unknown): boolean {
	if (typeof value === 'boolean') {
		return value;
	}

	if (typeof value !== 'string') {
		return false;
	}

	return stripMatchingQuotes(value.trim()).toLowerCase() === 'true';
}

export function resolveStarredFromSources(options: {
	content?: string | null;
	metadataValue?: unknown;
}): boolean {
	if (typeof options.content === 'string') {
		return getStarredFromContent(options.content);
	}

	return parseStarredFrontmatterValue(options.metadataValue);
}

export function getStarredFromContent(content: string): boolean {
	const frontmatterBody = extractFrontmatterBody(content);
	if (!frontmatterBody) {
		return false;
	}

	return parseStarredFrontmatterValue(
		extractStarredFrontmatterValueFromLines(frontmatterBody.split(/\r?\n/)),
	);
}

function normalizeUpTaskTitle(value: string): string {
	const trimmedValue = value.trim();
	const wikilinkMatch = trimmedValue.match(/^\[\[([\s\S]*?)\]\]$/);
	const normalizedValue = wikilinkMatch
		? (wikilinkMatch[1] ?? '').trim()
		: trimmedValue;

	return normalizedValue;
}

function extractUpTaskFrontmatterValueFromLines(
	lines: string[],
): string | string[] | undefined {
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

function extractPriorityFrontmatterValueFromLines(
	lines: string[],
): string | undefined {
	for (const line of lines) {
		const match = line.match(/^\s*Priority:\s*(.*)$/);
		if (!match) {
			continue;
		}

		const value = stripMatchingQuotes((match[1] ?? '').trim());
		return value || undefined;
	}

	return undefined;
}

function extractStarredFrontmatterValueFromLines(
	lines: string[],
): string | undefined {
	for (const line of lines) {
		const match = line.match(/^\s*Starred:\s*(.*)$/);
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

export function getTaskFileStatusFromContent(content: string): TaskFileStatus {
	const taskMarkers = collectChecklistEntries(content).map(
		(entry) => entry.marker,
	);
	return buildTaskFileStatus(taskMarkers);
}

export async function getIncompleteChecklistItems(
	app: App,
	file: TFile,
): Promise<IncompleteChecklistItem[]> {
	try {
		const content = await app.vault.cachedRead(file);
		return getIncompleteChecklistItemsFromContent(content);
	} catch {
		return [];
	}
}

export function getIncompleteChecklistItemsFromContent(
	content: string,
): IncompleteChecklistItem[] {
	return collectChecklistEntries(content)
		.filter((entry) => entry.marker.trim() === '')
		.map((entry) => ({
			text: entry.text,
			line: entry.line,
			lineText: entry.lineText,
			selectionStartCh: entry.selectionStartCh,
			selectionEndCh: entry.selectionEndCh,
		}));
}

function hasEffectiveTaskContent(taskContent: string): boolean {
	return taskContent.trim().length > 0;
}

interface ParsedChecklistEntry extends IncompleteChecklistItem {
	marker: string;
}

function collectChecklistEntries(content: string): ParsedChecklistEntry[] {
	const lines = content.split(/\r?\n/);
	const entries: ParsedChecklistEntry[] = [];
	let inObsidianComment = false;
	let inHtmlComment = false;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const originalLine = lines[lineIndex] ?? '';
		const line = stripCommentContentFromLine(originalLine, {
			inObsidianComment,
			inHtmlComment,
		});
		inObsidianComment = line.nextInObsidianComment;
		inHtmlComment = line.nextInHtmlComment;

		if (line.sanitized.trim().length === 0) {
			continue;
		}

		const match = line.sanitized.match(TASK_LINE_PATTERN);
		if (!match) {
			continue;
		}

		const rawTaskContent = match[2] ?? '';
		if (!hasEffectiveTaskContent(rawTaskContent)) {
			continue;
		}

		const trimmedText = rawTaskContent.trim();
		const leadingWhitespaceLength =
			rawTaskContent.length - rawTaskContent.trimStart().length;
		const trailingWhitespaceLength =
			rawTaskContent.length - rawTaskContent.trimEnd().length;
		const rawSelectionStart =
			originalLine.length -
			rawTaskContent.length +
			leadingWhitespaceLength;
		const rawSelectionEnd = originalLine.length - trailingWhitespaceLength;

		entries.push({
			marker: match[1] ?? ' ',
			text: trimmedText,
			line: lineIndex,
			lineText: originalLine,
			selectionStartCh: Math.max(0, rawSelectionStart),
			selectionEndCh: Math.max(
				Math.max(0, rawSelectionStart),
				rawSelectionEnd,
			),
		});
	}

	return entries;
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
