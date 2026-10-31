/**
 * 跨任务文件搬运任务块的纯计算（[[Research-20261031-204852]] §4.1 /
 * [[Plan-20261031-205655]] §四.1）。
 *
 * 零 DOM / 零 obsidian，`jiti` 可直导。输出两段互不重叠的 `BlockEdit`
 * （分属不同文件），写盘由视图层分两次 `commitBlockRange` 提交 —— **先插后删**
 * （[[Plan-20261031-205655]] §六.T6）：先删后插一旦插入失败 = 任务凭空消失；
 * 先插后删最坏是「源里多一条」，用户看得见、能手动收拾。
 *
 * 落点语义与同文件移动**完全一致**（复用 `note-task-move.ts` 的 `resolveAnchor`）：
 * 卡上 / 下缘 → 同级兄弟；header → 本节首条顶层任务；正文空白 → 本节末块之后；
 * 空节 → 标题下一行、0 级。缩进是**绝对值换算**（子树相对层级不变）。
 *
 * 空行口径沿用 `moveTaskBlock` 的 `kindOf` 规则：任一侧锚点是散文 → 1 个空行；
 * 任务 / 标题 → 0 行；缺锚点（文件首 / 尾）→ 保持原空行形态（含 EOF 空串、
 * 含 CRLF 的 `\r` 空行）。
 */

import { parseChecklistItems } from './note-checklist';
import {
	appendSectionHeading,
	findSectionByTitle,
} from './note-sections';
import {
	kindOf,
	normalizeMoveBlocks,
	reindentLine,
	resolveAnchor,
} from './note-task-move';
import { taskBlockRange } from './note-task-swap';
import type { LineKind, TaskDropTarget } from './note-task-move';

export interface BlockEdit {
	/** 原文件坐标 0 基起始行（含，供 `commitBlockRange` 定位）。 */
	startLine: number;
	/** 原文件坐标 0 基结束行（含）；`< startLine` = 纯插入（空窗口）。 */
	endLine: number;
	/** 原区间逐行快照（序列校验 / 全文兜底）。 */
	originalLines: string[];
	/** 替换后的整段（走 `commitBlockRange` 的 `nextLines` 通道）。 */
	nextLines: string[];
}

export interface CrossNoteMoveResult {
	/** 删除缝。 */
	source: BlockEdit;
	/** 插入缝。 */
	target: BlockEdit;
	/** 插入后任务块在目标文件的新首行（选中跟随用，0 基）。 */
	targetNewStartLine: number;
}

export interface ExtractedTaskBlock {
	/** 任务行 + 整棵子树 + 末节点续行。 */
	blockLines: string[];
	/** 任务行缩进层级（0 基）。 */
	level: number;
	/** 块首行（0 基，含）。 */
	startLine: number;
	/** 块末行（0 基，含）。 */
	endLine: number;
}

/** 组内单个块的最小信息（`ExtractedTaskBlock` 结构性满足，可直接传入）。 */
export interface TransferBlock {
	/** 任务行 + 整棵子树 + 末节点续行。 */
	blockLines: readonly string[];
	/** 任务行缩进层级（0 基）——按「目标层级 − 本块层级」逐块重缩进。 */
	level: number;
}

/** 两锚点之间应保留的空行数（口径同 `moveTaskBlock` 的 `normalizeJunction`）。 */
function junctionBlanks(left: LineKind, right: LineKind): number {
	return left === 'prose' || right === 'prose' ? 1 : 0;
}

/** 取前 `count` 条原空行文本（保 CRLF 的 `\r`），不足补 `''`。 */
function keepBlanks(originals: readonly string[], count: number): string[] {
	const kept: string[] = [];
	for (let i = 0; i < count; i += 1) {
		kept.push(originals[i] ?? '');
	}
	return kept;
}

/** 取出 fromLine 所在的完整任务块（任务行 + 整棵子树 + 末节点续行）。 */
export function extractTaskBlock(
	content: string,
	fromLine: number,
): ExtractedTaskBlock | null {
	const lines = content.split('\n');
	const items = parseChecklistItems(content, { includeEmpty: true });
	const index = items.findIndex((item) => item.line === fromLine);
	const item = items[index];
	if (!item || index < 0) {
		return null;
	}
	const range = taskBlockRange(items, lines, index);
	if (range.end < range.start) {
		return null;
	}
	return {
		blockLines: lines.slice(range.start, range.end + 1),
		level: item.indentLevel,
		startLine: range.start,
		endLine: range.end,
	};
}

/**
 * 取出 `fromLines` 命中的任务块集合（按 `startLine` 升序，父子同选只留外层）。
 *
 * 块归一统一走 `normalizeMoveBlocks`（与同文件整组拖动同一份口径），这里
 * 只把行号区间换成实际行文本。
 */
