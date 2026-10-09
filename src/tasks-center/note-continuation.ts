/**
 * 卡片续行（CommonMark lazy continuation）。
 *
 * Markdown View 里在任务项下面 Shift+Enter 敲出来的正文，CommonMark 视作该
 * list item 的一部分 —— 缩进续行与「不缩进的懒续行」都算。渲染层必须把它并回
 * 卡片，而不是当成章节级 markdown 块（否则会渲染成 `<ul>` 之外的孤儿块）。
 *
 * 复用 `note-task-line` 的任务行拆分与缩进口径，零 DOM / 零 obsidian 依赖。
 */

import type { NoteChecklistItem } from './note-checklist';
import {
	computeIndentLevel,
	indentLevelOf,
	splitTaskLine,
} from './note-task-line';

/**
 * 非列表的块级结构起始：遇到即**不再是**续行（CommonMark 里这些会打断段落 /
 * 结束 list item）。
 */
const BLOCK_START_PATTERNS: RegExp[] = [
	/^#{1,6}(?:\s|$)/, // ATX 标题
	/^(?:`{3,}|~{3,})/, // 代码围栏
	/^>/, // 引用
];

/**
 * 列表标记（无序 / 有序）。是否算续行由「相对父任务行的缩进」决定：比父任务行
 * 更深才算续行，否则维持「章节级列表」语义（见 `isTaskContinuationLine`）。
 */
const LIST_MARKER_PATTERN = /^(?:[-*+]|\d+[.)])(?:\s|$)/;

/** 分隔线（`---` / `***` / `___`，允许中间夹空白）。 */
const THEMATIC_BREAK_PATTERN = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

/**
 * 该行能否作为上一张任务卡的**续行**。
 *
 * 口径：非空 + 不是块级结构起始（标题 / 围栏 / 引用 / 分隔线）。空行返回
 * `false` —— CommonMark 里「空行 + 非缩进内容」会结束 list item，因此空行之后
 * 的内容属于 Section 而非某张卡。
 *
 * 列表行（无序 / 有序）特殊处理：**比父任务行更深**才算续行（缩进列表落回卡片
 * 续写区，渲染成正常列表）；与父同级 / 更浅则维持「章节级列表」语义。
 * `parentIndentLevel` 缺省为 `+Infinity`，此时任何列表行都不算续行，与旧行为
 * 逐字一致（老调用方无需改动）。
 *
 * ⚠️ 任务行（`- [ ]` / 嵌套子任务）永远不算续行：嵌套由行号 / 层级语义处理；
 * 否则父卡会把缩进的**子任务**吞进续写区（部分调用点没有 `itemLines` 排除）。
 */
export function isTaskContinuationLine(
	line: string,
	parentIndentLevel = Number.POSITIVE_INFINITY,
): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return false;
	}
	if (THEMATIC_BREAK_PATTERN.test(trimmed)) {
		return false;
	}

	const trimmedStart = line.trimStart();
	if (LIST_MARKER_PATTERN.test(trimmedStart)) {
		// ① 任务行（含嵌套子任务）不算续行，交回行号 / 层级语义处理。
		if (splitTaskLine(line) !== null) {
			return false;
		}
		// ② 普通列表：比父任务行更深才算续行，否则维持章节级列表语义。
		return computeIndentLevel(line) > parentIndentLevel;
	}

	return !BLOCK_START_PATTERNS.some((pattern) => pattern.test(trimmedStart));
}

/**
 * 父任务行的缩进层级，供续行判定比较。
 * 非任务行 / 空行 → `+Infinity`（任何列表行都不算续行，保持旧行为兜底）。
 *
 * 缩进口径复用解析层 `indentLevelOf`（2 空格 / 1 Tab = 1 级），与
 * `NoteChecklistItem.indentLevel` 一致。
 */
export function parentIndentLevelOfTaskLine(line: string): number {
	const parts = splitTaskLine(line);
	return parts ? indentLevelOf(parts.indent) : Number.POSITIVE_INFINITY;
}

/**
 * 为一批卡片收集各自的续行行号（0 基、升序、连续）。
 *
 * 每张卡从其下一行开始向下吃：遇到另一条 checklist 行、空行、或块级结构即停。
 * 比任务行更深的缩进列表算续行（落回卡片续写区），顶格 / 同级列表仍算章节级。
 * 返回「卡片行号 → 续行行号数组」；无续行的卡不出现在结果里。
 *
 * @param limitLine 可解析的最后一行（0 基，含）——通常是所属 Section 的 `endLine`。
 */
export function collectTaskContinuations(
	content: string,
	items: NoteChecklistItem[],
	limitLine: number,
): Map<number, number[]> {
	const lines = content.split(/\r?\n/);
	const itemLines = new Set(items.map((item) => item.line));
	const result = new Map<number, number[]>();

	for (const item of items) {
		const continuation: number[] = [];
		for (let index = item.line + 1; index <= limitLine; index += 1) {
			if (itemLines.has(index)) {
				break;
			}
			if (!isTaskContinuationLine(lines[index] ?? '', item.indentLevel)) {
				break;
			}
			continuation.push(index);
		}

		if (continuation.length > 0) {
			result.set(item.line, continuation);
		}
	}

	return result;
}

/**
 * 续行去缩进时的 Tab 列宽（CommonMark 口径：Tab 推进到下一个 4 的倍数）。
 * 与层级口径 `indentLevelOf`（2 空格 / 1 Tab = 1 级）用途不同，勿混用。
 */
const CONTINUATION_TAB_WIDTH = 4;

/** 一行文本的前导空白（空格 / Tab）。 */
function leadingWhitespaceOf(line: string): string {
	return line.match(/^[ \t]*/)?.[0] ?? '';
}

/** 前导空白的可视列宽：Tab 推进到下一个 4 的倍数。 */
function leadingColumnWidth(whitespace: string): number {
	let width = 0;
	for (const char of whitespace) {
		width +=
			char === '\t'
				? CONTINUATION_TAB_WIDTH - (width % CONTINUATION_TAB_WIDTH)
				: 1;
	}
	return width;
}

/**
 * 从一行前导空白里按**列**剥掉 `columns` 列。
 * 返回被剥掉的原文字符串，以及剥完后仍残留的列数（跨列的 Tab 拆成空格余量）。
 */
function stripColumns(
	whitespace: string,
	columns: number,
): { removed: string; residual: number } {
	let position = 0;
	let cursor = 0;
	while (cursor < whitespace.length && position < columns) {
		const char = whitespace[cursor];
		position +=
			char === '\t'
				? CONTINUATION_TAB_WIDTH - (position % CONTINUATION_TAB_WIDTH)
				: 1;
		cursor += 1;
	}
	return {
		removed: whitespace.slice(0, cursor),
		residual: Math.max(0, leadingColumnWidth(whitespace) - columns),
	};
}

/**
 * 卡片续行渲染前的「列宽感知去缩进」。
 *
 * 与按字符求公共前缀不同：按**可视列宽**求公共缩进，于是「空格对齐的段落」与
 * 「Tab 缩进的列表」混在一张卡里时也能整体 dedent（按字符求首字符不同 → 公共
 * 前缀 = '' → 整块不 dedent → 段落与列表都被判成缩进代码块）。
 *
 * - `minColumns` = 所有非空行前导空白列宽的**最小值**；为 0（无公共缩进）时原样返回；
 * - 每行按列剥离 `minColumns` 列；跨列的 Tab 拆成空格余量（残余统一以空格表示）；
 * - **非列表行**残余 ≥4 列会被独立渲染判成缩进代码块 → 夹到 0；**列表行**保留
 *   残余，维持嵌套层级；
 * - `removed[i]` = 第 i 行实际被剥掉的前导空白，供写回按行还原（见
 *   `commitTaskContinuation`）。
 *
 * 极端取舍：「半 Tab 跨越切点」的混合缩进无法逐字节还原，此时只丢空白形态、
 * 不丢正文内容。
 */
export function dedentContinuationLines(inputLines: string[]): {
	text: string;
	removed: string[];
} {
	const removed = inputLines.map(() => '');
	const nonEmpty = inputLines.filter((line) => line.trim().length > 0);
	if (nonEmpty.length === 0) {
		return { text: inputLines.join('\n'), removed };
	}

	const minColumns = Math.min(
		...nonEmpty.map((line) => leadingColumnWidth(leadingWhitespaceOf(line))),
	);
	if (minColumns === 0) {
		// 无公共缩进：原样返回（避免把 Tab 规整成空格）
		return { text: inputLines.join('\n'), removed };
	}

	const text = inputLines
		.map((line, index) => {
			if (line.trim().length === 0) {
				return line;
			}
			const whitespace = leadingWhitespaceOf(line);
			const rest = line.slice(whitespace.length);
			const { removed: stripped, residual } = stripColumns(
				whitespace,
				minColumns,
			);
			const isList = LIST_MARKER_PATTERN.test(line.trimStart());
			const keep =
				isList || residual < CONTINUATION_TAB_WIDTH ? residual : 0;
			// keep = 0 且仍有残余（非列表行被夹平）时整段前导空白都算被剥掉，
			// 这样写回按 removed 补回即可无损还原。
			removed[index] = residual > keep ? whitespace : stripped;
			return ' '.repeat(keep) + rest;
		})
		.join('\n');

	return { text, removed };
}

/**
 * 抹掉一段多行文本的**公共前导缩进**（dedent），返回处理后的文本。
 *
 * 用于卡片续行：任务项下 `Shift+Enter` 敲出来的正文带着列表自动缩进，而渲染层是
 * **独立**渲染这几行的（没有外层 `<ul>` 语境），行首 ≥4 空格会被 Markdown 判成
 * 缩进代码块（`<pre><code>`，格式全失效还多一个复制按钮）。剥掉公共缩进即可还原。
 *
 * 是 `dedentContinuationLines` 的薄封装（只取 `text`）；编辑回写需要按行还原时
 * 请直接用 `dedentContinuationLines`。
 */
export function dedentLines(text: string): string {
	return dedentContinuationLines(text.split(/\r?\n/)).text;
}

/**
 * 一组文本行的**公共前导空白**（只看非空行；无公共前缀返回 `''`）。
 *
 * 续行写回（`commitTaskContinuation`）在「行数变化、无法按行还原」时用它兜底
 * 补回缩进——编辑器持有的是 dedent 后文本，提交时按原块公共前缀补回。
 * 常规（行数不变）路径优先用 `dedentContinuationLines` 的 `removed` 逐行还原。
 */
export function commonIndentPrefix(lines: string[]): string {
	const indents = lines
		.filter((line) => line.trim().length > 0)
		.map((line) => line.match(/^[ \t]*/)?.[0] ?? '');

	if (indents.length === 0) {
		return '';
	}

	let common = indents[0] ?? '';
	for (const indent of indents) {
		let length = 0;
		while (
			length < common.length &&
			length < indent.length &&
			common[length] === indent[length]
		) {
			length += 1;
		}
		common = common.slice(0, length);
		if (common.length === 0) {
			break;
		}
	}

	return common;
}
