/**
 * 主任务区（Primary Task Section）的纯函数层。
 *
 * 语义：笔记 frontmatter 的 `ioto-primary-task-section` 指向一个顶层 Section 标题，
 * 「添加任务」优先落到该 Section 的**末尾**（[[Plan-20261024-072014]] §3 S2）。
 *
 * 零 DOM / 零 obsidian 运行时依赖（只经 `frontmatter-properties` 间接引类型），
 * 可被 jiti 单测直接导入。
 */

import { readQuotedScalarProperty } from './frontmatter-properties';
import { findSectionByTitle, type NoteSection } from './note-sections';

/** 主任务区标记的属性名：跨插件语义型属性统一 kebab + `ioto-` 前缀。 */
export const PRIMARY_SECTION_PROPERTY = 'ioto-primary-task-section';

export type PrimarySectionRef =
	| { status: 'none' }
	| { status: 'ok'; section: NoteSection }
	| { status: 'missing'; title: string };

/** 读标记标题；缺失或空串 → `null`。 */
export function readPrimarySectionTitle(content: string): string | null {
	const title = readQuotedScalarProperty(content, PRIMARY_SECTION_PROPERTY);
	if (title === null) {
		return null;
	}
	const trimmed = title.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/** 把标记解析成三态：未标记 / 命中 / 有值但找不到同名节。 */
export function resolvePrimarySection(content: string): PrimarySectionRef {
	const title = readPrimarySectionTitle(content);
	if (title === null) {
		return { status: 'none' };
	}
	const section = findSectionByTitle(content, title);
	if (!section) {
		return { status: 'missing', title };
	}
	return { status: 'ok', section };
}

export interface SectionEndInsertion {
	/** 被替换/定位的行号（空节 = 标题行，有内容 = 最后一个非空行） */
	line: number;
	/** 该行快照（喂 commitTaskLineAction 做二次定位） */
	originalLine: string;
	/** 该行应替换成的行 */
	nextLines: string[];
	/** 新任务首行的行号（喂 runLineAction 的 nextEditLine） */
	nextEditLine: number;
}

/**
 * 计算「插入到 Section 末尾」所需的单点替换。
 *
 * 口径（[[Plan-20261024-072014]] §3 S2）：
 * 1. `bodyStart = startLine + 1`（只标记顶层节）；
 * 2. 从 `endLine` 向前找最后一个非空行 `L`；
 * 3. 空节 → 替换标题行，`nextEditLine = startLine + 1`（与 `appendTaskBlock` 的
 *    `[heading, ...buildNewLines('- ')]` 逐字一致，中间不留空行）；
 * 4. 有内容 → 替换 `L` 为 `[raw, '', ...newLines]`，`nextEditLine = L + 2`；
 * 5. 仅当 `L === endLine && endLine < lines.length - 1`（下一行直接是下一个标题、
 *    原本没有空行）时尾部补一个 `''`，保证「新任务行 ↔ 下一个标题行」一个空行；
 *    本来就有块间空行或已是 EOF 时不补。
 */
export function computeSectionEndInsertion(
	content: string,
	section: NoteSection,
	newLines: readonly string[],
): SectionEndInsertion {
	const lines = content.split(/\r?\n/);
	const bodyStart = section.startLine + 1;

	let lastLine = -1;
	for (let index = section.endLine; index >= bodyStart; index -= 1) {
		if ((lines[index] ?? '').trim() !== '') {
			lastLine = index;
			break;
		}
	}

	if (lastLine === -1) {
		const heading = lines[section.startLine] ?? '';
		return {
			line: section.startLine,
			originalLine: heading,
			nextLines: [heading, ...newLines],
			nextEditLine: bodyStart,
		};
	}

	const raw = lines[lastLine] ?? '';
	const tail: string[] =
		lastLine === section.endLine && section.endLine < lines.length - 1
			? ['']
			: [];
	const nextLines = [raw, '', ...newLines, ...tail];

	return {
		line: lastLine,
		originalLine: raw,
		nextLines,
		nextEditLine: lastLine + 2,
	};
}