export function extractTaskBlocks(
	content: string,
	fromLines: readonly number[],
): ExtractedTaskBlock[] {
	const lines = content.split('\n');
	return normalizeMoveBlocks(content, fromLines).map((block) => ({
		blockLines: lines.slice(block.startLine, block.endLine + 1),
		level: block.level,
		startLine: block.startLine,
		endLine: block.endLine,
	}));
}

/**
 * 把整组任务块插到目标内容的落点；等价 / 非法 / 空组 → `null`。
 *
 * 与 `insertTaskBlock` 同构，只把「单块 moved」换成「组 `group` + 组内偏移
 * `starts`」。**块间不补空行（0 行）**：块是完整搬运单位，块与块之间的散文
 * 留在源文件、不随组走（[[Plan-20261101-070535]] §三-1）；只有「段首 / 段尾」
 * 这一处接缝才按 `kindOf` 规范化。
 */
export function insertTaskBlocks(
	content: string,
	blocks: readonly TransferBlock[],
	drop: TaskDropTarget,
): { edit: BlockEdit; newStartLines: number[] } | null {
	const valid = blocks.filter((block) => block.blockLines.length > 0);
	if (valid.length === 0) {
		return null;
	}
	const lines = content.split('\n');
	const items = parseChecklistItems(content, { includeEmpty: true });
	const anchor = resolveAnchor(content, lines, items, drop);
	if (!anchor) {
		return null;
	}
	const { seam, level } = anchor;
	if (seam < 0 || seam > lines.length) {
		return null;
	}

	// 组：每块各自重缩进，块间不加空行。
	const group: string[] = [];
	const starts: number[] = [];
	for (const block of valid) {
		starts.push(group.length);
		for (const line of block.blockLines) {
			group.push(reindentLine(line, level - block.level));
		}
	}
	if (group.length === 0) {
		return null;
	}

	// 左右锚点：seam 之前 / 之后最近的**非空**行（缺失 = 文件边缘）。
	let left = seam - 1;
	while (left >= 0 && kindOf(lines[left] ?? '') === 'blank') {
		left -= 1;
	}
	let right = seam;
	while (right < lines.length && kindOf(lines[right] ?? '') === 'blank') {
		right += 1;
	}

	const startLine = left + 1;
	const endLine = right - 1; // 可能 < startLine（纯插入窗口）
	const originalLines =
		endLine >= startLine ? lines.slice(startLine, endLine + 1) : [];

	const blankBefore = seam - startLine;
	const blankAfter = endLine + 1 - seam;
	const beforeBlanks =
		left >= 0
			? junctionBlanks(kindOf(lines[left] ?? ''), kindOf(group[0] ?? ''))
			: blankBefore;
	// 右侧**只补不删**（口径同 `insertTaskBlock`）。
	const afterBlanks =
		right < lines.length
			? Math.max(
					blankAfter,
					junctionBlanks(
						kindOf(group[group.length - 1] ?? ''),
						kindOf(lines[right] ?? ''),
					),
				)
			: blankAfter;

	const nextLines = [
		...keepBlanks(lines.slice(startLine, seam), beforeBlanks),
		...group,
		...keepBlanks(lines.slice(seam, endLine + 1), afterBlanks),
	];

	const base = startLine + beforeBlanks;
	return {
		edit: { startLine, endLine, originalLines, nextLines },
		newStartLines: starts.map((offset) => base + offset),
	};
}

/**
 * 把任务块插到目标内容的落点；等价 / 非法 → `null`（单块入口，内部委托
 * `insertTaskBlocks`，保证两条通路只留一份口径）。
 */
export function insertTaskBlock(
	content: string,
	blockLines: readonly string[],
	fromLevel: number,
	drop: TaskDropTarget,
): { edit: BlockEdit; newStartLine: number } | null {
	const inserted = insertTaskBlocks(
		content,
		[{ blockLines, level: fromLevel }],
		drop,
	);
	if (!inserted) {
		return null;
	}
	const newStartLine = inserted.newStartLines[0];
	return newStartLine === undefined
		? null
		: { edit: inserted.edit, newStartLine };
}

/**
 * 删除缝：`[块首, 块末]` 连同两侧连续空行一起重写成「应保留的空行」。
 *
 * 窗口同样排除锚点行；两侧都有锚点时按 `kindOf` 规范化，缺锚点（文件首 / 尾）
 * 时保留原有空行数（含 EOF 空串）。
 */
function buildRemovalEdit(
	content: string,
	blockStart: number,
	blockEnd: number,
): BlockEdit {
	const lines = content.split('\n');
	let left = blockStart - 1;
	while (left >= 0 && kindOf(lines[left] ?? '') === 'blank') {
		left -= 1;
	}
	let right = blockEnd + 1;
	while (right < lines.length && kindOf(lines[right] ?? '') === 'blank') {
		right += 1;
	}

	const startLine = left + 1;
	const endLine = right - 1;
	const originalLines = lines.slice(startLine, endLine + 1);
	const blankBefore = lines.slice(startLine, blockStart);
	const blankAfter = lines.slice(blockEnd + 1, endLine + 1);
	const total =
		left >= 0 && right < lines.length
			? junctionBlanks(
					kindOf(lines[left] ?? ''),
					kindOf(lines[right] ?? ''),
				)
			: blankBefore.length + blankAfter.length;

	return {
		startLine,
		endLine,
		originalLines,
		nextLines: keepBlanks([...blankBefore, ...blankAfter], total),
	};
}

