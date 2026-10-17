/**
 * 任务块拖拽移动的纯计算（[[Plan task-view-card-drag-reorder]] §三）。
 *
 * 零 DOM / 零 obsidian，输出可直接喂给 `commitBlockRange`（最小变化区间），
 * 并附带旧行号 → 新行号映射，供视图侧迁移选中行 / 折叠态。
 *
 * 语义（「成为落点的同级兄弟」模型）：
 * - 拖动单位 = 完整任务块（任务行 + 整块更深层子树 + 末节点续行），口径同
 *   `taskBlockRange`；
 * - 落到某任务卡之前 / 之后：整块插到该块（含其子树）正前 / 正后，并按目标卡
 *   的 indent **整块重缩进**（子树相对层级不变）——天然支持同章节重排、跨章节
 *   移动与跨层级挂载；
 * - 章节级落点（`section-start` / `section-end`）：空章节 / 折叠章节也能接收，
 *   无任务的章节按 0 级插在标题行之后；
 * - 成环（父块落进自身子树）与等价槽位 → `null`。
 *
 * 空行口径：只规范化「被移动块的删除缝」与「插入缝」三处连接点，段内字节不动。
 * 两侧均有非空锚点时：任一锚点是普通散文（非任务、非标题）→ 恰好 1 个空行
 * （防止散文被 list item 的 lazy continuation 吞掉）；任务 / 标题相邻 → 0 空行；
 * 任一锚点缺失（文件边缘）→ 保持原空行形态（含 EOF 空串）。
 */

import { parseChecklistItems } from './note-checklist';
import { parseSections } from './note-sections';
import {
	TASK_LINE_PATTERN,
	composeTaskLine,
	indentLevelOf,
	splitTaskLine,
} from './note-task-line';
import { taskBlockRange } from './note-task-swap';

export type TaskDropPosition = 'before' | 'after';

export type TaskDropTarget =
	| { kind: 'task'; line: number; position: TaskDropPosition }
	| { kind: 'section'; sectionStartLine: number; position: 'start' | 'end' };

export interface TaskMoveResult {
	/** 写回区间首行（0 基，含）。 */
	startLine: number;
	/** 写回区间末行（0 基，含）。 */
	endLine: number;
	/** 快照原区间各行（供 commitBlockRange 序列校验 / 全文搜索兜底）。 */
	originalLines: string[];
	/** 移动 + 规范化后的区间各行。 */
	nextLines: string[];
	/**
	 * 旧行号 → 新行号。未动行恒等；被规范化掉的空行为 `null`（调用方应把
	 * 落在其上的跟踪态清空）。
	 */
	mapLine(line: number | null): number | null;
	/** 被拖任务块新的首行（0 基），供选中态跟随。 */
	movedNewStartLine: number;
}

interface MoveToken {
	text: string;
	/** 该新行对应的旧文件行号；新增的分隔空行为 null。 */
	source: number | null;
}

interface Anchor {
	/** 插入缝：新块插在原文件该行之前；取值范围 [0, lines.length]。 */
	seam: number;
	/** 整块重缩进的目标层级。 */
	level: number;
}

const HEADING_LINE_PATTERN = /^\s*#{1,6}(?:\s|$)/;
/** 分隔线 / frontmatter 闭合行（`---` / `***` / `___`，口径同 note-continuation）。 */
const THEMATIC_BREAK_PATTERN = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

type LineKind = 'task' | 'heading' | 'prose' | 'blank';

function kindOf(line: string): LineKind {
	const normalized = line.replace(/\r+$/, ''); // CRLF：正则的 `.` 不吃 \r
	if (normalized.trim().length === 0) {
		return 'blank';
	}
	if (TASK_LINE_PATTERN.test(normalized)) {
		return 'task';
	}
	if (HEADING_LINE_PATTERN.test(normalized)) {
		return 'heading';
	}
	if (THEMATIC_BREAK_PATTERN.test(normalized.trim())) {
		// 块级结构（含 frontmatter 闭合 `---`）：与任务 / 标题相邻无需空行，
		// 否则移动正文首个任务会给 frontmatter 凭空塞空行。
		return 'heading';
	}
	return 'prose';
}

/**
 * 把一行的行首空白按列数平移（tab 折 2 列）。
 * `deltaCols > 0` 前补空格；`< 0` 时逐列吃掉行首空白，半路碰到 tab 则折成空格，
 * 保证正文一个字符都不丢。块内任何行的缩进都不浅于源任务行，dedent 到 0 也安全。
 */
function shiftLeadingColumns(line: string, deltaCols: number): string {
	if (deltaCols === 0) {
		return line;
	}
	const leadMatch = line.match(/^[ \t]*/);
	const lead = leadMatch?.[0] ?? '';
	if (deltaCols > 0) {
		return `${' '.repeat(deltaCols)}${line}`;
	}

	let remove = -deltaCols;
	let index = 0;
	while (remove > 0 && index < lead.length) {
		const width = lead[index] === '\t' ? 2 : 1;
		if (width <= remove) {
			remove -= width;
			index += 1;
		} else {
			// width === 2 && remove === 1：tab 被吃一半，折成 1 个空格。
			return (
				lead.slice(0, index) +
				' '.repeat(width - remove) +
				lead.slice(index + 1) +
				line.slice(lead.length)
			);
		}
	}
	return lead.slice(index) + line.slice(lead.length);
}

