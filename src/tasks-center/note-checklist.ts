/**
 * 任务笔记的 Checklist 解析。
 *
 * 从正文按行扫描 Markdown 任务列表项（`- [ ]` / `- [x]`），产出带控制项的
 * `NoteChecklistItem`。复用 `note-sections` 的注释剥离与围栏判定、`note-task-line`
 * 的任务行正则与缩进口径、`note-controls` 的展示正文剥离，保持「只有一份实现」。
 */

import type { ControlToken } from './note-controls';
import { splitDisplayText } from './note-controls';
import type { NoteSection } from './note-sections';
import {
	FENCE_PATTERN,
	stripCommentContentFromLine,
} from './note-sections';
import { TASK_LINE_PATTERN, computeIndentLevel } from './note-task-line';

export interface NoteChecklistItem {
	/** 0 基行号 */
	line: number;
	/** ' ' | 'x' | 'X' */
	marker: string;
	/** checkbox 之后的原文（未 trim），供上层计算字符偏移 */
	rawText: string;
	/** 展示用正文：去前缀、两侧 trim、并剥离本行所有控制项 */
	text: string;
	/** 缩进层级（0 基）：每 2 空格或 1 个 Tab 记 1 级 */
	indentLevel: number;
	/** 本行控制项（执行元数据，卡片正文不显示，投影到动作区徽章） */
	controls: ControlToken[];
}

export interface ParseChecklistOptions {
	/**
	 * 是否把「正文为空」的 checklist 行也当作条目。
	 * 默认 `false`（与 v1 语义 / 任务状态统计一致）；IOTOTask 视图传 `true`，
	 * 这样 `Enter` 新建的空卡片才有 DOM 可落脚、光标能进得去。
	 */
	includeEmpty?: boolean;
}

export function parseChecklistItems(
	content: string,
	options?: ParseChecklistOptions,
): NoteChecklistItem[] {
	return collectChecklistItems(
		content,
		0,
		Number.POSITIVE_INFINITY,
		options?.includeEmpty ?? false,
	);
}

export function parseChecklistItemsInRange(
	content: string,
	startLine: number,
	endLine: number,
	options?: ParseChecklistOptions,
): NoteChecklistItem[] {
	if (endLine < startLine) {
		return [];
	}

	return collectChecklistItems(
		content,
		startLine,
		endLine,
		options?.includeEmpty ?? false,
	);
}

/* ------------------------------------------------------------------ *
 * 视图过滤谓词（[[Plan-20261004-110845]] 批次 B/C）
 *
 * 纯函数：只吃解析结果，零 obsidian 依赖，供 IOTOTask 视图与单测共用。
 * ------------------------------------------------------------------ */

/** 该条目是否已完成（`[x]` / `[X]`）。 */
export function isChecklistItemDone(item: NoteChecklistItem): boolean {
	return item.marker.toLowerCase() === 'x';
}

/**
 * 该 Section（Block）体内是否含 Markdown 任务列表。
 *
 * 与渲染层 `renderSectionBody` 同一口径取正文起点：引导区（level 0）从
 * `startLine` 起，标题块从标题行下一行起；`endLine` 已覆盖嵌套子标题内容，
 * 因此「任务只写在嵌套子标题里」的父块也会判为任务区块。
 * `includeEmpty: true`：空骨架任务行（`- [ ] `）同样算数。
 */
export function sectionHasChecklist(
	content: string,
	section: NoteSection,
): boolean {
	const bodyStartLine =
		section.level === 0 ? section.startLine : section.startLine + 1;
	return (
		parseChecklistItemsInRange(content, bodyStartLine, section.endLine, {
			includeEmpty: true,
		}).length > 0
	);
}

function collectChecklistItems(
	content: string,
	startLine: number,
	endLine: number,
	includeEmpty: boolean,
): NoteChecklistItem[] {
	const lines = content.split(/\r?\n/);
	const items: NoteChecklistItem[] = [];
	const from = Math.max(0, startLine);
	const to = Math.min(lines.length - 1, endLine);

	let inObsidianComment = false;
	let inHtmlComment = false;
	let fenceChar = '';
	let fenceLength = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const originalLine = lines[index] ?? '';
		const scanned = stripCommentContentFromLine(originalLine, {
			inObsidianComment,
			inHtmlComment,
		});
		inObsidianComment = scanned.nextInObsidianComment;
		inHtmlComment = scanned.nextInHtmlComment;
		const sanitized = scanned.sanitized;

		const fenceMatch = sanitized.match(FENCE_PATTERN);
		if (fenceMatch) {
			const marker = fenceMatch[1] ?? '';
			const char = marker[0] ?? '';
			if (!fenceChar) {
				fenceChar = char;
				fenceLength = marker.length;
			} else if (char === fenceChar && marker.length >= fenceLength) {
				fenceChar = '';
				fenceLength = 0;
			}
			continue;
		}

		if (fenceChar) {
			continue;
		}

		if (index < from || index > to) {
			continue;
		}

		if (sanitized.trim().length === 0) {
			continue;
		}

		const match = sanitized.match(TASK_LINE_PATTERN);
		if (!match) {
			continue;
		}

		const rawText = match[2] ?? '';
		if (!includeEmpty && rawText.trim().length === 0) {
			continue;
		}

		const { text, controls } = splitDisplayText(rawText);
		items.push({
			line: index,
			marker: match[1] ?? ' ',
			rawText,
			text,
			indentLevel: computeIndentLevel(originalLine),
			controls,
		});
	}

	return items;
}