/**
 * 源侧删除缝：取出 `fromLine` 所在任务块，连同两侧连续空行一起重写成
 * 「应保留的空行」。行号不存在 → `null`。
 */
export function removeTaskBlockFromNote(
	content: string,
	fromLine: number,
): BlockEdit | null {
	const block = extractTaskBlock(content, fromLine);
	if (!block) {
		return null;
	}
	return buildRemovalEdit(content, block.startLine, block.endLine);
}

/**
 * 两文件一次算完（A 主通路与 A′/B 的 `section-end` 落点共用）。
 *
 * 返回 `null` 的条件：源行不存在 / 落点行不存在 / 落点 Section 不存在 /
 * 目标 `parseSections` 为空（空文件 / 仅 frontmatter）/ 目标行号越界。
 */
export function moveTaskBlockAcrossNotes(
	sourceContent: string,
	targetContent: string,
	fromLine: number,
	drop: TaskDropTarget,
): CrossNoteMoveResult | null {
	const src = extractTaskBlock(sourceContent, fromLine);
	if (!src) {
		return null;
	}
	const inserted = insertTaskBlock(
		targetContent,
		src.blockLines,
		src.level,
		drop,
	);
	if (!inserted) {
		return null;
	}
	return {
		source: buildRemovalEdit(sourceContent, src.startLine, src.endLine),
		target: inserted.edit,
		targetNewStartLine: inserted.newStartLine,
	};
}

/**
 * 远端文件「把整组任务块追加到 `<tasksSectionTitle>` 节末」：
 * - 命中节且有任务 → 插在该节末个顶层块之后（层级 = 该节最浅缩进）；
 * - 命中但无任务 → 标题下一行、0 级；
 * - 未命中 → 文末新建同名标题（层级取现有顶层标题级别，无标题则 `#`）再插任务行；
 * - `tasksSectionTitle` 为空串（语言包缺键）→ `null`，绝不写坏文件。
 *
 * 目标文件是空文件也合法（A′/B 的「文末新建」通道）。组内每块各自重缩进到
 * 0 级、块间不补空行。
 */
export function appendTaskBlocksToNote(
	content: string,
	blocks: readonly TransferBlock[],
	tasksSectionTitle: string,
): { edit: BlockEdit; newStartLines: number[] } | null {
	const title = tasksSectionTitle.trim();
	const valid = blocks.filter((block) => block.blockLines.length > 0);
	if (title.length === 0 || valid.length === 0) {
		return null;
	}

	const section = findSectionByTitle(content, title);
	if (section) {
		return insertTaskBlocks(content, valid, {
			kind: 'section',
			sectionStartLine: section.startLine,
			position: 'end',
		});
	}

	// 未命中：文末新建标题块（复用 `appendSectionHeading` 的层级 / 空行口径）。
	const appended = appendSectionHeading(content, title);
	const flat: string[] = [];
	const starts: number[] = [];
	for (const block of valid) {
		starts.push(flat.length);
		for (const line of block.blockLines) {
			flat.push(reindentLine(line, -block.level));
		}
	}

	if (content.length === 0) {
		// 空文件：`split('\n')` 会给出一个幽灵空串行，用等长替换把它吃掉，
		// 避免写回后凭空多一个结尾空行。
		return {
			edit: {
				startLine: 0,
				endLine: 0,
				originalLines: [''],
				nextLines: [...appended.content.split('\n'), ...flat],
			},
			newStartLines: starts.map(
				(offset) => appended.headingLine + 1 + offset,
			),
		};
	}

	const baseLines = content.split('\n');
	const prefix = appended.content.split('\n').slice(baseLines.length);

	return {
		edit: {
			startLine: baseLines.length,
			endLine: baseLines.length - 1,
			originalLines: [],
			nextLines: [...prefix, ...flat],
		},
		newStartLines: starts.map(
			(offset) => baseLines.length + prefix.length + offset,
		),
	};
}

/**
 * 单块版「追加到节末」：委托 `appendTaskBlocksToNote`，与多块共用一份口径。
 */
export function appendTaskBlockToNote(
	content: string,
	blockLines: readonly string[],
	fromLevel: number,
	tasksSectionTitle: string,
): { edit: BlockEdit; newStartLine: number } | null {
	const appended = appendTaskBlocksToNote(
		content,
		[{ blockLines, level: fromLevel }],
		tasksSectionTitle,
	);
	if (!appended) {
		return null;
	}
	const newStartLine = appended.newStartLines[0];
	return newStartLine === undefined
		? null
		: { edit: appended.edit, newStartLine };
}