/**
 * 整块重缩进：任务行走 split/compose（tab 规整为 2 空格，沿用 `setTaskIndent`
 * 已知取舍）；其余行（续行 / 代码行等）平移行首空白列。
 * 行尾 `\r` 先拆后补，保证 CRLF 文件行尾形态不丢（任务行正则的 `.` 不吃 \r）。
 */
function reindentLine(line: string, deltaLevels: number): string {
	const hasCr = line.endsWith('\r');
	const core = hasCr ? line.slice(0, -1) : line;
	const parts = splitTaskLine(core);
	let result: string;
	if (parts) {
		const nextLevel = Math.max(
			0,
			indentLevelOf(parts.indent) + deltaLevels,
		);
		result = composeTaskLine({
			...parts,
			indent: '  '.repeat(nextLevel),
		});
	} else {
		result = shiftLeadingColumns(core, deltaLevels * 2);
	}
	return hasCr ? `${result}\r` : result;
}

/** 把落点目标解析成「原坐标插入缝 + 目标层级」；非法目标 → null。 */
function resolveAnchor(
	content: string,
	lines: readonly string[],
	items: ReturnType<typeof parseChecklistItems>,
	target: TaskDropTarget,
): Anchor | null {
	if (target.kind === 'task') {
		const index = items.findIndex((item) => item.line === target.line);
		const item = items[index];
		if (!item || index < 0) {
			return null;
		}
		const block = taskBlockRange(items, lines, index);
		if (target.position === 'before') {
			return { seam: block.start, level: item.indentLevel };
		}
		return { seam: block.end + 1, level: item.indentLevel };
	}

	const section = parseSections(content).find(
		(entry) => entry.startLine === target.sectionStartLine,
	);
	if (!section) {
		return null;
	}
	const bodyStartLine =
		section.level === 0 ? section.startLine : section.startLine + 1;
	const inSection = items.filter(
		(item) => item.line >= bodyStartLine && item.line <= section.endLine,
	);
	if (inSection.length === 0) {
		// 空章节（只有标题 / 纯散文）：0 级，插在标题行之后（引导区 = 块首）。
		return { seam: Math.min(bodyStartLine, lines.length), level: 0 };
	}
	// 章节的基准层级 = 章节内最浅缩进（通常为 0）；章节级落点只与该层级的
	// 「顶层任务」对齐，避免末尾恰好是深缩进子任务时把外来任务误挂成它的子级。
	const baseLevel = inSection.reduce(
		(min, item) => Math.min(min, item.indentLevel),
		inSection[0]?.indentLevel ?? 0,
	);
	const topLevel = inSection.filter(
		(item) => item.indentLevel === baseLevel,
	);
	const anchorItem =
		target.position === 'start' ? topLevel[0] : topLevel[topLevel.length - 1];
	if (!anchorItem) {
		return null;
	}
	const anchorIndex = items.findIndex((item) => item.line === anchorItem.line);
	if (target.position === 'start') {
		return { seam: anchorItem.line, level: baseLevel };
	}
	const block = taskBlockRange(items, lines, anchorIndex);
	return { seam: block.end + 1, level: baseLevel };
}

function toTokens(
	lines: readonly string[],
	start: number,
	end: number,
): MoveToken[] {
	const tokens: MoveToken[] = [];
	for (let line = start; line < end; line += 1) {
		tokens.push({ text: lines[line] ?? '', source: line });
	}
	return tokens;
}

/**
 * 规范化一处连接点周围的空行池（原地 splice，返回调整后新的连接点位置）。
 *
 * `boundary` = token 数组里「左段末 / 右段首」之间的位置。向左右各吃掉连续空行，
 * 与相邻连接点共用空池时（中间段全空）由调用方按从右到左的分组顺序天然合并。
 * 两侧都有非空锚点 → 按锚点类型决定保留 0 / 1 个空行；缺锚点（文件边缘）→
 * 原样保留。新增空行 source=null。
 */
function normalizeJunction(tokens: MoveToken[], boundary: number): number {
	let left = boundary - 1;
	while (left >= 0 && (tokens[left]?.text.trim().length ?? 0) === 0) {
		left -= 1;
	}
	let right = boundary;
	while (
		right < tokens.length &&
		(tokens[right]?.text.trim().length ?? 0) === 0
	) {
		right += 1;
	}

	const blankStart = left + 1;
	const blankEnd = right; // 半开
	const blankCount = blankEnd - blankStart;
	const leftAnchor = left >= 0 ? tokens[left] : null;
	const rightAnchor = right < tokens.length ? tokens[right] : null;

	if (!leftAnchor || !rightAnchor) {
		return boundary; // 文件边缘：保持原空行形态
	}

	const desired =
		kindOf(leftAnchor.text) === 'prose' ||
		kindOf(rightAnchor.text) === 'prose'
			? 1
			: 0;
	if (desired === blankCount) {
		return boundary;
	}

	// 优先保留前 min(desired, blankCount) 个原空行（行号映射最连续），
	// 不足部分补 source=null 的新空行；切勿把右锚点行当空行复用。
	const kept: MoveToken[] = [];
	for (let i = 0; i < desired; i += 1) {
		const original = i < blankCount ? tokens[blankStart + i] : null;
		kept.push(original ?? { text: '', source: null });
	}
	tokens.splice(blankStart, blankCount, ...kept);
	return boundary + (desired - blankCount);
}

