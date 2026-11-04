/**
 * 批量「标记为完成」的纯计算（[[Plan-20261104-063936]] C1）。
 *
 * 与 `buildMultiControlEdit` 同形：窗口 = [min(lines), max(lines)]，集合外逐字节
 * 透传，窗口内非任务行原样保留。差异只有两点：
 * 1. 改写函数是单向的 `markTaskLineDone`（幂等，已勾选原行返回）；
 * 2. 额外产出 `repeatLines`，供 Notice 说明「重复任务将被暂停」。
 *
 * 🔴 不把 `'done'` 塞进 `TaskControlKind`：那个枚举的参数是 `on: boolean`，
 * 完成没有反向，`on=false` 会是没人定义的行为。
 *
 * 不级联子任务（与单卡 checkbox 一致）：只改 `lines` 里点名的行。
 */

import { markTaskLineDone, splitTaskLine } from './note-task-line';
import type { BlockEdit } from './note-task-transfer';

export interface MultiDoneEdit {
	/** 窗口 = [min(lines), max(lines)]，窗口内非目标行原样透传 */
	edit: BlockEdit;
	/** 实际变化的行号（原坐标，升序），供 Notice 计数与短路 */
	changedLines: number[];
	/** `changedLines` 中带 `#ioto/repeat` 的行（写勾 = 暂停，只用于 Notice） */
	repeatLines: number[];
}

export function buildMultiDoneEdit(
	content: string,
	lines: readonly number[],
): MultiDoneEdit | null {
	const targets = [...new Set(lines)].sort((a, b) => a - b);
	if (targets.length === 0) return null;

	const all = content.split('\n');
	const start = targets[0] ?? 0;
	const end = targets[targets.length - 1] ?? 0;
	if (start < 0 || end >= all.length) return null;

	const wanted = new Set(targets);
	const originalLines = all.slice(start, end + 1);
	const nextLines: string[] = [];
	const changedLines: number[] = [];
	const repeatLines: number[] = [];

	for (let line = start; line <= end; line += 1) {
		const raw = all[line] ?? '';
		if (!wanted.has(line)) {
			nextLines.push(raw); // 集合外：逐字节透传（保住 CRLF 的 `\r` 与行尾空白）
			continue;
		}
		const changed = markTaskLineDone(raw);
		if (changed === null) {
			nextLines.push(raw); // 非任务行：原样保留、不计数
			continue;
		}
		if (changed !== raw) {
			changedLines.push(line);
			// 只在**实际发生改动**的重复任务上计数：已完成的重复任务不重复计
			if (
				splitTaskLine(raw)?.controls.some(
					(control) => control.kind === 'repeat',
				)
			) {
				repeatLines.push(line);
			}
		}
		nextLines.push(changed);
	}

	return {
		edit: { startLine: start, endLine: end, originalLines, nextLines },
		changedLines,
		repeatLines,
	};
}
