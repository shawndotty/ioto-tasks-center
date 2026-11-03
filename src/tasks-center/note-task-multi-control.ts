/**
 * 批量 pin / repeat 的纯计算（[[Plan-20261104-060428]] C1）。
 *
 * 零 DOM / 零 obsidian，`jiti` 可直导。产出**一段** `BlockEdit`：窗口 =
 * `[min(lines), max(lines)]`，窗口内命中的行改控制项，其余行逐字节透传。
 *
 * 为什么不用 N 次单行写：N 次 `vault.process` = N 次 `modify` → N 次重绘竞争，
 * 行号迁移还会 O(N²)；一次原子区间替换与批量删除同口径。
 *
 * 🔴 方向由**调用方**给定（`on`），本模块不逐行取反：混合态（一部分已 pin、
 * 一部分未 pin）必须被拉平到同一目标态，逐行 `!isPinned` 会翻转成错的那一半。
 * `setTaskPin` / `setTaskRepeat` 本身幂等（目标态已达时逐字节返回原行），
 * 所以这里不需要三态分支。
 */

import { setTaskPin, setTaskRepeat } from './note-task-line';
import type { BlockEdit } from './note-task-transfer';

export type TaskControlKind = 'pin' | 'repeat';

export interface MultiControlEdit {
	/** 窗口 = [min(lines), max(lines)]，窗口内非目标行原样透传 */
	edit: BlockEdit;
	/** 实际变化的行号（原坐标，升序），供 Notice 计数与短路 */
	changedLines: number[];
}

/**
 * 批量设置 pin / repeat。
 *
 * `null` 条件：`lines` 为空 / 行号越界（`start < 0 || end >= 行数`）。
 * 行是任务行但目标态已达 → 逐字节不变，不计入 `changedLines`；
 * 行不是任务行 → 原样保留，同样不计入。
 * `changedLines` 为空表示「零改动」，调用方据此短路（不写盘、不重绘、不弹 Notice）。
 */
export function buildMultiControlEdit(
	content: string,
	lines: readonly number[],
	kind: TaskControlKind,
	on: boolean,
): MultiControlEdit | null {
	const targets = [...new Set(lines)].sort((a, b) => a - b);
	if (targets.length === 0) {
		return null;
	}

	const all = content.split('\n');
	const start = targets[0] ?? 0;
	const end = targets[targets.length - 1] ?? 0;
	if (start < 0 || end >= all.length) {
		return null;
	}

	const wanted = new Set(targets);
	const originalLines = all.slice(start, end + 1);
	const nextLines: string[] = [];
	const changedLines: number[] = [];

	for (let line = start; line <= end; line += 1) {
		const raw = all[line] ?? '';
		if (!wanted.has(line)) {
			nextLines.push(raw); // 集合外：逐字节透传（保住 CRLF 的 `\r` 与行尾空白）
			continue;
		}
		const changed =
			kind === 'pin' ? setTaskPin(raw, on) : setTaskRepeat(raw, on);
		if (changed === null) {
			nextLines.push(raw); // 非任务行：原样保留，不计入
			continue;
		}
		if (changed !== raw) {
			changedLines.push(line);
		}
		nextLines.push(changed);
	}

	return {
		edit: { startLine: start, endLine: end, originalLines, nextLines },
		changedLines,
	};
}
