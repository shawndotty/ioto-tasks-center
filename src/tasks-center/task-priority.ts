import { App, TFile } from 'obsidian';

export const TASK_PRIORITY_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type TaskPriorityValue = (typeof TASK_PRIORITY_VALUES)[number];

export function isTaskPriorityValue(value: number): value is TaskPriorityValue {
	return TASK_PRIORITY_VALUES.includes(value as TaskPriorityValue);
}

export async function setTaskFilePriority(
	app: App,
	file: TFile,
	priority: TaskPriorityValue,
): Promise<void> {
	await updateTaskFilePriority(app, file, priority);
}

export async function clearTaskFilePriority(
	app: App,
	file: TFile,
): Promise<void> {
	await updateTaskFilePriority(app, file);
}

async function updateTaskFilePriority(
	app: App,
	file: TFile,
	priority?: TaskPriorityValue,
): Promise<void> {
	const content = await app.vault.read(file);
	const nextContent =
		priority === undefined
			? removeScalarProperty(content, 'Priority')
			: upsertScalarProperty(content, 'Priority', `${priority}`);

	if (nextContent !== content) {
		await app.vault.modify(file, nextContent);
	}
}

function upsertScalarProperty(
	content: string,
	propertyName: string,
	value: string,
): string {
	const propertyLine = `${propertyName}: ${value}`;
	const frontmatterMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---((?:\r?\n)?[\s\S]*)$/,
	);

	if (!frontmatterMatch) {
		if (content.length === 0) {
			return `---\n${propertyLine}\n---\n`;
		}

		return `---\n${propertyLine}\n---\n${content}`;
	}

	const existingFrontmatterBody = frontmatterMatch[1] ?? '';
	const remainingContent = frontmatterMatch[2] ?? '';
	const cleanedFrontmatterBody = removePropertyFromFrontmatter(
		existingFrontmatterBody,
		propertyName,
	);
	const nextFrontmatterBody = cleanedFrontmatterBody
		? `${cleanedFrontmatterBody}\n${propertyLine}`
		: propertyLine;

	return `---\n${nextFrontmatterBody}\n---${remainingContent}`;
}

function removeScalarProperty(content: string, propertyName: string): string {
	const frontmatterMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---((?:\r?\n)?[\s\S]*)$/,
	);

	if (!frontmatterMatch) {
		return content;
	}

	const existingFrontmatterBody = frontmatterMatch[1] ?? '';
	const remainingContent = frontmatterMatch[2] ?? '';
	const cleanedFrontmatterBody = removePropertyFromFrontmatter(
		existingFrontmatterBody,
		propertyName,
	);

	if (!cleanedFrontmatterBody) {
		if (!remainingContent) {
			return '';
		}

		return remainingContent.replace(/^\r?\n/, '');
	}

	return `---\n${cleanedFrontmatterBody}\n---${remainingContent}`;
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
