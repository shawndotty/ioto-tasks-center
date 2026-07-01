import { App, TFile, TFolder } from 'obsidian';

import {
	buildTaskStatusSummary,
	getTaskStatusLabel,
	IncompleteChecklistItem,
	ProjectFolderEntry,
	ProjectListResult,
	TaskFileEntry,
	TaskFileListResult,
	TaskFileStatus,
} from './types';
import { PROJECT_METADATA_FILE_NAME } from './project-metadata';

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
			markdownFiles.map(async (file) => {
				const content = await app.vault.cachedRead(file);
				const metadataValue = (key: string): unknown =>
					app.metadataCache.getFileCache(file)?.frontmatter?.[key];
				return {
					name: file.name,
					basename: file.basename,
					title: file.basename,
					path: file.path,
					mtime: file.stat.mtime,
					ctime: file.stat.ctime,
					size: file.stat.size,
					starred: resolveStarredFromSources({
						content,
						metadataValue: metadataValue('Starred'),
					}),
					priority: resolvePriorityFromSources({
						content,
						metadataValue: metadataValue('Priority'),
					}),
					status: getTaskFileStatusFromContent(content),
					upTaskTitles: resolveUpTaskTitlesFromSources({
						content,
						metadataValue: metadataValue('UpTask'),
					}),
					content,
				};
			}),
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
	const starredValue = extractStarredFrontmatterValue(content);
	return parseStarredFrontmatterValue(starredValue);
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

function extractStarredFrontmatterValue(content: string): string | undefined {
	const frontmatterBody = extractFrontmatterBody(content);
	if (!frontmatterBody) {
		return undefined;
	}

	for (const line of frontmatterBody.split(/\r?\n/)) {
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

function stripCommentContentFromLine(
	line: string,
	state: {
		inObsidianComment: boolean;
		inHtmlComment: boolean;
	},
): {
	sanitized: string;
	nextInObsidianComment: boolean;
	nextInHtmlComment: boolean;
} {
	let sanitized = '';
	let cursor = 0;
	let nextInObsidianComment = state.inObsidianComment;
	let nextInHtmlComment = state.inHtmlComment;

	while (cursor < line.length) {
		if (nextInObsidianComment) {
			const commentEnd = line.indexOf('%%', cursor);
			if (commentEnd === -1) {
				return {
					sanitized,
					nextInObsidianComment: true,
					nextInHtmlComment,
				};
			}
			cursor = commentEnd + 2;
			nextInObsidianComment = false;
			continue;
		}

		if (nextInHtmlComment) {
			const commentEnd = line.indexOf('-->', cursor);
			if (commentEnd === -1) {
				return {
					sanitized,
					nextInObsidianComment,
					nextInHtmlComment: true,
				};
			}
			cursor = commentEnd + 3;
			nextInHtmlComment = false;
			continue;
		}

		const nextObsidianComment = line.indexOf('%%', cursor);
		const nextHtmlComment = line.indexOf('<!--', cursor);
		const hasObsidianComment = nextObsidianComment !== -1;
		const hasHtmlComment = nextHtmlComment !== -1;

		if (!hasObsidianComment && !hasHtmlComment) {
			sanitized += line.slice(cursor);
			break;
		}

		const nextCommentStart =
			hasObsidianComment && hasHtmlComment
				? Math.min(nextObsidianComment, nextHtmlComment)
				: hasObsidianComment
					? nextObsidianComment
					: nextHtmlComment;

		sanitized += line.slice(cursor, nextCommentStart);
		if (nextCommentStart === nextObsidianComment) {
			cursor = nextCommentStart + 2;
			nextInObsidianComment = true;
			continue;
		}

		cursor = nextCommentStart + 4;
		nextInHtmlComment = true;
	}

	return {
		sanitized,
		nextInObsidianComment,
		nextInHtmlComment,
	};
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
