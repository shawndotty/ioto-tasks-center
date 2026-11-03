/**
 * 「批量创建任务副本」的纯计算（[[Plan-20261104-060428]] C3）。
 *
 * 零 DOM / 零 obsidian，`jiti` 可直导。产出**一段** `BlockEdit`：
 * 窗口 = «首块首行» … «末块末行»，每走过一个块的块尾就紧跟着追加它的副本
 * （`A, A', B, B'`）。不向两侧吃空行 —— 空行属于布局，不该被窗口吞掉
 * （与批量删除刻意不同）。
 *
 * 块归一复用 `extractTaskBlocks`（父子同选只留最外层、按 `startLine` 升序），
 * 副本行生成复用 `duplicateBlockLines`（与单块同一份剥离语义）。
 */

import { duplicateBlockLines } from './note-task-duplicate';
import { extractTaskBlocks } from './note-task-transfer';
import type { BlockEdit } from './note-task-transfer';
import type { DuplicateTaskOptions } from './note-task-duplicate';

export interface MultiDuplicatePlan {
	/** 原块 + 各自块尾的副本（A, A', B, B'） */
	edit: BlockEdit;
	/** 副本任务行的新行号（升序，按 DOM 顺序） */
	duplicateLines: number[];
	/** 组内「本卡续写区行数」求和，供弹窗文案 */
	ownContinuationCount: number;
	/** 归一后的块（断言 / 调试） */
	blocks: Array<{ startLine: number; endLine: number }>;
}

/**
 * 多块复制计划。
 *
 * `null` 条件：`lines` 为空 / 没有任何行命中任务块 / 任一块首行不是任务行
 * （stale `data-line` → 调用层静默返回，与单块 `duplicateTask` 的冲突回落不同）。
 */
export function buildMultiDuplicatePlan(
	content: string,
	lines: readonly number[],
	options: DuplicateTaskOptions,
): MultiDuplicatePlan | null {
	if (lines.length === 0) {
		return null;
	}

	const blocks = extractTaskBlocks(content, lines);
	if (blocks.length === 0) {
		return null;
	}

	// 逐块先算副本：任一块算不出来就整体放弃，绝不写半个文件。
	const copies = blocks.map((block) =>
		duplicateBlockLines(block.blockLines, options),
	);
	if (copies.some((copy) => copy === null)) {
		return null;
	}

	const all = content.split('\n');
	const firstBlock = blocks[0];
	const lastBlock = blocks[blocks.length - 1];
	if (!firstBlock || !lastBlock) {
		return null;
	}
	const startLine = firstBlock.startLine;
	const endLine = lastBlock.endLine;
	if (startLine < 0 || endLine >= all.length || startLine > endLine) {
		return null;
	}

	const nextLines: string[] = [];
	const duplicateLines: number[] = [];
	let ownContinuationCount = 0;

	for (let i = startLine; i <= endLine; i += 1) {
		nextLines.push(all[i] ?? '');
		const index = blocks.findIndex((block) => block.endLine === i);
		if (index < 0) {
			continue;
		}
		const copy = copies[index];
		if (!copy) {
			continue;
		}
		// 副本紧跟在块尾之后 → 副本任务行的**绝对**行号 = 窗口起点 + 窗口内下标
		duplicateLines.push(startLine + nextLines.length);
		nextLines.push(...copy.copyLines);
		ownContinuationCount += copy.ownContinuationCount;
	}

	return {
		edit: {
			startLine,
			endLine,
			originalLines: all.slice(startLine, endLine + 1),
			nextLines,
		},
		duplicateLines,
		ownContinuationCount,
		blocks: blocks.map((block) => ({
			startLine: block.startLine,
			endLine: block.endLine,
		})),
	};
}
