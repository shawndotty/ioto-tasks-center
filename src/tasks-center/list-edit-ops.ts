/**
 * 模板编辑器（批量 / 条目）的列表编辑原语（[[Plan-20261025-061424]] §3.1）。
 *
 * 全部是纯字符串函数：`(text, start, end) → TextEdit | null`，零 DOM、零 obsidian，
 * 供 `tests/list-edit-ops.test.mjs` 用 jiti 直测。DOM 写入口见 `ui/list-edit-textarea.ts`。
 *
 * 缩进单位只从 `note-task-line.ts` 取（`INDENT_UNIT`），不在这里再写字面量。
 */

import { INDENT_UNIT } from './note-task-line';

/** 受支持的列表标记：批量模板的 `- ` 与条目模板的 `- [ ] `。 */
export type ListMarker = '- ' | '- [ ] ';

export interface TextEdit {
	text: string;
	start: number;
	end: number;
}

interface LineInfo {
	content: string;
	eol: string;
	start: number;
}

const BATCH_ITEM_PATTERN = /^([ \t]*)- ([\s\S]*)$/;
const ENTRY_ITEM_PATTERN = /^([ \t]*)- \[[ xX]\]([ \t]*)([\s\S]*)$/;

/** 按 `\n` / `\r\n` 切行并保留每行的行尾风格与起始偏移（末行 `eol` 为 `''`）。 */
function collectLines(text: string): LineInfo[] {
	const lines: LineInfo[] = [];
	let start = 0;

	for (let i = 0; i < text.length; i += 1) {
		if (text[i] !== '\n') {
			continue;
		}
		const crlf = i > start && text[i - 1] === '\r';
		const contentEnd = crlf ? i - 1 : i;
		lines.push({
			content: text.slice(start, contentEnd),
			eol: crlf ? '\r\n' : '\n',
			start,
		});
		start = i + 1;
	}

	lines.push({ content: text.slice(start), eol: '', start });
	return lines;
}

function assemble(lines: LineInfo[]): string {
	return lines.map((line) => line.content + line.eol).join('');
}

/** 光标位置所在行（位置落在行首时归下一行，落在 `text.length` 时归最后一行）。 */
function lineIndexAt(lines: LineInfo[], position: number): number {
	let index = 0;
	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i];
		if (!line) {
			break;
		}
		if (line.start <= position) {
			index = i;
		} else {
			break;
		}
	}
	return index;
}

function clampPosition(text: string, position: number): number {
	if (!Number.isFinite(position)) {
		return 0;
	}
	return Math.min(Math.max(position, 0), text.length);
}

function detectEol(lines: LineInfo[]): string {
	return lines.some((line) => line.eol === '\r\n') ? '\r\n' : '\n';
}

/** 去掉一级行首缩进：优先 1 个 `\t`，其次 `INDENT_UNIT` 个空格（不足则全去）。 */
function removeOneIndentLevel(indent: string): string {
	if (indent.endsWith('\t')) {
		return indent.slice(0, -1);
	}
	const spaces = indent.match(/ *$/)?.[0].length ?? 0;
	if (spaces === 0) {
		return indent;
	}
	return indent.slice(0, indent.length - Math.min(spaces, INDENT_UNIT));
}

/** 行首实际能被 Shift+Tab 去掉的字符数（0 = 已 0 级）。 */
function measureOneIndentLevel(content: string): number {
	if (content.startsWith('\t')) {
		return 1;
	}
	const spaces = content.match(/^ */)?.[0].length ?? 0;
	return Math.min(spaces, INDENT_UNIT);
}

interface AffectedRange {
	first: number;
	last: number;
}

/**
 * 选区覆盖的行区间。选区末端正好落在某行行首时把该行排除，
 * 避免「选中到下一行行首」时多缩进一行。
 */
function affectedRange(
	lines: LineInfo[],
	from: number,
	to: number,
): AffectedRange {
	const first = lineIndexAt(lines, from);
	if (from === to) {
		return { first, last: first };
	}
	let last = lineIndexAt(lines, to);
	const lastLine = lines[last];
	if (last > first && lastLine && lastLine.start === to) {
		last -= 1;
	}
	return { first, last };
}

