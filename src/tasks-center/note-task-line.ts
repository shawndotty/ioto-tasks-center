/**
 * 编辑原语（[[Plan-20261003-073911]] §5.1）。
 *
 * 全部是纯字符串函数：`line → line | null`，`null` 表示「不是任务行 / 不匹配」。
 * 与解析层共用同一套缩进口径（`indentLevelOf`），保证「Tab 一次」与视图里
 * 看到的层级不会漂。
 */

import type { ControlToken } from './note-controls';
import { splitDisplayText } from './note-controls';

/** 任务行正则（checklist 匹配与编辑层共用）。 */
export const TASK_LINE_PATTERN = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\](.*)$/;

/** 一行任务拆成可无损重组的各段。 */
export interface TaskLineParts {
	/** 前导空白，原样保留（Tab 也原样保留） */
	indent: string;
	/** 列表符号（含其后空白）：`- ` / `* ` / `+ ` / `1. ` */
	listMarker: string;
	/** 勾选态 */
	checked: ' ' | 'x' | 'X';
	/** `]` 之后的空白 */
	gap: string;
	/** 展示正文（已剥离 controls），两侧 trim */
	body: string;
	/** 本行控制项（行中 / 行尾一律收集） */
	controls: ControlToken[];
	/** 原始 core（未剥离），仅用于「未改动正文逐字节还原」 */
	source: string;
	/** 原始 core 的展示正文；`body === sourceText` 即判定「未改动」 */
	sourceText: string;
	/** 行尾空白（含 CRLF 的 `\r`），原样保留 */
	trail: string;
}

const TASK_LINE_PARTS_PATTERN =
	/^([ \t]*)((?:[-*+]|\d+\.)[ \t]+)\[([ xX])\]([ \t]*)([\s\S]*)$/;

/** 缩进宽度换算：每 2 空格或 1 个 Tab 记 1 级（与解析层一致）。 */
export function indentLevelOf(indent: string): number {
	let width = 0;
	for (const char of indent) {
		width += char === '\t' ? 2 : 1;
	}

	return Math.floor(width / 2);
}

/** 一行的缩进层级（0 基）：每 2 空格或 1 个 Tab 记 1 级。 */
export function computeIndentLevel(line: string): number {
	const leadingWhitespace = line.match(/^[ \t]*/)?.[0] ?? '';
	return indentLevelOf(leadingWhitespace);
}

function indentStringForLevel(level: number): string {
	return '  '.repeat(Math.max(0, level));
}

/** 把一行任务拆成可无损重组的各段；不是任务行时返回 `null`。 */
export function splitTaskLine(line: string): TaskLineParts | null {
	const match = line.match(TASK_LINE_PARTS_PATTERN);
	if (!match) {
		return null;
	}

	const rest = match[5] ?? '';
	const trailMatch = rest.match(/[ \t\r]*$/);
	const trail = trailMatch ? trailMatch[0] : '';
	const core = rest.slice(0, rest.length - trail.length);
	const { text, controls } = splitDisplayText(core);

	return {
		indent: match[1] ?? '',
		listMarker: match[2] ?? '',
		checked: (match[3] ?? ' ') as ' ' | 'x' | 'X',
		gap: match[4] ?? '',
		body: text,
		controls,
		source: core,
		sourceText: text,
		trail,
	};
}

/**
 * 任务行的续行缩进：让续行正文与任务正文**左对齐**（`- [ ] 甲` → 6 空格）。
 *
 * 复用 `splitTaskLine`；非任务行返回 `null`。`indent` 原样保留（含 Tab），只在
 * 「列表符号 + `[x]` + gap」上补空格，避免嵌套层级漂移。用于「新建续写区」时从
 * **任务行**推导缩进——`commonIndentPrefix([])` 恒为 `''`，不能沿用空块前缀。
 */
export function continuationIndentForTaskLine(line: string): string | null {
	const parts = splitTaskLine(line);
	if (!parts) {
		return null;
	}
	// listMarker 已含其后空白；`[x]` 恒 3 字符（'[' + 勾选位 + ']'）；gap 是 `]` 之后的空白。
	return (
		parts.indent + ' '.repeat(parts.listMarker.length + 3 + parts.gap.length)
	);
}

/** 把编辑器正文按给定缩进展开成续行物理行（空行保持空行）。 */
export function indentContinuationLines(
	nextText: string,
	indent: string,
): string[] {
	return nextText
		.split('\n')
		.map((line) => (line.trim().length === 0 ? '' : indent + line));
}

/**
 * 面板写回后，内联编辑器应持有的正文：剥离本行**所有**控制项
 * （`depends：` / `[model::]` / `#ioto/*`）；非任务行返回 `null`。
 * 修复 [[Plan-20261003-141212]]：写回成功后 re-seed 编辑器，避免随后的 blur
 * 提交用旧正文重建整行而抹掉面板所选控制项。
 */
export function taskBodyForEditor(line: string): string | null {
	return splitTaskLine(line)?.body ?? null;
}

/**
 * `splitTaskLine` 的逆运算，双通道：
 * - `body === sourceText`（正文未改动）→ 逐字节还原 `source`；
 * - 否则规范化：正文 + 控制项按原序拼到行尾（Johnny 已确认「输入即归位」）。
 */
