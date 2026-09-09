import type { App, TFile } from 'obsidian';

import { removeListProperty, upsertListProperty } from './task-creation';

/**
 * 原子地读改写任务笔记的 frontmatter：把 `vault.read + vault.modify` 换成
 * `vault.process`，避免两次操作之间被其它写入覆盖。
 */
export async function rewriteTaskFrontmatter(
	app: App,
	file: TFile,
	transform: (content: string) => string,
): Promise<void> {
	await app.vault.process(file, transform);
}

/**
 * 原子地 upsert 一个列表型属性（如 `UpTask`/`Project`/`Subject`/`Plan`）。
 * 内部走 `vault.process`，读到的永远是最新内容，不会被其它写入插空覆盖。
 * 返回内容是否真的发生了变化。
 */
export async function rewriteTaskListProperty(
	app: App,
	file: TFile,
	propertyName: string,
	value: string,
): Promise<boolean> {
	let changed = false;
	await app.vault.process(file, (content) => {
		const next = upsertListProperty(content, propertyName, value);
		changed = next !== content;
		return next;
	});
	return changed;
}

/**
 * 原子地移除一个列表型属性。同样走 `vault.process`，避免读改写之间的竞态窗口。
 * 返回内容是否真的发生了变化。
 */
export async function removeTaskListProperty(
	app: App,
	file: TFile,
	propertyName: string,
): Promise<boolean> {
	let changed = false;
	await app.vault.process(file, (content) => {
		const next = removeListProperty(content, propertyName);
		changed = next !== content;
		return next;
	});
	return changed;
}

export function upsertScalarProperty(
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

export function removeScalarProperty(
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
