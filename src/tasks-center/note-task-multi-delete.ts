/**
 * Task View 多选批量删除的纯计算（[[Plan-20261101-054951]] §四.步骤 2）。
 *
 * 与单选删除的差别（不能用 `deleteSelected` 复用）：单选只删「任务行 + 续行」、
 * 把子任务留在原地（`swallowContinuations`）。批量场景若照此办理，会留下一堆
 * 缩进孤儿行 —— 所以这里按**块**删（任务行 + 整棵子树 + 末节点续行）。
 *
 * 四条实现规则：
 * 1. 块归一：父子同选只删最外层（按首行升序，起点落在前一个保留块内的丢弃）；
 * 2. 窗口 = «首块首行» 到 «末块末行» 再向两侧吃掉连续空行（口径同
 *    `note-task-transfer.ts` 的私有 `buildRemovalEdit`——那份带「单块」语义，
 *    不为复用而导出）；
 * 3. 空行只在「接缝」规范化一次（`junctionBlanks`，与 `moveTaskBlock` 一致）；
 *    缺锚点（文件首 / 尾、仅剩空白）时保留原有空行数（含 EOF 空串）；
 * 4. 只产一段编辑（走 `commitBlockRange` 的 `nextLines` 通道）——绝不 N 次单行写。
 *
 * 零 DOM / 零 obsidian，`jiti` 可直导。
 */

import type { BlockEdit, ExtractedTaskBlock } from './note-task-transfer';
import { extractTaskBlock } from './note-task-transfer';
import { kindOf, type LineKind } from './note-task-move';

export interface MultiRemovalEdit {
	/** 一段窗口的整块替换（走 commitBlockRange 的 nextLines 通道）。 */
	edit: BlockEdit;
	/** 窗口内「原行号 → 新行号」；值为 null = 被删。窗口外的行不在表里。 */
	remap: Map<number, number | null>;
	/** 实际删掉的行数（= originalLines.length - nextLines.length）。 */
	removedCount: number;
	/** 归一后的块区间（已丢弃被外层块包含的块），供断言 / 调试。 */
	blocks: Array<{ startLine: number; endLine: number }>;
}

/** 两锚点之间应保留的空行数（口径同 `moveTaskBlock` 的 `normalizeJunction`）。 */
function junctionBlanks(left: LineKind, right: LineKind): number {
	return left === 'prose' || right === 'prose' ? 1 : 0;
}

/** 取前 `count` 条原空行文本（保 CRLF 的 `\r`），不足补 `''`。 */
function takeBlanks(originals: readonly string[], count: number): string[] {
	const kept: string[] = [];
	for (let i = 0; i < count; i += 1) {
		kept.push(originals[i] ?? '');
	}
	return kept;
}

/**
 * 把 `fromLines` 命中的任务块整块删掉，产出一段原子编辑 + 行号映射。
 *
 * `null` 条件：`fromLines` 为空 / 全部 `extractTaskBlock` 返回 `null` / 窗口越界。
 */
