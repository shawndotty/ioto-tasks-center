import { App, TFile, TFolder } from 'obsidian';

export const PROJECT_METADATA_FILE_NAME = '_project.md';

export interface ProjectMetadata {
	category?: string;
	startDate?: string;
	dueDate?: string;
	[key: string]: unknown;
}

export type ProjectMetadataPatch = Record<string, string | null | undefined>;

export function getProjectMetadataPath(
	tasksRootPath: string,
	projectName: string,
): string {
	return `${tasksRootPath}/${projectName}/${PROJECT_METADATA_FILE_NAME}`;
}

export function getProjectMetadataFile(
	app: App,
	tasksRootPath: string,
	projectName: string,
): TFile | null {
	const path = getProjectMetadataPath(tasksRootPath, projectName);
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile ? file : null;
}

export async function ensureProjectMetadataFile(
	app: App,
	tasksRootPath: string,
	projectName: string,
): Promise<TFile> {
	const existing = getProjectMetadataFile(app, tasksRootPath, projectName);
	if (existing) {
		return existing;
	}

	const projectPath = `${tasksRootPath}/${projectName}`;
	const projectFolder = app.vault.getAbstractFileByPath(projectPath);
	if (!(projectFolder instanceof TFolder)) {
		throw new Error(`Project folder is missing: ${projectPath}`);
	}

	const filePath = getProjectMetadataPath(tasksRootPath, projectName);
	const created = await app.vault.create(
		filePath,
		buildProjectMetadataFile(),
	);
	return created;
}

export function countProjectTaskNotes(
	app: App,
	tasksRootPath: string,
	projectName: string,
): number {
	const projectPath = `${tasksRootPath}/${projectName}`;
	const projectFolder = app.vault.getAbstractFileByPath(projectPath);
	if (!(projectFolder instanceof TFolder)) {
		return 0;
	}

	return projectFolder.children.filter(
		(child) =>
			child instanceof TFile &&
			child.extension.toLowerCase() === 'md' &&
			child.name !== PROJECT_METADATA_FILE_NAME,
	).length;
}

export async function readProjectMetadata(
	app: App,
	file: TFile,
): Promise<ProjectMetadata> {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	const cached = readProjectMetadataFromFrontmatter(frontmatter);
	if (cached) {
		return cached;
	}

	const content = await app.vault.cachedRead(file);
	return readProjectMetadataFromContent(content);
}

export function readProjectMetadataFromFrontmatter(
	frontmatter: Record<string, unknown> | undefined,
): ProjectMetadata | null {
	const iotoProject = frontmatter?.IOTOProject;
	if (!iotoProject || typeof iotoProject !== 'object') {
		return null;
	}

	const candidate = iotoProject as Record<string, unknown>;
	const metadata: ProjectMetadata = {};
	for (const [key, value] of Object.entries(candidate)) {
		if (typeof value === 'string') {
			metadata[key] = value;
		}
	}
	return metadata;
}

export function readProjectMetadataFromContent(
	content: string,
): ProjectMetadata {
	const frontmatterBody = extractFrontmatterBody(content);
	if (!frontmatterBody) {
		return {};
	}

	return parseIOTOProjectFromFrontmatterBody(frontmatterBody);
}

export async function updateProjectMetadata(
	app: App,
	file: TFile,
	patch: ProjectMetadataPatch,
): Promise<void> {
	const content = await app.vault.read(file);
	const nextContent = upsertProjectMetadataInContent(content, patch);
	if (nextContent !== content) {
		await app.vault.modify(file, nextContent);
	}
}

export function upsertProjectMetadataInContent(
	content: string,
	patch: ProjectMetadataPatch,
): string {
	const existing = readProjectMetadataFromContent(content);
	const merged = applyMetadataPatch(existing, patch);
	return upsertIOTOProjectProperty(content, merged);
}

export function applyMetadataPatch(
	base: ProjectMetadata,
	patch: ProjectMetadataPatch,
): ProjectMetadata {
	const next: ProjectMetadata = { ...base };
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) {
			continue;
		}

		if (value === null || value.trim().length === 0) {
			delete next[key];
			continue;
		}

		next[key] = value;
	}

	return next;
}

function buildProjectMetadataFile(): string {
	return `---\nIOTOProject:\n---\n`;
}

function upsertIOTOProjectProperty(content: string, metadata: ProjectMetadata) {
	const frontmatterMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---((?:\r?\n)?[\s\S]*)$/,
	);
	const propertyBlock = buildIOTOProjectBlock(metadata);

	if (!frontmatterMatch) {
		if (propertyBlock.length === 0) {
			return content;
		}

		if (content.length === 0) {
			return `---\n${propertyBlock}\n---\n`;
		}

		return `---\n${propertyBlock}\n---\n${content}`;
	}

	const existingFrontmatterBody = frontmatterMatch[1] ?? '';
	const remainingContent = frontmatterMatch[2] ?? '';
	const cleanedFrontmatterBody = removePropertyFromFrontmatter(
		existingFrontmatterBody,
		'IOTOProject',
	);
	const nextFrontmatterBody = [cleanedFrontmatterBody, propertyBlock]
		.filter((part) => part.trim().length > 0)
		.join('\n')
		.trim();

	if (!nextFrontmatterBody) {
		if (!remainingContent) {
			return '';
		}

		return remainingContent.replace(/^\r?\n/, '');
	}

	return `---\n${nextFrontmatterBody}\n---${remainingContent}`;
}

function buildIOTOProjectBlock(metadata: ProjectMetadata): string {
	const lines: string[] = [];
	const entries = Object.entries(metadata).filter(
		([, value]) => typeof value === 'string' && value.trim().length > 0,
	) as Array<[string, string]>;

	if (entries.length === 0) {
		return '';
	}

	lines.push('IOTOProject:');
	for (const [key, value] of entries) {
		lines.push(`  ${key}: ${JSON.stringify(value)}`);
	}

	return lines.join('\n');
}

function parseIOTOProjectFromFrontmatterBody(
	frontmatterBody: string,
): ProjectMetadata {
	const lines = frontmatterBody.split(/\r?\n/);
	let inBlock = false;
	const metadata: ProjectMetadata = {};

	for (const line of lines) {
		if (!inBlock) {
			if (/^\s*IOTOProject\s*:\s*$/.test(line)) {
				inBlock = true;
			}
			continue;
		}

		if (!/^[ \t]+/.test(line)) {
			break;
		}

		const match = line.match(/^\s+([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
		if (!match) {
			continue;
		}

		const key = match[1] ?? '';
		if (!key) {
			continue;
		}

		const rawValue = stripMatchingQuotes(match[2] ?? '').trim();
		if (!rawValue) {
			continue;
		}

		metadata[key] = rawValue;
	}

	return metadata;
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

function removePropertyFromFrontmatter(
	frontmatterBody: string,
	propertyName: string,
): string {
	const lines = frontmatterBody.split(/\r?\n/);
	const nextLines: string[] = [];
	const propertyPattern = new RegExp(`^${escapeRegExp(propertyName)}\\s*:`);
	let skippingProperty = false;

	for (const line of lines) {
		if (!skippingProperty && propertyPattern.test(line)) {
			skippingProperty = true;
			continue;
		}

		if (skippingProperty) {
			if (/^[ \t]+/.test(line) || line.trim() === '') {
				continue;
			}

			skippingProperty = false;
		}

		nextLines.push(line);
	}

	return nextLines.join('\n').trim();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
