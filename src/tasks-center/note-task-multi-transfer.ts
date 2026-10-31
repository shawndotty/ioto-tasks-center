/**
 * 跨任务文件的**整组**搬运（[[Plan-20261101-070535]] §四.步骤 2）。
 *
 * 只算不写：`source` / `target` 两段编辑分属两个文件、互不重叠，写盘由视图层
 * **先 target 后 source** 两次 `commitBlockRange` 提交（顺序不可反，见
 * `views/ioto-task/task-view-cross-file-move.ts` 模块头三条硬约束）。
 *
 * 为什么新开模块而不并进 `note-task-transfer`：源侧删除复用
 * `note-task-multi-delete` 的 `buildMultiRemovalEdit`，而那个模块已经 import
 * `note-task-transfer` —— 反向引用立刻成环。本模块同时 import 两者，是唯一
 * 不破依赖图的放法。
 *
 * 零 DOM / 零 obsidian，`jiti` 可直导。
 */

import { buildMultiRemovalEdit } from './note-task-multi-delete';
import { extractTaskBlocks, insertTaskBlocks } from './note-task-transfer';
import type { BlockEdit } from './note-task-transfer';
import type { MultiRemovalEdit } from './note-task-multi-delete';
import type { TaskDropTarget } from './note-task-move';

export interface CrossNoteBlocksMoveResult {
	/** 源侧删除缝（`edit` 即 `BlockEdit`，可直接喂 `commitBlockRange`）。 */
	source: MultiRemovalEdit;
	/** 目标侧插入缝。 */
	target: BlockEdit;
	/** 插入后组内每块在目标文件的新首行（0 基，按原文件顺序）。 */
	targetNewStartLines: number[];
}

/**
 * 两文件一次算完：**先算后写** —— 三件事都在任何 `commitBlockRange` 之前完成，
 * 杜绝「写了一半才发现算不出来」。
 *
 * `null` 条件：组为空（行号全失效）/ 目标落点非法 / 源侧删不出编辑。
 */
export function moveTaskBlocksAcrossNotes(
	sourceContent: string,
	targetContent: string,
	fromLines: readonly number[],
	drop: TaskDropTarget,
): CrossNoteBlocksMoveResult | null {
	// 三步吃同一份 `fromLines`：`normalizeMoveBlocks` 的跳过口径一致，
	// 视图层不必再对两处结果做交叉校验。
	const blocks = extractTaskBlocks(sourceContent, fromLines);
	if (blocks.length === 0) {
		return null;
	}
	const inserted = insertTaskBlocks(targetContent, blocks, drop);
	if (!inserted) {
		return null;
	}
	const source = buildMultiRemovalEdit(sourceContent, fromLines);
	if (!source) {
		return null;
	}
	return {
		source,
		target: inserted.edit,
		targetNewStartLines: inserted.newStartLines,
	};
}
