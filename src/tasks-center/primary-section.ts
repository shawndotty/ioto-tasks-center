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

/** 行首是列表标记（`-` / `*` / `+` / `1.`）或标题 → 新任务可以紧贴其后开始。 */
const LIST_OR_HEADING_PATTERN = /^\s*(?:[-*+]|\d+[.)])(?:\s|$)|^\s*#{1,6}\s/;

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
	/**
	 * 定位行之后还要整块丢弃的行数（= 原节尾空行池）。
	 * 由 commit 层保证「只吞空白行」，行漂移时宁可少删（[[Plan-20261029-150938]] §二 口径 3）。
	 */
	dropFollowingLines: number;
}

/**
 * 计算「插入到 Section 末尾」所需的单点替换。
 *
 * 口径（[[Plan-20261029-150938]] §二 修订 [[Plan-20261024-072014]] §3 S2）：
 * 1. `bodyStart = startLine + 1`（只标记顶层节）；
 * 2. 从 `endLine` 向前找最后一个非空行 `L`；
 * 3. 空节 → 替换标题行，`nextEditLine = startLine + 1`，不插空行（口径不变）；
 * 4. 有内容 → 替换 `L` 为 `[raw, ...(需要时的 1 个空行), ...newLines, ...节尾空行]`：
 *    - `L` 是列表行/标题行 → 不插空行（tight list 不断开）；
 *    - `L` 是段落等非列表块 → 插 1 个空行（空列表项不能打断段落，CommonMark）；
 *    - 节后还有下一个标题 → 结尾固定 1 个空行；EOF → 仅保留原有文末换行；
 *    - `nextEditLine = L + 1 + (插了空行 ? 1 : 0)`；
 * 5. 同时返回 `dropFollowingLines` = 紧随 `L` 的连续空白行数，把 `L` 到节尾之间原有的空行池
 *    整块丢弃（含「加了又删」累积出来的那部分），由 commit 层按「只吞空白」执行；
 *    文末那个 `''` 只是「文件以换行收尾」的产物，不计入池子。
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
			dropFollowingLines: 0,
		};
	}

	const raw = lines[lastLine] ?? '';
	// 口径 4：紧贴列表行/标题行 → 零空行；否则（段落/引用/表格）必须留 1 个，
	// 空列表项无法打断段落，`- ` 会被 Markdown 当成上一段的懒续行。
	const blankBefore: string[] = LIST_OR_HEADING_PATTERN.test(raw) ? [] : [''];
	// 文末那个 `''` 是「文件以换行收尾」在 split 后的产物，不是空行池：既不补也不吞，
	// 否则写回会丢掉文件末尾的换行（节末 = EOF 时的实际踩坑点）。
	const lastIndex = lines.length - 1;
	const poolEnd =
		section.endLine === lastIndex && (lines[lastIndex] ?? '') === ''
			? lastIndex - 1
			: section.endLine;
	// 节后还有下一个标题 → 收尾固定 1 个空行；EOF → 仅保留原有文末换行（不新增）。
	const blankAfter: string[] =
		section.endLine < lastIndex || poolEnd > lastLine ? [''] : [];
	// 紧随 L 的连续空白行数 = 存量空行池（含「加了又删」累积的），交给 commit 层按数吞掉。
	let dropFollowingLines = 0;
	for (let index = lastLine + 1; index <= poolEnd; index += 1) {
		if ((lines[index] ?? '').trim() !== '') {
			break;
		}
		dropFollowingLines += 1;
	}
	const nextLines = [raw, ...blankBefore, ...newLines, ...blankAfter];

	return {
		line: lastLine,
		originalLine: raw,
		nextLines,
		nextEditLine: lastLine + 1 + blankBefore.length,
		dropFollowingLines,
	};
}