export function buildMultiRemovalEdit(
	content: string,
	fromLines: readonly number[],
): MultiRemovalEdit | null {
	if (fromLines.length === 0) {
		return null;
	}
	const lines = content.split('\n');

	// ① 块归一：按首行升序，起点落在前一个保留块内的丢弃（父子同选只删最外层）
	const extracted: ExtractedTaskBlock[] = [];
	for (const fromLine of fromLines) {
		const block = extractTaskBlock(content, fromLine);
		if (block) {
			extracted.push(block);
		}
	}
	if (extracted.length === 0) {
		return null;
	}
	extracted.sort((a, b) => a.startLine - b.startLine);
	const blocks: Array<{ startLine: number; endLine: number }> = [];
	for (const block of extracted) {
		const last = blocks[blocks.length - 1];
		if (last && block.startLine <= last.endLine) {
			continue;
		}
		blocks.push({ startLine: block.startLine, endLine: block.endLine });
	}
	const firstBlock = blocks[0];
	const lastBlock = blocks[blocks.length - 1];
	if (!firstBlock || !lastBlock) {
		return null;
	}

	// ② 窗口：首块首行 → 末块末行，再向两侧吃掉连续空行
	let startLine = firstBlock.startLine;
	let endLine = lastBlock.endLine;
	if (startLine < 0 || endLine >= lines.length || startLine > endLine) {
		return null;
	}
	while (startLine > 0 && kindOf(lines[startLine - 1] ?? '') === 'blank') {
		startLine -= 1;
	}
	while (endLine < lines.length - 1 && kindOf(lines[endLine + 1] ?? '') === 'blank') {
		endLine += 1;
	}

	const originalLines = lines.slice(startLine, endLine + 1);
	const remap = new Map<number, number | null>();
	for (let i = startLine; i <= endLine; i += 1) {
		remap.set(i, null);
	}

	// ③ 接缝规范化：窗口按「保留行 / 删除缝」铺成线性序列，遇到非空行或序列末尾
	//    时结算此前累积的空行（只有跨过删除缝的那段才按 `kindOf` 归一）。
	const nextLines: string[] = [];
	let pendingBlanks: Array<{ text: string; source: number }> = [];
	let hitGap = false;
	/** 上一个已落地的非空行种类（初值 = 窗口左侧锚点；文件首为 null）。 */
	let leftKind: LineKind | null =
		startLine > 0 ? kindOf(lines[startLine - 1] ?? '') : null;
	/** 窗口右侧锚点种类（文件尾为 null）。 */
	const rightKind: LineKind | null =
		endLine + 1 < lines.length ? kindOf(lines[endLine + 1] ?? '') : null;

	const flushPending = (nextKind: LineKind | null): void => {
		if (pendingBlanks.length === 0 && !hitGap) {
			return;
		}
		const count =
			hitGap && leftKind !== null && nextKind !== null
				? junctionBlanks(leftKind, nextKind)
				: pendingBlanks.length; // 缺锚点 → 保留原有空行数
		const picked = takeBlanks(
			pendingBlanks.map((blank) => blank.text),
			count,
		);
		for (let i = 0; i < count; i += 1) {
			const source = pendingBlanks[i]?.source;
			if (source !== undefined) {
				remap.set(source, nextLines.length);
			}
			nextLines.push(picked[i] ?? '');
		}
		pendingBlanks = [];
		hitGap = false;
	};

	/** 保留段 `[from, to)`：空行先攒着，非空行落地并顺手结算前面攒的空行。 */
	const pushKeptRange = (from: number, to: number): void => {
		for (let i = from; i < to; i += 1) {
			const text = lines[i] ?? '';
			const kind = kindOf(text);
			if (kind === 'blank') {
				pendingBlanks.push({ text, source: i });
				continue;
			}
			flushPending(kind);
			leftKind = kind;
			remap.set(i, nextLines.length);
			nextLines.push(text);
		}
	};

	let cursor = startLine;
	for (const block of blocks) {
		pushKeptRange(cursor, block.startLine);
		hitGap = true;
		cursor = block.endLine + 1;
	}
	pushKeptRange(cursor, endLine + 1);
	flushPending(rightKind);

	return {
		edit: { startLine, endLine, originalLines, nextLines },
		remap,
		removedCount: originalLines.length - nextLines.length,
		blocks,
	};
}

/** 删除后的行号迁移（窗口外：上方不变、下方 −removedCount；窗口内查 remap）。 */
export function remapLineAfterMultiDelete(
	result: MultiRemovalEdit,
	line: number,
): number | null {
	const { startLine, endLine } = result.edit;
	if (line < startLine) {
		return line;
	}
	if (line > endLine) {
		return line - result.removedCount;
	}
	return result.remap.get(line) ?? null;
}
