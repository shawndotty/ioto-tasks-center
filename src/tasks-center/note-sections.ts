/**
 * 任务笔记的 Section 解析。
 *
 * 纯「字符串进 / 结构出」，零 DOM / 零 obsidian 运行时依赖，可被单测直接以 jiti
 * 导入（见 `tests/note-structure.test.mjs`），也可被 `data.ts` 复用。
 *
 * 三条解析口径（与 [[Plan-20261002-200615]] §5.1 一致）：
 * 1. frontmatter 整段排除，不算 Section；其后的引导正文单独成 level = 0 的块。
 * 2. 标题只在「非代码围栏 / 非注释」的行里才算。
 * 3. 每块带精确行范围（0 基、闭区间），供后续行级写回做外科手术。
 */

export interface NoteSection {
	/** 1..6；引导区为 0 */
	level: number;
	/** 标题文本（去掉 # 前缀与首尾空白与收尾的 #）；引导区为 '' */
	title: string;
	/** 块起始行（0 基，含）——标题行本身；引导区为首个正文行 */
	startLine: number;
	/** 块结束行（0 基，含）——下一个 level <= 本级的标题行 - 1；最后一块为文末 */
	endLine: number;
}

export interface CommentScanState {
	inObsidianComment: boolean;
	inHtmlComment: boolean;
}

export interface CommentScanResult {
	sanitized: string;
	nextInObsidianComment: boolean;
	nextInHtmlComment: boolean;
}

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;

/** 代码围栏起始。被 `note-checklist` 的 `collectChecklistItems` 共用，因此导出。 */
export const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

/**
 * 从一行里剥离 `%%…%%`（Obsidian 注释）与 `<!-- … -->`（HTML 注释）的内容，
 * 跨行状态由调用方通过 state / next* 维护。逻辑与旧 `data.ts` 内实现一致。
 */
export function stripCommentContentFromLine(
	line: string,
	state: CommentScanState,
): CommentScanResult {
	let sanitized = '';
	let cursor = 0;
	let nextInObsidianComment = state.inObsidianComment;
	let nextInHtmlComment = state.inHtmlComment;

	while (cursor < line.length) {
		if (nextInObsidianComment) {
			const commentEnd = line.indexOf('%%', cursor);
			if (commentEnd === -1) {
				return {
					sanitized,
					nextInObsidianComment: true,
					nextInHtmlComment,
				};
			}
			cursor = commentEnd + 2;
			nextInObsidianComment = false;
			continue;
		}

		if (nextInHtmlComment) {
			const commentEnd = line.indexOf('-->', cursor);
			if (commentEnd === -1) {
				return {
					sanitized,
					nextInObsidianComment,
					nextInHtmlComment: true,
				};
			}
			cursor = commentEnd + 3;
			nextInHtmlComment = false;
			continue;
		}

		const nextObsidianComment = line.indexOf('%%', cursor);
		const nextHtmlComment = line.indexOf('<!--', cursor);
		const hasObsidianComment = nextObsidianComment !== -1;
		const hasHtmlComment = nextHtmlComment !== -1;

		if (!hasObsidianComment && !hasHtmlComment) {
			sanitized += line.slice(cursor);
			break;
		}

		const nextCommentStart =
			hasObsidianComment && hasHtmlComment
				? Math.min(nextObsidianComment, nextHtmlComment)
				: hasObsidianComment
					? nextObsidianComment
					: nextHtmlComment;

		sanitized += line.slice(cursor, nextCommentStart);
		if (nextCommentStart === nextObsidianComment) {
			cursor = nextCommentStart + 2;
			nextInObsidianComment = true;
			continue;
		}

		cursor = nextCommentStart + 4;
		nextInHtmlComment = true;
	}

	return {
		sanitized,
		nextInObsidianComment,
		nextInHtmlComment,
	};
}

/**
 * 把整篇正文切成 Section。返回结果按行号升序；引导区（若有）在最前。
 */
export function parseSections(content: string): NoteSection[] {
	const lines = content.split(/\r?\n/);
	const headings: Array<{ level: number; title: string; line: number }> = [];

	let inObsidianComment = false;
	let inHtmlComment = false;
	let fenceChar = '';
	let fenceLength = 0;
	let frontmatterEndLine = -1;

	for (let index = 0; index < lines.length; index += 1) {
		const originalLine = lines[index] ?? '';
		const scanned = stripCommentContentFromLine(originalLine, {
			inObsidianComment,
			inHtmlComment,
		});
		inObsidianComment = scanned.nextInObsidianComment;
		inHtmlComment = scanned.nextInHtmlComment;
		const sanitized = scanned.sanitized;

		if (index === 0 && sanitized.trim() === '---') {
			frontmatterEndLine = findFrontmatterEndLine(lines);
			if (frontmatterEndLine > index) {
				index = frontmatterEndLine;
			}
			continue;
		}

		if (index <= frontmatterEndLine) {
			continue;
		}

		const fenceMatch = sanitized.match(FENCE_PATTERN);
		if (fenceMatch) {
			const marker = fenceMatch[1] ?? '';
			const char = marker[0] ?? '';
			if (!fenceChar) {
				fenceChar = char;
				fenceLength = marker.length;
			} else if (char === fenceChar && marker.length >= fenceLength) {
				fenceChar = '';
				fenceLength = 0;
			}
			continue;
		}

		if (fenceChar) {
			continue;
		}

		const headingMatch = sanitized.match(HEADING_PATTERN);
		if (!headingMatch) {
			continue;
		}

		headings.push({
			level: (headingMatch[1] ?? '').length,
			title: (headingMatch[2] ?? '').trim(),
			line: index,
		});
	}

	const sections: NoteSection[] = [];
	const bodyStartLine = frontmatterEndLine >= 0 ? frontmatterEndLine + 1 : 0;
	const firstHeadingLine =
		headings.length > 0 ? (headings[0]?.line ?? 0) : lines.length;

	let guideStartLine = -1;
	for (let index = bodyStartLine; index < firstHeadingLine; index += 1) {
		if ((lines[index] ?? '').trim().length > 0) {
			guideStartLine = index;
			break;
		}
	}

	if (guideStartLine !== -1) {
		sections.push({
			level: 0,
			title: '',
			startLine: guideStartLine,
			endLine: firstHeadingLine - 1,
		});
	}

	headings.forEach((heading, headingIndex) => {
		let endLine = lines.length - 1;
		for (
			let nextIndex = headingIndex + 1;
			nextIndex < headings.length;
			nextIndex += 1
		) {
			const nextHeading = headings[nextIndex];
			if (nextHeading && nextHeading.level <= heading.level) {
				endLine = nextHeading.line - 1;
				break;
			}
		}

		sections.push({
			level: heading.level,
			title: heading.title,
			startLine: heading.line,
			endLine,
		});
	});

	return sections;
}

/**
 * 按标题精确匹配（去两侧空白）找到最靠前的 Section；找不到返回 `null`。
 * 仅匹配真标题块（level > 0）；引导区标题为 `''`，不会被命中。
 */
export function findSectionByTitle(
	content: string,
	title: string,
): NoteSection | null {
	const target = title.trim();
	for (const section of parseSections(content)) {
		if (section.level > 0 && section.title.trim() === target) {
			return section;
		}
	}

	return null;
}

function findFrontmatterEndLine(lines: string[]): number {
	for (let index = 1; index < lines.length; index += 1) {
		if ((lines[index] ?? '').trim() === '---') {
			return index;
		}
	}

	// 未闭合的 frontmatter：只把首行当作分隔线，避免吞掉整篇正文。
	return 0;
}