/**
 * 回车：返回 `null` = 不拦截（走默认换行）。
 *
 * 仅在「光标是折叠态 + 落在列表行行尾 + 该行是受支持标记」时接管：
 * 正文非空 → 续行（缩进原样复制 + 同标记）；正文空白 → 空项退回（有缩进去一级，
 * 0 级删标记变空行）。
 */
export function applyListEnter(
	text: string,
	start: number,
	end: number,
	marker: ListMarker,
): TextEdit | null {
	const from = clampPosition(text, start);
	const to = clampPosition(text, end);
	if (from !== to) {
		return null;
	}

	const lines = collectLines(text);
	const index = lineIndexAt(lines, from);
	const line = lines[index];
	if (!line) {
		return null;
	}
	if (from - line.start !== line.content.length) {
		return null;
	}

	const match = line.content.match(
		marker === '- [ ] ' ? ENTRY_ITEM_PATTERN : BATCH_ITEM_PATTERN,
	);
	if (!match) {
		return null;
	}

	const indent = match[1] ?? '';
	const body = marker === '- [ ] ' ? (match[3] ?? '') : (match[2] ?? '');

	if (body.trim().length === 0) {
		if (indent.length === 0) {
			line.content = '';
			return { text: assemble(lines), start: line.start, end: line.start };
		}
		line.content = `${removeOneIndentLevel(indent)}${marker}`;
		const caret = line.start + line.content.length;
		return { text: assemble(lines), start: caret, end: caret };
	}

	line.content = `${line.content}${line.eol || detectEol(lines)}${indent}${marker}`;
	const caret = line.start + line.content.length;
	return { text: assemble(lines), start: caret, end: caret };
}

/** Tab：选区覆盖的每个非空行行首 +`INDENT_UNIT` 空格。 */
export function indentListItemLines(
	text: string,
	start: number,
	end: number,
): TextEdit {
	const from = clampPosition(text, start);
	const to = Math.max(clampPosition(text, end), from);
	const lines = collectLines(text);
	const { first, last } = affectedRange(lines, from, to);
	const pad = ' '.repeat(INDENT_UNIT);
	let totalDelta = 0;

	for (let i = first; i <= last; i += 1) {
		const line = lines[i];
		if (!line || line.content.trim().length === 0) {
			continue;
		}
		line.content = pad + line.content;
		totalDelta += INDENT_UNIT;
	}

	if (from !== to) {
		return {
			text: assemble(lines),
			start: lines[first]?.start ?? from,
			end: to + totalDelta,
		};
	}

	const line = lines[first];
	if (!line) {
		return { text: assemble(lines), start: from, end: from };
	}
	const caret =
		line.content.trim().length === 0
			? from
			: Math.min(from + INDENT_UNIT, line.start + line.content.length);
	return { text: assemble(lines), start: caret, end: caret };
}

/** Shift+Tab：逐行去一级缩进（优先 2 空格，其次 1 个 `\t`）。 */
export function dedentListItemLines(
	text: string,
	start: number,
	end: number,
): TextEdit {
	const from = clampPosition(text, start);
	const to = Math.max(clampPosition(text, end), from);
	const lines = collectLines(text);
	const { first, last } = affectedRange(lines, from, to);
	let totalDelta = 0;
	let firstRemoved = 0;

	for (let i = first; i <= last; i += 1) {
		const line = lines[i];
		if (!line || line.content.trim().length === 0) {
			continue;
		}
		const removed = measureOneIndentLevel(line.content);
		if (removed === 0) {
			continue;
		}
		line.content = line.content.slice(removed);
		totalDelta -= removed;
		if (i === first) {
			firstRemoved = removed;
		}
	}

	if (from !== to) {
		return {
			text: assemble(lines),
			start: lines[first]?.start ?? from,
			end: to + totalDelta,
		};
	}

	const line = lines[first];
	if (!line) {
		return { text: assemble(lines), start: from, end: from };
	}
	const caret = Math.max(
		line.start,
		from - (line.content.trim().length === 0 ? 0 : firstRemoved),
	);
	return { text: assemble(lines), start: caret, end: caret };
}
