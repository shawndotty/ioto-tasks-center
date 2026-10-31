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
import { kindOf, reindentLine, resolveAnchor } from './note-task-move';
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
 * 把任务块插到目标内容的落点；等价 / 非法 → `null`。
 *
 * 写回窗口 = 插入缝两侧「最近非空锚点之间」的连续区间（**不含锚点行本身**，
 * 因此 frontmatter 永远不会被卷进编辑区间）。窗口可以是空的（纯插入），
 * 此时 `endLine < startLine`、`originalLines = []`。
 */
export function insertTaskBlock(
	content: string,
	blockLines: readonly string[],
	fromLevel: number,
	drop: TaskDropTarget,
): { edit: BlockEdit; newStartLine: number } | null {
	if (blockLines.length === 0) {
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

	const moved = blockLines.map((line) => reindentLine(line, level - fromLevel));

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
			? junctionBlanks(
					kindOf(lines[left] ?? ''),
					kindOf(moved[0] ?? ''),
				)
			: blankBefore;
	// 右侧**只补不删**：目标文件原有的分隔空行是它自己的排版，跨文件搬运不替用户
	// 重排；与 `moveTaskBlock` 的可观测行为一致（插入块之后的空行落在提交区间外，
	// 规范化结果被丢弃，原文那几行留下来）。
	const afterBlanks =
		right < lines.length
			? Math.max(
					blankAfter,
					junctionBlanks(
						kindOf(moved[moved.length - 1] ?? ''),
						kindOf(lines[right] ?? ''),
					),
				)
			: blankAfter;

	const nextLines = [
		...keepBlanks(lines.slice(startLine, seam), beforeBlanks),
		...moved,
		...keepBlanks(lines.slice(seam, endLine + 1), afterBlanks),
	];

	return {
		edit: { startLine, endLine, originalLines, nextLines },
		newStartLine: startLine + beforeBlanks,
	};
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
 * 远端文件「追加到 `<tasksSectionTitle>` 节末」：
 * - 命中节且有任务 → 插在该节末个顶层块之后（层级 = 该节最浅缩进）；
 * - 命中但无任务 → 标题下一行、0 级；
 * - 未命中 → 文末新建同名标题（层级取现有顶层标题级别，无标题则 `#`）再插任务行；
 * - `tasksSectionTitle` 为空串（语言包缺键）→ `null`，绝不写坏文件。
 *
 * 目标文件是空文件也合法（A′/B 的「文末新建」通道）。
 */
export function appendTaskBlockToNote(
	content: string,
	blockLines: readonly string[],
	fromLevel: number,
	tasksSectionTitle: string,
): { edit: BlockEdit; newStartLine: number } | null {
	const title = tasksSectionTitle.trim();
	if (title.length === 0 || blockLines.length === 0) {
		return null;
	}

	const section = findSectionByTitle(content, title);
	if (section) {
		return insertTaskBlock(content, blockLines, fromLevel, {
			kind: 'section',
			sectionStartLine: section.startLine,
			position: 'end',
		});
	}

	// 未命中：文末新建标题块（复用 `appendSectionHeading` 的层级 / 空行口径）。
	const appended = appendSectionHeading(content, title);
	const moved = blockLines.map((line) => reindentLine(line, -fromLevel));

	if (content.length === 0) {
		// 空文件：`split('\n')` 会给出一个幽灵空串行，用等长替换把它吃掉，
		// 避免写回后凭空多一个结尾空行。
		return {
			edit: {
				startLine: 0,
				endLine: 0,
				originalLines: [''],
				nextLines: [...appended.content.split('\n'), ...moved],
			},
			newStartLine: appended.headingLine + 1,
		};
	}

	const baseLines = content.split('\n');
	const prefix = appended.content.split('\n').slice(baseLines.length);

	return {
		edit: {
			startLine: baseLines.length,
			endLine: baseLines.length - 1,
			originalLines: [],
			nextLines: [...prefix, ...moved],
		},
		newStartLine: baseLines.length + prefix.length,
	};
}
