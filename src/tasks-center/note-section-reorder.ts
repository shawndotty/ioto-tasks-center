/**
 * 顶层 Section（标题块）拖拽重排的纯计算。
 *
 * 零 DOM / 零 obsidian 运行时依赖，输出可直接喂给 `commitBlockRange`
 * （区间从第一个标题块到文件末），并附带旧行号→新行号映射，供视图侧迁移
 * 折叠态 / 选中行。
 *
 * 空行口径（见 [[Plan task-view-section-drag-reorder]] §设计决策 5）：
 * - 顶层块之间统一为**恰好一个**空行（块尾分隔空行会被规范化）；
 * - frontmatter / 引导区（第一个标题块之前的 prefix）原样不动，只在其末行
 *   非空时补一个分隔空行；
 * - 文件末尾空行形态（如结尾换行产生的空串）按原数量保留；
 * - 块**内部**的任何行（含嵌套标题、代码块、列表内空行）逐字节保留。
 */

import { collectRootSections, parseSections } from './note-sections';

export interface SectionReorderResult {
	/** 写回区间首行（0 基，含）= 第一个顶层标题块行。 */
	startLine: number;
	/** 写回区间末行（0 基，含）= 文件末行。 */
	endLine: number;
	/** 快照原区间各行（供 commitBlockRange 序列校验 / 全文搜索兜底）。 */
	originalLines: string[];
	/** 重排后的区间各行。 */
	nextLines: string[];
	/**
	 * 旧行号 → 新行号。prefix 行恒等；块内行随块迁移；被规范化掉的块尾
	 * 分隔空行 → `null`（调用方应把落在其上的跟踪态清空）。
	 */
	mapLine(line: number): number | null;
}

/** 落点：目标块之前 / 之后。N 个块共 N+1 个槽位，等价槽位由本函数判 no-op。 */
export type SectionDropPosition = 'before' | 'after';

interface ReorderToken {
	text: string;
	/** 该新行对应的旧文件行号；新增的分隔 / 结尾空行为 null。 */
	source: number | null;
}

export function reorderTopLevelSections(
	content: string,
	fromStartLine: number,
	targetStartLine: number,
	position: SectionDropPosition,
): SectionReorderResult | null {
	const lines = content.split('\n');
	const roots = collectRootSections(parseSections(content)).filter(
		(section) => section.level > 0,
	);
	if (roots.length < 2) {
		return null; // 0/1 个标题块：无序可排
	}

	const fromIdx = roots.findIndex(
		(section) => section.startLine === fromStartLine,
	);
	const targetIdx = roots.findIndex(
		(section) => section.startLine === targetStartLine,
	);
	if (fromIdx < 0 || targetIdx < 0 || fromIdx === targetIdx) {
		return null;
	}

	// 各块 body：剥掉尾部纯空白行（分隔统一由重组器生成）。
	const blockBodies: number[][] = roots.map((section) => {
		const body: number[] = [];
		for (let line = section.startLine; line <= section.endLine; line += 1) {
			body.push(line);
		}
		while (
			body.length > 0 &&
			(lines[body[body.length - 1] ?? -1] ?? '').trim() === ''
		) {
			body.pop();
		}
		return body;
	});

	// 计算新顺序（在「移除源块后」的序列上求插入点）。
	const order = roots.map((_, index) => index);
	const moved = order.splice(fromIdx, 1)[0] ?? -1;
	const targetInRest = order.indexOf(targetIdx);
	const insertAt =
		position === 'before' ? targetInRest : targetInRest + 1;
	order.splice(insertAt, 0, moved);
	if (order.every((blockIdx, index) => blockIdx === index)) {
		return null; // 等价槽位：顺序未变
	}

	const startLine = roots[0]?.startLine ?? 0;
	const prefix = lines.slice(0, startLine);

	// 文件末尾连续空串数（最后一块尾部空行之外没有别的内容，故与文末同源）。
	let eofBlanks = 0;
	for (let line = lines.length - 1; line >= startLine; line -= 1) {
		if ((lines[line] ?? '').trim() !== '') {
			break;
		}
		eofBlanks += 1;
	}

	// 带源行号的重组：prefix 恒等 → 块间单个空行 → 末尾恢复 EOF 空行。
	const tokens: ReorderToken[] = prefix.map((text, index) => ({
		text,
		source: index,
	}));
	if (tokens.length > 0 && (tokens[tokens.length - 1]?.text ?? '').trim() !== '') {
		tokens.push({ text: '', source: null });
	}
	order.forEach((blockIdx, ordinal) => {
		if (ordinal > 0) {
			tokens.push({ text: '', source: null });
		}
		for (const oldLine of blockBodies[blockIdx] ?? []) {
			tokens.push({ text: lines[oldLine] ?? '', source: oldLine });
		}
	});
	for (let i = 0; i < eofBlanks; i += 1) {
		tokens.push({ text: '', source: null });
	}

	const oldToNew = new Map<number, number>();
	tokens.forEach((token, newLine) => {
		if (token.source !== null) {
			oldToNew.set(token.source, newLine);
		}
	});

	return {
		startLine,
		endLine: lines.length - 1,
		originalLines: lines.slice(startLine),
		nextLines: tokens.slice(startLine).map((token) => token.text),
		mapLine(line) {
			if (line < startLine) {
				return line;
			}
			return oldToNew.has(line) ? (oldToNew.get(line) as number) : null;
		},
	};
}
