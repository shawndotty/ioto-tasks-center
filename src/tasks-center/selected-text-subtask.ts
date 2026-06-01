import {
	App,
	Editor,
	type EditorPosition,
	MarkdownFileInfo,
	MarkdownView,
	TFile,
	type WorkspaceLeaf,
} from 'obsidian';

import {
	buildTaskFileName,
	createTaskFile,
	extractListPropertyValuesFromContent,
	normalizeCustomTaskName,
	upsertListPropertyValues,
} from './task-creation';
import type { TaskTemplateConfig } from './task-template-config';
import { assignUpTaskToFile } from './up-task-assignment';

export interface ConvertSelectedTextToSubtaskOptions {
	app: App;
	editor: Editor;
	ctx: MarkdownView | MarkdownFileInfo;
	tasksRootPath: string;
	templateConfig: TaskTemplateConfig;
	dateTaskDateFormat: string;
}

interface CurrentTaskContext {
	projectName: string;
	currentDirectoryPath: string;
	parentTaskTitle: string;
}

export function canConvertSelectedTextToSubtask(
	file: TFile | null,
	selection: string,
	tasksRootPath: string,
): boolean {
	if (!(file instanceof TFile) || !selection.trim()) {
		return false;
	}

	return isTaskFileInsideTasksRoot(file, tasksRootPath);
}

export async function convertSelectedTextToSubtask(
	options: ConvertSelectedTextToSubtaskOptions,
): Promise<TFile> {
	const { app, editor, ctx, tasksRootPath, templateConfig, dateTaskDateFormat } =
		options;
	const sourceFile = ctx.file;
	if (!(sourceFile instanceof TFile)) {
		throw new Error('当前没有可用的任务文件。');
	}

	const normalizedSubtaskName = normalizeSelectedSubtaskName(
		editor.getSelection(),
	);
	const selectedTextDisplay = normalizeSelectedSubtaskDisplayText(
		editor.getSelection(),
	);
	if (!normalizedSubtaskName) {
		throw new Error('选中的文本无法作为子任务名称。');
	}

	const currentTaskContext = resolveCurrentTaskContext(sourceFile, tasksRootPath);
	const sourceLeaf = resolveSourceLeaf(app, ctx, sourceFile);
	const sourceSelection = {
		anchor: editor.getCursor('anchor'),
		head: editor.getCursor('head'),
	};

	const result = await createTaskFile({
		app,
		tasksRootPath,
		projectName: currentTaskContext.projectName,
		type: 'normal',
		customName: normalizedSubtaskName,
		targetDirectoryPath: currentTaskContext.currentDirectoryPath,
		templateConfig,
		dateTaskDateFormat,
		targetLeaf: sourceLeaf,
		sourceLeaf,
	});

	if (result.file.path === sourceFile.path) {
		await restoreSourceEditorContext(
			app,
			sourceLeaf,
			sourceFile,
			sourceSelection,
			editor,
		);
		throw new Error('不能把当前任务文件本身转换为它自己的子任务。');
	}

	await copyProjectPropertyFromSourceToTarget(
		app,
		sourceFile,
		result.file,
		currentTaskContext.projectName,
	);
	await assignUpTaskToFile(app, result.file, currentTaskContext.parentTaskTitle);
	const sourceEditor = await restoreSourceEditorContext(
		app,
		sourceLeaf,
		sourceFile,
		sourceSelection,
		editor,
	);
	const wikilink = buildSelectedTextSubtaskWikilink({
		linktext: app.metadataCache.fileToLinktext(
			result.file,
			sourceFile.path,
			true,
		),
		selectedText: selectedTextDisplay,
	});
	sourceEditor.replaceSelection(wikilink);
	sourceEditor.focus();

	return result.file;
}

export function resolveCurrentTaskContext(
	file: TFile,
	tasksRootPath: string,
): CurrentTaskContext {
	const normalizedTasksRootPath = normalizeVaultPath(tasksRootPath);
	const normalizedFilePath = normalizeVaultPath(file.path);
	if (!isPathInsideRoot(normalizedFilePath, normalizedTasksRootPath)) {
		throw new Error('当前文件不在任务根目录下。');
	}

	const relativePath = normalizedFilePath.slice(normalizedTasksRootPath.length + 1);
	const pathSegments = relativePath.split('/').filter(Boolean);
	if (pathSegments.length < 2) {
		throw new Error('当前文件不在有效的项目目录中。');
	}

	return {
		projectName: pathSegments[0] ?? '',
		currentDirectoryPath: normalizeVaultPath(file.parent?.path ?? tasksRootPath),
		parentTaskTitle: file.basename,
	};
}

