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

/**
 * 读取一个标量属性（frontmatter 顶层键）的原始值；缺失返回 `null`。
 * 只认文件开头的一段 frontmatter，与 `upsertScalarProperty` 同一匹配口径。
 */
export function readScalarProperty(
	content: string,
	propertyName: string,
): string | null {
	return readRawScalarProperty(content, propertyName)
		?.replace(/^["']|["']$/g, '') ?? null;
}

/**
 * 读取标量属性的**原始**字面量（保留 YAML 引号）；缺失返回 `null`。
 * 需要区分「裸值」与「带引号值」的调用方（如主任务区标题）走这个入口。
 */
export function readRawScalarProperty(
	content: string,
	propertyName: string,
): string | null {
	const frontmatterMatch = content.match(
		/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
	);
	if (!frontmatterMatch) {
		return null;
	}

	const propertyPattern = new RegExp(
		`^${escapeRegExp(propertyName)}\\s*:\\s*(.*)$`,
	);
	for (const line of (frontmatterMatch[1] ?? '').split(/\r?\n/)) {
		const match = line.match(propertyPattern);
		if (match) {
			return (match[1] ?? '').trim();
		}
	}

	return null;
}

/* ------------------------------------------------------------------ *
 * 带引号的标量读写（[[Plan-20261024-072014]] §3 S1）
 *
 * 标题里可能出现 `: ` / `#` / `"` / `[`，裸拼会写坏 YAML。这里只提供
 * 「总是加双引号」的专用入口，不改既有 `upsertScalarProperty` 的裸值口径。
 * ------------------------------------------------------------------ */

/** YAML 双引号标量：总是包引号，转义 `\` 与 `"`。 */
export function quoteYamlString(value: string): string {
	return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** 剥引号 + 反转义；裸值原样返回（兼容手写的无引号属性）。 */
export function unquoteYamlString(raw: string): string {
	const value = raw.trim();
	if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
		return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
	}
	if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1).replace(/''/g, "'");
	}
	return value;
}

/** 读带引号（或裸值）标量，返回剥引号后的文本；缺失返回 `null`。 */
export function readQuotedScalarProperty(
	content: string,
	propertyName: string,
): string | null {
	const raw = readRawScalarProperty(content, propertyName);
	return raw === null ? null : unquoteYamlString(raw);
}

/** 写入带引号的标量属性（纯字符串版，便于单测）。 */
export function upsertQuotedScalarProperty(
	content: string,
	propertyName: string,
	value: string,
): string {
	return upsertScalarProperty(content, propertyName, quoteYamlString(value));
}

/**
 * 原子地写入一个带引号的标量属性，返回写盘后的完整内容
 * （调用方据此算 frontmatter 行数 Δ，做 `shiftTrackedLines`）。
 */
export async function writeQuotedScalarProperty(
	app: App,
	file: TFile,
	propertyName: string,
	value: string,
): Promise<string> {
	let next = '';
	await app.vault.process(file, (content) => {
		next = upsertQuotedScalarProperty(content, propertyName, value);
		return next;
	});
	return next;
}

/** 原子地删除一个标量属性，返回写盘后的完整内容。 */
export async function removeScalarPropertyInFile(
	app: App,
	file: TFile,
	propertyName: string,
): Promise<string> {
	let next = '';
	await app.vault.process(file, (content) => {
		next = removeScalarProperty(content, propertyName);
		return next;
	});
	return next;
}

/**
 * 读取一个布尔属性：显式 `true`（大小写不敏感）为真，其余（含缺失）为假。
 * 缺省即「关」，与 [[Plan-20261004-110845]] §二.1 的口径一致。
 */
export function readBooleanProperty(
	content: string,
	propertyName: string,
): boolean {
	return readScalarProperty(content, propertyName)?.toLowerCase() === 'true';
}

/**
 * 原子地写入（upsert）一组标量属性，返回写盘后的完整内容。
 *
 * 走 `vault.process`：读到的永远是最新内容，多个键一次进入同一事务，
 * 避免两次写之间被其它写入插空。调用方据此计算 frontmatter 行数变化（Δ）。
 */
export async function writeScalarProperties(
	app: App,
	file: TFile,
	properties: Record<string, string>,
): Promise<string> {
	let next = '';
	await app.vault.process(file, (content) => {
		let result = content;
		for (const [name, value] of Object.entries(properties)) {
			result = upsertScalarProperty(result, name, value);
		}
		next = result;
		return result;
	});
	return next;
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