export function composeTaskLine(parts: TaskLineParts): string {
	let core: string;
	if (parts.body === parts.sourceText) {
		core = parts.source;
	} else {
		const controlText = parts.controls.map((control) => control.raw).join(' ');
		core = `${parts.body.trim()}${
			controlText.length > 0 ? ` ${controlText}` : ''
		}`;
	}
	return `${parts.indent}${parts.listMarker}[${parts.checked}]${parts.gap}${core}${parts.trail}`;
}

/**
 * 3b 提交：只换正文，原样保留 indent / listMarker / checked / gap / trail，
 * 并把原行控制项拼回正文之后（正文未改动时逐字节还原）。正文含换行时拒绝。
 */
export function replaceTaskBody(line: string, nextBody: string): string | null {
	if (nextBody.includes('\n')) {
		return null;
	}

	const parts = splitTaskLine(line);
	if (!parts) {
		return null;
	}

	return composeTaskLine({ ...parts, body: nextBody.trim() });
}

/** 标题行内换行的唯一字面量（Q3：不带自闭合斜杠）。 */
export const SOFT_BREAK = '<br>';

/**
 * 在 `[from, to)` 处用 `<br>` 替换选区，返回新文本与新光标位。
 * 纯函数：零 obsidian / 零 DOM，`tests/` 直接 jiti 导入断言。
 *
 * 写回仍是**单行**（不含 `\n`），因此 `replaceTaskBody` 的换行守卫不会拦它。
 */
export function insertSoftBreak(
	value: string,
	from: number,
	to: number,
): { value: string; cursor: number } {
	const start = Math.min(Math.max(from, 0), value.length);
	const end = Math.min(Math.max(to, start), value.length);
	return {
		value: value.slice(0, start) + SOFT_BREAK + value.slice(end),
		cursor: start + SOFT_BREAK.length,
	};
}

/** 3a 勾选：`' '` ↔ `'x'`，`'X'` 视作已勾选 → 切到 `' '`，其余字节一律不动。 */
export function toggleTaskMarker(line: string): string | null {
	const parts = splitTaskLine(line);
	if (!parts) {
		return null;
	}

	const checked: ' ' | 'x' = parts.checked.toLowerCase() === 'x' ? ' ' : 'x';
	return composeTaskLine({ ...parts, checked });
}

/**
 * 3c-3 缩进：`delta = ±1` 级，clamp 到 `[0, maxLevel]`。
 * 输出统一为「每级 2 空格」（Tab 会被规整，属已知取舍）；缩进一律**重算**
 * 而不是在原字符串上加/减，避免混用导致层级错乱。
 */
export function setTaskIndent(
	line: string,
	delta: number,
	maxLevel = 8,
): string | null {
	const parts = splitTaskLine(line);
	if (!parts) {
		return null;
	}

	const upper = Math.max(0, maxLevel);
	const nextLevel = Math.min(
		Math.max(indentLevelOf(parts.indent) + delta, 0),
		upper,
	);
	return composeTaskLine({
		...parts,
		indent: indentStringForLevel(nextLevel),
	});
}

/**
 * 3c-1 新建同级：给定参考行，产出「同 indent / 同列表符号 / 同 trail」的新行；
 * `text` 为空则返回纯骨架；不继承任何控制项（`controls` 清空，`source` 与
 * `sourceText` 显式对齐 `body`，保证走「逐字节还原」通道）。
 */
export function buildSiblingTaskLine(
	referenceLine: string,
	text: string,
	marker: ' ' | 'x' = ' ',
): string | null {
	const parts = splitTaskLine(referenceLine);
	if (!parts) {
		return null;
	}

	const body = text.trim();
	return composeTaskLine({
		...parts,
		checked: marker,
		body,
		controls: [],
		source: body,
		sourceText: body,
	});
}

/**
 * 「添加任务」专用：拼出 `# <title>` 标题行（一号标题）。
 *
 * 语言包里只存**裸标题**（`任务` / `Tasks` / `任務`），因为 `findSectionByTitle`
 * 按去 `#` 的标题文本精确匹配；写进笔记时必须补 `# `，否则建出的是普通段落，
 * 既不会被识别成 Section，也定位不到刚建的那一段。
 */
export function buildTasksSectionHeading(title: string): string {
	return `# ${title.trim()}`;
}

/**
 * 「添加任务」专用：在参照行基础上**强制 0 级顶层**（`indent: ''`），
 * 保留列表符号与行尾空白，不继承控制项。参照行不是任务行（如新建 Section
 * 时的 `'- '`）时退回默认 `- ` 列表符号，保证仍能产出合法空任务行。
 */
export function buildTopLevelTaskLine(
	referenceLine: string,
	text = '',
	marker: ' ' | 'x' = ' ',
): string {
	const parts = splitTaskLine(referenceLine);
	const base: TaskLineParts =
		parts ??
		{
			indent: '',
			listMarker: '- ',
			checked: ' ',
			gap: ' ',
			body: '',
			controls: [],
			source: '',
			sourceText: '',
			trail: '',
		};
	const body = text.trim();
	return composeTaskLine({
		...base,
		indent: '',
		checked: marker,
		body,
		controls: [],
		source: body,
		sourceText: body,
	});
}
