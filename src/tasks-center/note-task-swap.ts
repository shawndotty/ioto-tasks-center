/**
 * 「同级任务互换」的纯逻辑（[[Plan-20261014-194115]] §3）。
 *
 * 零 `obsidian` / 零 DOM（唯一的运行时依赖 `isTaskContinuationLine` 本身也无
 * 依赖），照 `recent-task-filter.ts` / `note-continuation.ts` 的范式组织，
 * 可被 jiti 直接单测。
 *
 * 三块积木：
 * 1. `taskBlockRange` —— 一张任务卡（任务行 + 续写区 + 整棵子树）的连续行区间；
 * 2. `findSiblingTarget` —— 同级兄弟的行号（同 `indentLevel` + 同父级 + 同 Section）；
 * 3. `computeSwapRange` —— 把两块重排成 `[B块][中间行][A块]`，并给出选中回填的新行号。
 *
 * 本模块**只算行区间与替换文本**，不写盘、不动 DOM —— 写盘交给视图层复用现成的
 * `commitBlockRange`（一次 `vault.process` 原子区间替换）。
 */

import type { NoteChecklistItem } from './note-checklist';
import { isTaskContinuationLine } from './note-continuation';

export type SwapDirection = 'prev' | 'next';

export interface TaskBlockRange {
	/** 0 基起始行（含）——任务行本身 */
	start: number;
	/** 0 基结束行（含）——末节点的最后一行续行 */
	end: number;
}

/**
 * 任务 `index`（含续写区 + 整棵子树）在文件里的连续行区间。
 *
 * - 子树 = 紧随其后、`indentLevel` 更深的连续条目（多级一并吞下）；
 * - 续写区 = 末节点行之后、仍属「任务续行」的连续行（`isTaskContinuationLine`）；
 * - `items` 需按行号升序（解析层保证）；`index` 越界 → 返回退化区间
 *   `{ start: 0, end: -1 }`（由 `computeSwapRange` 的重叠守卫兜底）。
 *
 * 组内**逐字节原样**，不重新缩进 —— 同级互换层级不变，无需 re-indent。
 */
export function taskBlockRange(
	items: readonly NoteChecklistItem[],
	lines: readonly string[],
	index: number,
): TaskBlockRange {
	const first = items[index];
	if (!first) {
		return { start: 0, end: -1 };
	}

	// ① 吞掉整棵子树：更深缩进的连续条目
	let last = first;
	let cursor = index + 1;
	while (cursor < items.length) {
		const item = items[cursor];
		if (!item || item.indentLevel <= first.indentLevel) {
			break;
		}
		last = item;
		cursor += 1;
	}

	// ② 顺延吞掉末节点的连续续行
	let end = last.line;
	while (isTaskContinuationLine(lines[end + 1] ?? '', last.indentLevel)) {
		end += 1;
	}

	return { start: first.line, end };
}

/**
 * 同级兄弟行号：同 `indentLevel` + 同父级 + 同 Section
 * （调用方须先把 `items` 限定在目标 Section 内，见 §2.1）。
 *
 * 从选中行出发按 `direction` 扫描条目序列：
 * - 越到更浅的条目（`< level`）= 越过父级 / 块边界 → 无同级，返回 `null`；
 * - 命中 `=== level` → 即同级兄弟（父级必然更浅，未越过父级即必同父）；
 * - 更深（`> level`）= 某块的子树 → 跳过继续找。
 *
 * 行不在条目里 / 扫描出界 → `null`（已是同级首 / 末条）。
 */
export function findSiblingTarget(
	items: readonly NoteChecklistItem[],
	line: number,
	direction: SwapDirection,
): number | null {
	const index = items.findIndex((item) => item.line === line);
	const anchor = items[index];
	if (!anchor) {
		return null;
	}

	const level = anchor.indentLevel;
	const step = direction === 'next' ? 1 : -1;
	for (let i = index + step; i >= 0 && i < items.length; i += step) {
		const item = items[i];
		if (!item) {
			return null;
		}
		if (item.indentLevel < level) {
			return null; // 越过父级 / 块边界
		}
		if (item.indentLevel === level) {
			return item.line; // 同级兄弟
		}
		// 更深 → 是某块的子树，跳过
	}

	return null;
}

export interface SwapRangeResult {
	/** 被重排区间首行（0 基，含）——A 块原起始行 */
	start: number;
	/** 被重排区间末行（0 基，含）——B 块原结束行 */
	end: number;
	/** `lines[start..end]` 的原序列，供 `commitBlockRange` 二次定位 */
	originalLines: string[];
	/** 重排后的整段（`[B块][中间行][A块]`） */
	nextLines: string[];
	/** 行号较小的块（A）交换后的新起始行 */
	aNewLine: number;
	/** 行号较大的块（B）交换后的新起始行 */
	bNewLine: number;
}

/**
 * 归一化 A（行号小）/ B（行号大）后重排区间：`[A块][中间行][B块] → [B块][中间行][A块]`。
 *
 * - 两块之间的**非任务正文行**原样保留（A 与 B 只对调，中间内容不动）；
 * - 任一 `line` 不在 `items` 里 / 两块重叠（互为子树）→ `null`；
 * - 切片按 `lines` 原样取，`\r`（CRLF）不丢。
 */
export function computeSwapRange(
	lines: readonly string[],
	items: readonly NoteChecklistItem[],
	lineA: number,
	lineB: number,
): SwapRangeResult | null {
	const lowLine = Math.min(lineA, lineB);
	const highLine = Math.max(lineA, lineB);
	const lowIndex = items.findIndex((item) => item.line === lowLine);
	const highIndex = items.findIndex((item) => item.line === highLine);
	if (lowIndex < 0 || highIndex < 0) {
		return null;
	}

	const blockLow = taskBlockRange(items, lines, lowIndex);
	const blockHigh = taskBlockRange(items, lines, highIndex);
	// 重叠（B 落在 A 的子树里，反之亦然）→ 不是「两块」可互换 → 放弃
	if (blockLow.end >= blockHigh.start) {
		return null;
	}

	const start = blockLow.start;
	const end = blockHigh.end;
	const originalLines = lines.slice(start, end + 1);
	const lowBlock = lines.slice(blockLow.start, blockLow.end + 1);
	const middleLines = lines.slice(blockLow.end + 1, blockHigh.start);
	const highBlock = lines.slice(blockHigh.start, blockHigh.end + 1);
	const nextLines = [...highBlock, ...middleLines, ...lowBlock];

	return {
		start,
		end,
		originalLines,
		nextLines,
		// A 让位给 B 块 + 中间行之后的新起点
		aNewLine: start + highBlock.length + middleLines.length,
		bNewLine: start,
	};
}