export function normalizeSelectedSubtaskName(selection: string): string | null {
	return normalizeCustomTaskName(selection.replace(/\r?\n+/g, ' '));
}

export function normalizeSelectedSubtaskDisplayText(selection: string): string {
	return selection.replace(/\r?\n+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function buildSelectedTextSubtaskWikilink(options: {
	linktext: string;
	selectedText: string;
}): string {
	const normalizedLinktext = options.linktext.trim();
	const normalizedSelectedText = normalizeSelectedSubtaskDisplayText(
		options.selectedText,
	);
	if (!normalizedSelectedText || normalizedSelectedText === normalizedLinktext) {
		return `[[${normalizedLinktext}]]`;
	}

	return `[[${normalizedLinktext}|${normalizedSelectedText}]]`;
}

async function copyProjectPropertyFromSourceToTarget(
	app: App,
	sourceFile: TFile,
	targetFile: TFile,
	fallbackProjectName: string,
): Promise<void> {
	const sourceContent = await app.vault.read(sourceFile);
	const projectValues = extractListPropertyValuesFromContent(
		sourceContent,
		'Project',
	);
	const nextProjectValues =
		projectValues.length > 0 ? projectValues : [fallbackProjectName];
	const targetContent = await app.vault.read(targetFile);
	const nextContent = upsertListPropertyValues(
		targetContent,
		'Project',
		nextProjectValues,
	);
	if (nextContent !== targetContent) {
		await app.vault.modify(targetFile, nextContent);
	}
}

async function restoreSourceEditorContext(
	app: App,
	sourceLeaf: WorkspaceLeaf | null,
	sourceFile: TFile,
	selection: { anchor: EditorPosition; head: EditorPosition },
	fallbackEditor: Editor,
): Promise<Editor> {
	if (!sourceLeaf) {
		fallbackEditor.setSelection(selection.anchor, selection.head);
		return fallbackEditor;
	}

	await sourceLeaf.openFile(sourceFile, { active: true });
	app.workspace.setActiveLeaf(sourceLeaf, { focus: true });

	const sourceView = sourceLeaf.view;
	if (!(sourceView instanceof MarkdownView) || sourceView.file?.path !== sourceFile.path) {
		fallbackEditor.setSelection(selection.anchor, selection.head);
		return fallbackEditor;
	}

	sourceView.editor.setSelection(selection.anchor, selection.head);
	sourceView.editor.focus();
	return sourceView.editor;
}

function resolveSourceLeaf(
	app: App,
	ctx: MarkdownView | MarkdownFileInfo,
	sourceFile: TFile,
): WorkspaceLeaf | null {
	if (ctx instanceof MarkdownView) {
		return ctx.leaf;
	}

	const activeMarkdownView = app.workspace.getActiveViewOfType(MarkdownView);
	if (activeMarkdownView?.file?.path === sourceFile.path) {
		return activeMarkdownView.leaf;
	}

	return null;
}

function isTaskFileInsideTasksRoot(file: TFile, tasksRootPath: string): boolean {
	return isPathInsideRoot(file.path, tasksRootPath);
}

function isPathInsideRoot(path: string, tasksRootPath: string): boolean {
	const normalizedPath = normalizeVaultPath(path);
	const normalizedTasksRootPath = normalizeVaultPath(tasksRootPath);
	return (
		normalizedPath === normalizedTasksRootPath ||
		normalizedPath.startsWith(`${normalizedTasksRootPath}/`)
	);
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '')
		.replace(/\/+$/g, '');
}

export function resolveSelectedSubtaskTargetPath(options: {
	tasksRootPath: string;
	file: TFile;
	selection: string;
	dateTaskDateFormat: string;
}): string | null {
	const normalizedName = normalizeSelectedSubtaskName(options.selection);
	if (!normalizedName) {
		return null;
	}

	const currentTaskContext = resolveCurrentTaskContext(
		options.file,
		options.tasksRootPath,
	);
	const fileName = buildTaskFileName(
		currentTaskContext.projectName,
		'normal',
		new Date(),
		options.dateTaskDateFormat,
		normalizedName,
	);
	return normalizeVaultPath(
		`${currentTaskContext.currentDirectoryPath}/${fileName}`,
	);
}
