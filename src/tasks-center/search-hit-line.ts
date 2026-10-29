/**
 * 「查看笔记」直接定位到搜索命中行的纯函数层（[[Plan-20261030-060126]] §三 S1）。
 *
 * 预览渲染的输入是 `stripFrontmatter(raw)`，染色用与过滤同源的
 * `findMatchRanges`；因此 DOM 命中序号（`hitIndex`）可以映射回**原始全文**的
 * 行号：`frontmatter 行数 + 正文内偏移所在行`。
 *
 * 序号对齐的依据（[[Research-20261030-052757]] §2.1）：`hitEls` 与重算区间
 * 在同一份剥过 frontmatter 的正文上由同一个 `findMatchRanges` + `mergeRanges`
 * 产生，相邻区间合并语义两端等量抵消。
 *
 * 零 `obsidian` 依赖，照 `search-highlight.ts` 范式组织，可被 jiti 直接导入单测。
 *
 * 定位是增强不是承诺：条件不满足返回 `null`，调用方按普通打开静默降级
 * （零新增 i18n 文案）。
 */

import { findMatchRanges, type MatchOptions } from './search-highlight';
import { stripFrontmatter } from './markdown-body';

/**
 * frontmatter 占用的行数（含闭合 `---` 行与其后的换行）。
 * 判定正则与 `markdown-body.ts` 的 `FRONTMATTER_PATTERN` 同形（`\r?\n` 兼容）；
 * 无 frontmatter → `0`。
 */
export function frontmatterLineCount(raw: string): number {
	const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
	if (!match) {
		return 0;
	}
	let lines = 0;
	for (let i = 0; i < match[0].length; i++) {
		if (match[0][i] === '\n') {
			lines += 1;
		}
	}
	return lines;
}

/** 0 基行号：按 `\n` 计数，O(n)；偏移越界夹取到文本两端。 */
export function offsetToLine(text: string, offset: number): number {
	const clamped = Math.max(0, Math.min(offset, text.length));
	let line = 0;
	for (let i = 0; i < clamped; i++) {
		if (text[i] === '\n') {
			line += 1;
		}
	}
	return line;
}

export interface ResolveHitLineParams {
	/** 原始全文（含 frontmatter）。 */
	raw: string;
	/** 搜索词表（弹窗的 `searchTokens()`）。 */
	tokens: readonly string[];
	/** 匹配选项：只取 `{ caseSensitive?, wholeWord? }`（`scope` 由调用方剥掉）。 */
	options: MatchOptions;
	/** DOM 命中序号（文档序）。 */
	hitIndex: number;
}

/**
 * 把「第 hitIndex 处正文命中」映射为全文 0 基行号。
 *
 * - `hitIndex < 0` / 无 tokens / 无命中 → `null`（普通打开）；
 * - `hitIndex` 越界 → clamp 到最后一个区间（最坏偏几行，不失败）。
 *
 * 🔴 返回的是**全文行号（含 frontmatter）**：折算已在
 * `frontmatterLineCount` 完成，调用方不得再做任何偏移处理。
 */
export function resolveHitLine(params: ResolveHitLineParams): number | null {
	const { raw, tokens, options, hitIndex } = params;
	if (hitIndex < 0 || tokens.length === 0) {
		return null;
	}

	const body = stripFrontmatter(raw);
	const ranges = findMatchRanges(body, tokens, options);
	if (ranges.length === 0) {
		return null;
	}

	const index = Math.min(hitIndex, ranges.length - 1);
	const range = ranges[index];
	if (!range) {
		return null;
	}

	return frontmatterLineCount(raw) + offsetToLine(body, range.start);
}
