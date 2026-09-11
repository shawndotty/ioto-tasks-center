/**
 * 任务笔记模板中的光标占位符处理。
 *
 * 模板正文里的 `%%Cursor%%`（忽略大小写）会被移除，并把首个标记的起始偏移
 * 返回给调用方，供创建完成后把光标落到该处。实现刻意不依赖 `obsidian`，
 * 便于用现有 `node --test` + jiti 直接单测（见方案 §5.1）。
 */

export const CURSOR_MARKER = '%%Cursor%%';

const CURSOR_MARKER_PATTERN = /%%cursor%%/gi;

const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

export interface StrippedCursorMarkerResult {
	content: string;
	firstOffset: number | null;
}

/**
 * 返回正文的起始偏移：若内容以 frontmatter 开头，则跳过整个 frontmatter 块。
 * frontmatter 之外的正文从该偏移开始匹配标记（见方案 §8 决策 6）。
 */
export function resolveCursorMarkerSearchStart(content: string): number {
	const frontmatterMatch = content.match(FRONTMATTER_PATTERN);
	return frontmatterMatch ? frontmatterMatch[0].length : 0;
}

/**
 * 移除正文中出现的全部 `%%Cursor%%`（忽略大小写），并给出首个标记的起始偏移。
 *
 * - 仅在 frontmatter 之后匹配，frontmatter 内的标记原样保留；
 * - 无匹配时 `firstOffset` 为 `null`，`content` 原样返回；
 * - 偏移语义：基于返回的 `content`（即最终写入内容），首个标记开始的下标。
 */
export function stripCursorMarkers(
	content: string,
): StrippedCursorMarkerResult {
	const searchStart = resolveCursorMarkerSearchStart(content);
	const body = content.slice(searchStart);
	let match: RegExpExecArray | null;
	let firstOffset: number | null = null;
	let strippedBody = '';
	let lastMatchEnd = 0;

	CURSOR_MARKER_PATTERN.lastIndex = 0;
	while ((match = CURSOR_MARKER_PATTERN.exec(body)) !== null) {
		if (firstOffset === null) {
			firstOffset = searchStart + match.index;
		}
		strippedBody += body.slice(lastMatchEnd, match.index);
		lastMatchEnd = match.index + match[0].length;
	}

	if (firstOffset === null) {
		return { content, firstOffset: null };
	}

	strippedBody += body.slice(lastMatchEnd);
	return {
		content: content.slice(0, searchStart) + strippedBody,
		firstOffset,
	};
}
