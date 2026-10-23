/**
 * 「创建任务副本」的纯逻辑（[[Plan-20261023-145916]] §5.1）。
 *
 * 零 obsidian / 零 DOM，可被 jiti 直接单测。复用三块既有积木：
 * - `taskBlockRange`（note-task-swap.ts）——任务行 + 续写区 + 整棵子树的连续区间；
 * - `isTaskContinuationLine`（note-continuation.ts）——与渲染层同口径的续行判定；
 * - `setTaskPin` / `setTaskRepeat` / `composeTaskLine`（note-task-line.ts）
 *   ——剥离视图类控制项 + 重置勾选位，其余字节逐字节保留。
 *
 * 本模块**只算行区间与替换文本**，不写盘、不动 DOM —— 写盘交给视图层复用现成的
 * `commitBlockRange`（一次 `vault.process` 原子区间替换）。
 */

import type { NoteChecklistItem } from './note-checklist';
import { isTaskContinuationLine } from './note-continuation';
import {
	composeTaskLine,
	indentLevelOf,
	setTaskPin,
	setTaskRepeat,
	splitTaskLine,
} from './note-task-line';
import { taskBlockRange } from './note-task-swap';

export interface DuplicateTaskOptions {
	/** 是否连同**本卡自身**的续写区一起复制（子树恒复制） */
	includeContinuation: boolean;
	/** 剥离副本各任务行的 `#ioto/pin` / `#ioto/repeat`（默认 true，见 Plan §二 #2） */
	dropViewControls?: boolean;
}

export interface DuplicateTaskPlan {
	/** 被替换块首行（0 基，含）——原任务行 */
	start: number;
	/** 被替换块末行（0 基，含）——原块最后一行续行 */
	end: number;
	/** `lines[start..end]` 原文，供 `commitBlockRange` 二次定位 */
	originalLines: string[];
	/** 原块 + 副本（副本任务行 = `duplicateLine`） */
	nextLines: string[];
	/** 副本任务行的绝对行号（= `end + 1`），复制后用于回填选中 */
	duplicateLine: number;
}

/**
 * 复制计划：原块原样保留，副本整段插在**块尾**（任务行 + 续写区 + 整棵子树之后）。
 *
 * - `line` 不在 `items` 里 / 不是任务行 → `null`（调用层据此走 conflict 回落）；
 * - `includeContinuation: false` → 副本丢弃**本卡自身**的续写行，但子树原样带走；
 * - 副本任务行一律 `[ ]`，并剥离 `#ioto/pin` / `#ioto/repeat`；
 * - 缩进 / 列表符 / 行尾空白逐字节照搬（副本与原件同级，不做 re-indent）。
 */
export function buildTaskDuplicatePlan(
	content: string,
	items: readonly NoteChecklistItem[],
	line: number,
	options: DuplicateTaskOptions,
): DuplicateTaskPlan | null {
	const index = items.findIndex((item) => item.line === line);
	if (index < 0) {
		return null; // 行不在条目里（stale data-line / 非任务行）
	}

	const lines = content.split('\n');
	const block = taskBlockRange(items, lines, index);
	if (block.end < block.start) {
		return null;
	}

	const blockLines = lines.slice(block.start, block.end + 1);
	const head = splitTaskLine(blockLines[0] ?? '');
	if (!head) {
		return null;
	}

	// 本卡自身续写区 = 任务行下方、以**本行缩进**为父级仍成立的连续续行
	// （与 `countContinuationLines` 同口径；子任务行不算续行，天然止于子树首行）
	const parentLevel = indentLevelOf(head.indent);
	let ownContinuations = 0;
	while (
		isTaskContinuationLine(
			blockLines[1 + ownContinuations] ?? '',
			parentLevel,
		)
	) {
		ownContinuations += 1;
	}

	const duplicateTaskLine = buildDuplicateTaskLine(
		blockLines[0] ?? '',
		options.dropViewControls !== false,
	);
	if (duplicateTaskLine === null) {
		return null;
	}

	// 不复制续写区 → 跳过「任务行之后、子树之前」的那 N 行
	const restStart = options.includeContinuation ? 1 : 1 + ownContinuations;
	const rest = blockLines.slice(restStart);
	const copyLines =
		options.dropViewControls === false
			? [duplicateTaskLine, ...rest]
			: [
					duplicateTaskLine,
					...rest.map((raw) => {
						const parts = splitTaskLine(raw);
						return parts ? stripViewControls(raw) : raw;
					}),
				];

	return {
		start: block.start,
		end: block.end,
		originalLines: blockLines,
		nextLines: [...blockLines, ...copyLines],
		duplicateLine: block.end + 1,
	};
}

/** 剥离 `#ioto/pin` / `#ioto/repeat`（幂等：目标态已达时逐字节返回原行） */
function stripViewControls(line: string): string {
	const unpinned = setTaskPin(line, false) ?? line;
	return setTaskRepeat(unpinned, false) ?? unpinned;
}

/**
 * 副本的任务行：剥离视图类控制项 + 勾选位重置为 `[ ]`。
 *
 * 🔴 顺序不能反：`composeTaskLine` 在 `body === sourceText` 时逐字节还原 `source`，
 * 先换勾选位会让后续剥离被「还原」掉。所以「先剥离、后换勾选」。
 */
export function buildDuplicateTaskLine(
	line: string,
	dropViewControls = true,
): string | null {
	const parts = splitTaskLine(line);
	if (!parts) {
		return null;
	}

	const stripped = dropViewControls ? stripViewControls(line) : line;
	const target = splitTaskLine(stripped);
	return target ? composeTaskLine({ ...target, checked: ' ' }) : null;
}