export function moveTaskBlock(
	content: string,
	fromLine: number,
	target: TaskDropTarget,
): TaskMoveResult | null {
	const lines = content.split('\n');
	const items = parseChecklistItems(content, { includeEmpty: true });

	const fromIndex = items.findIndex((item) => item.line === fromLine);
	const fromItem = items[fromIndex];
	if (!fromItem || fromIndex < 0) {
		return null;
	}
	const sourceBlock = taskBlockRange(items, lines, fromIndex);
	if (sourceBlock.end < sourceBlock.start) {
		return null;
	}

	const anchor = resolveAnchor(content, lines, items, target);
	if (!anchor) {
		return null;
	}
	const { seam, level: targetLevel } = anchor;

	// 成环 / 等价槽位：插在源块内部（含块首前）或紧贴块尾之后 → 无意义。
	if (seam >= sourceBlock.start && seam <= sourceBlock.end + 1) {
		return null;
	}

	const deltaLevels = targetLevel - fromItem.indentLevel;
	const movedTokens: MoveToken[] = [];
	for (let line = sourceBlock.start; line <= sourceBlock.end; line += 1) {
		const text = lines[line] ?? '';
		movedTokens.push({
			text: reindentLine(text, deltaLevels),
			source: line,
		});
	}

	// 按最终顺序拼 4 段（空段保留，连接点位置靠累计长度计算）：
	// 向下移：前段 | 中间段 | 移动块 | 尾段
	// 向上移：前段 | 移动块 | 间隔段 | 尾段
	const movingDown = seam > sourceBlock.end + 1;
	const segments: MoveToken[][] = movingDown
		? [
				toTokens(lines, 0, sourceBlock.start),
				toTokens(lines, sourceBlock.end + 1, seam),
				movedTokens,
				toTokens(lines, seam, lines.length),
			]
		: [
				toTokens(lines, 0, seam),
				movedTokens,
				toTokens(lines, seam, sourceBlock.start),
				toTokens(lines, sourceBlock.end + 1, lines.length),
			];

	const tokens: MoveToken[] = [];
	const boundaries: number[] = [];
	for (const segment of segments) {
		boundaries.push(tokens.length);
		for (const token of segment) {
			tokens.push(token);
		}
	}
	boundaries.push(tokens.length);

	// 规范化三个内部连接点：从右向左处理，空段 / 全空中间段导致连接点重合时，
	// 右侧先吃掉共享空池，左侧再看到的就是合并后的单一连接点。
	for (let i = boundaries.length - 2; i >= 1; i -= 1) {
		const boundary = boundaries[i];
		if (boundary === undefined) {
			continue;
		}
		normalizeJunction(tokens, boundary);
	}

	// 逐字节相同时视为 no-op（防御：规范化恰好没改动任何行）。
	if (
		tokens.length === lines.length &&
		tokens.every((token, index) => token.source === index && token.text === lines[index])
	) {
		return null;
	}

	// 行号源映射。
	const oldToNew = new Map<number, number>();
	tokens.forEach((token, newLine) => {
		if (token.source !== null) {
			oldToNew.set(token.source, newLine);
		}
	});

	// 提交区间按**原文件坐标**取「删除缝 … 插入缝」的并集：
	// 向下移 [srcStart, seam-1]；向上移 [seam, srcEnd]。新增的分隔空行
	// （source=null）只会落在连接点上，必在该跨度对应的新坐标窗口之内。
	const lo = movingDown ? sourceBlock.start : seam;
	const hi = movingDown ? seam - 1 : sourceBlock.end;
	let newLo = -1;
	let newHi = -1;
	tokens.forEach((token, index) => {
		const inSpan = token.source === null || (token.source >= lo && token.source <= hi);
		if (inSpan) {
			if (newLo < 0) {
				newLo = index;
			}
			newHi = index;
		}
	});
	if (newLo < 0 || newHi < newLo) {
		return null;
	}

	const movedNewStartLine = oldToNew.get(sourceBlock.start);
	if (movedNewStartLine === undefined) {
		return null;
	}

	return {
		startLine: lo,
		endLine: hi,
		originalLines: lines.slice(lo, hi + 1),
		nextLines: tokens.slice(newLo, newHi + 1).map((token) => token.text),
		movedNewStartLine,
		mapLine(line) {
			if (line === null) {
				return null;
			}
			return oldToNew.has(line) ? (oldToNew.get(line) as number) : null;
		},
	};
}
