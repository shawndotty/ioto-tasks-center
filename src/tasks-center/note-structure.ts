/**
 * 任务笔记的结构解析原语。
 *
 * 纯粹的「字符串进 / 结构出」函数，零 DOM、零 obsidian 运行时依赖，因此可被
 * 单测直接以 jiti 导入（见 `tests/note-structure.test.mjs`），也可被 `data.ts`
 * 复用，保证「注释剥离」「任务行匹配」只有一份实现。
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

/** 条目控制项类别（v1 锁定集合，见 [[Plan-20261003-162429]] §二）。 */
export type ControlKind =
	| 'depends' // #ioto/depends/N 或 depends：[[…]]
	| 'agent' // #ioto/agent/<id>
	| 'model' // #ioto/model/<id> 或 [model:: <id>]
	| 'fanout' // #ioto/fanout 或 #ioto/fanout/N
	| 'turns'; // #ioto/turns/<N>

/** 一条控制项：`raw` 逐字节保留用于无损写回，`value` 供渲染层展示。 */
export interface ControlToken {
	kind: ControlKind;
	/** 原文片段，逐字节保留（含 `depends：` / `#ioto/…` / `[model:: …]` 全串） */
	raw: string;
	/** 解析出的值：depends=string[]、fanout=true|number、turns=number、agent/model=string */
	value: string | number | true | string[];
}

export interface NoteChecklistItem {
	/** 0 基行号 */
	line: number;
	/** ' ' | 'x' | 'X' */
	marker: string;
	/** checkbox 之后的原文（未 trim），供上层计算字符偏移 */
	rawText: string;
	/** 展示用正文：去前缀、两侧 trim、并剥离本行所有控制项 */
	text: string;
	/** 缩进层级（0 基）：每 2 空格或 1 个 Tab 记 1 级 */
	indentLevel: number;
	/** 本行控制项（执行元数据，卡片正文不显示，投影到动作区徽章） */
	controls: ControlToken[];
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

export const TASK_LINE_PATTERN = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\](.*)$/;

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})/;

/* ------------------------------------------------------------------ *
 * 控制项扫描器（[[Plan-20261003-162429]] §3.2）
 *
 * 有序数组；每条「行内、非跨行」匹配。正则集中在此、不散落视图层，
 * 由 `tests/task-controls.test.mjs` 单测锁定。
 * ------------------------------------------------------------------ */

interface ControlScanner {
	kind: ControlKind;
	/** 必须带 `g` 标志，供逐条 exec 收集全部命中 */
	pattern: RegExp;
	build: (match: RegExpExecArray) => ControlToken['value'];
}

const CONTROL_SCANNERS: ControlScanner[] = [
	{
		kind: 'depends',
		pattern:
			/depends\s*[：:]\s*(\[\[[^\]]+\]\](?:\s*[、,]\s*\[\[[^\]]+\]\])*)/g,
		build: (match) =>
			Array.from(match[1]?.matchAll(/\[\[([^\]]+)\]\]/g) ?? [], (link) =>
				link[1] ?? '',
			),
	},
	{
		kind: 'depends',
		pattern: /#ioto\/depends\/(\d+)/g,
		build: (match) => Number(match[1]),
	},
	{
		kind: 'agent',
		pattern: /#ioto\/agent\/([^\s#]+)/g,
		build: (match) => match[1] ?? '',
	},
	{
		kind: 'model',
		pattern: /\[model\s*::\s*([^\]]+)\]/g,
		build: (match) => (match[1] ?? '').trim(),
	},
	{
		kind: 'model',
		pattern: /#ioto\/model\/([^\s#]+)/g,
		build: (match) => match[1] ?? '',
	},
	{
		kind: 'fanout',
		pattern: /#ioto\/fanout(?:\/(\d+))?/g,
		build: (match) => (match[1] === undefined ? true : Number(match[1])),
	},
	{
		kind: 'turns',
		pattern: /#ioto\/turns\/(\d+)/g,
		build: (match) => Number(match[1]),
	},
];

interface ScannedControl {
	token: ControlToken;
	start: number;
	end: number;
}

/**
 * 扫描 `core`，按出现顺序收集控制项；重叠区间只保留「更早出现」者。
 * 所有匹配区间都不跨行（正则本身不含换行）。
 */
function scanControls(core: string): ScannedControl[] {
	const hits: ScannedControl[] = [];

	for (const scanner of CONTROL_SCANNERS) {
		scanner.pattern.lastIndex = 0;
		let match = scanner.pattern.exec(core);
		while (match) {
			hits.push({
				token: {
					kind: scanner.kind,
					raw: match[0],
					value: scanner.build(match),
				},
				start: match.index,
				end: match.index + match[0].length,
			});
			if (match[0].length === 0) {
				scanner.pattern.lastIndex += 1;
			}
			match = scanner.pattern.exec(core);
		}
	}

	hits.sort((a, b) => a.start - b.start || b.end - a.end);

	const accepted: ScannedControl[] = [];
	let lastEnd = -1;
	for (const hit of hits) {
		if (hit.start < lastEnd) {
			continue;
		}
		accepted.push(hit);
		lastEnd = hit.end;
	}

	return accepted;
}

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

export interface ParseChecklistOptions {
	/**
	 * 是否把「正文为空」的 checklist 行也当作条目。
	 * 默认 `false`（与 v1 语义 / 任务状态统计一致）；IOTOTask 视图传 `true`，
	 * 这样 `Enter` 新建的空卡片才有 DOM 可落脚、光标能进得去。
	 */
	includeEmpty?: boolean;
}

export function parseChecklistItems(
	content: string,
	options?: ParseChecklistOptions,
): NoteChecklistItem[] {
	return collectChecklistItems(
		content,
		0,
		Number.POSITIVE_INFINITY,
		options?.includeEmpty ?? false,
	);
}

export function parseChecklistItemsInRange(
	content: string,
	startLine: number,
	endLine: number,
	options?: ParseChecklistOptions,
): NoteChecklistItem[] {
	if (endLine < startLine) {
		return [];
	}

	return collectChecklistItems(
		content,
		startLine,
		endLine,
		options?.includeEmpty ?? false,
	);
}

/* ------------------------------------------------------------------ *
 * 视图过滤谓词（[[Plan-20261004-110845]] 批次 B/C）
 *
 * 纯函数：只吃解析结果，零 obsidian 依赖，供 IOTOTask 视图与单测共用。
 * ------------------------------------------------------------------ */

/** 该条目是否已完成（`[x]` / `[X]`）。 */
export function isChecklistItemDone(item: NoteChecklistItem): boolean {
	return item.marker.toLowerCase() === 'x';
}

/**
 * 该 Section（Block）体内是否含 Markdown 任务列表。
 *
 * 与渲染层 `renderSectionBody` 同一口径取正文起点：引导区（level 0）从
 * `startLine` 起，标题块从标题行下一行起；`endLine` 已覆盖嵌套子标题内容，
 * 因此「任务只写在嵌套子标题里」的父块也会判为任务区块。
 * `includeEmpty: true`：空骨架任务行（`- [ ] `）同样算数。
 */
export function sectionHasChecklist(
	content: string,
	section: NoteSection,
): boolean {
	const bodyStartLine =
		section.level === 0 ? section.startLine : section.startLine + 1;
	return (
		parseChecklistItemsInRange(content, bodyStartLine, section.endLine, {
			includeEmpty: true,
		}).length > 0
	);
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

/* ------------------------------------------------------------------ *
 * 卡片续行（CommonMark lazy continuation）
 *
 * Markdown View 里在任务项下面 Shift+Enter 敲出来的正文，CommonMark 视作该
 * list item 的一部分 —— 缩进续行与「不缩进的懒续行」都算。渲染层必须把它并回
 * 卡片，而不是当成章节级 markdown 块（否则会渲染成 `<ul>` 之外的孤儿块）。
 * ------------------------------------------------------------------ */

/**
 * 非列表的块级结构起始：遇到即**不再是**续行（CommonMark 里这些会打断段落 /
 * 结束 list item）。
 */
const BLOCK_START_PATTERNS: RegExp[] = [
	/^#{1,6}(?:\s|$)/, // ATX 标题
	/^(?:`{3,}|~{3,})/, // 代码围栏
	/^>/, // 引用
];

/**
 * 列表标记（无序 / 有序）。是否算续行由「相对父任务行的缩进」决定：比父任务行
 * 更深才算续行，否则维持「章节级列表」语义（见 `isTaskContinuationLine`）。
 */
const LIST_MARKER_PATTERN = /^(?:[-*+]|\d+[.)])(?:\s|$)/;

/** 分隔线（`---` / `***` / `___`，允许中间夹空白）。 */
const THEMATIC_BREAK_PATTERN = /^(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;

/**
 * 该行能否作为上一张任务卡的**续行**。
 *
 * 口径：非空 + 不是块级结构起始（标题 / 围栏 / 引用 / 分隔线）。空行返回
 * `false` —— CommonMark 里「空行 + 非缩进内容」会结束 list item，因此空行之后
 * 的内容属于 Section 而非某张卡。
 *
 * 列表行（无序 / 有序）特殊处理：**比父任务行更深**才算续行（缩进列表落回卡片
 * 续写区，渲染成正常列表）；与父同级 / 更浅则维持「章节级列表」语义。
 * `parentIndentLevel` 缺省为 `+Infinity`，此时任何列表行都不算续行，与旧行为
 * 逐字一致（老调用方无需改动）。
 *
 * ⚠️ 任务行（`- [ ]` / 嵌套子任务）永远不算续行：嵌套由行号 / 层级语义处理；
 * 否则父卡会把缩进的**子任务**吞进续写区（部分调用点没有 `itemLines` 排除）。
 */
export function isTaskContinuationLine(
	line: string,
	parentIndentLevel = Number.POSITIVE_INFINITY,
): boolean {
	const trimmed = line.trim();
	if (trimmed.length === 0) {
		return false;
	}
	if (THEMATIC_BREAK_PATTERN.test(trimmed)) {
		return false;
	}

	const trimmedStart = line.trimStart();
	if (LIST_MARKER_PATTERN.test(trimmedStart)) {
		// ① 任务行（含嵌套子任务）不算续行，交回行号 / 层级语义处理。
		if (splitTaskLine(line) !== null) {
			return false;
		}
		// ② 普通列表：比父任务行更深才算续行，否则维持章节级列表语义。
		return computeIndentLevel(line) > parentIndentLevel;
	}

	return !BLOCK_START_PATTERNS.some((pattern) => pattern.test(trimmedStart));
}

/**
 * 父任务行的缩进层级，供续行判定比较。
 * 非任务行 / 空行 → `+Infinity`（任何列表行都不算续行，保持旧行为兜底）。
 *
 * 缩进口径复用解析层 `indentLevelOf`（2 空格 / 1 Tab = 1 级），与
 * `NoteChecklistItem.indentLevel` 一致。
 */
export function parentIndentLevelOfTaskLine(line: string): number {
	const parts = splitTaskLine(line);
	return parts ? indentLevelOf(parts.indent) : Number.POSITIVE_INFINITY;
}

/**
 * 为一批卡片收集各自的续行行号（0 基、升序、连续）。
 *
 * 每张卡从其下一行开始向下吃：遇到另一条 checklist 行、空行、或块级结构即停。
 * 比任务行更深的缩进列表算续行（落回卡片续写区），顶格 / 同级列表仍算章节级。
 * 返回「卡片行号 → 续行行号数组」；无续行的卡不出现在结果里。
 *
 * @param limitLine 可解析的最后一行（0 基，含）——通常是所属 Section 的 `endLine`。
 */
export function collectTaskContinuations(
	content: string,
	items: NoteChecklistItem[],
	limitLine: number,
): Map<number, number[]> {
	const lines = content.split(/\r?\n/);
	const itemLines = new Set(items.map((item) => item.line));
	const result = new Map<number, number[]>();

	for (const item of items) {
		const continuation: number[] = [];
		for (let index = item.line + 1; index <= limitLine; index += 1) {
			if (itemLines.has(index)) {
				break;
			}
			if (!isTaskContinuationLine(lines[index] ?? '', item.indentLevel)) {
				break;
			}
			continuation.push(index);
		}

		if (continuation.length > 0) {
			result.set(item.line, continuation);
		}
	}

	return result;
}

/**
 * 续行去缩进时的 Tab 列宽（CommonMark 口径：Tab 推进到下一个 4 的倍数）。
 * 与层级口径 `indentLevelOf`（2 空格 / 1 Tab = 1 级）用途不同，勿混用。
 */
const CONTINUATION_TAB_WIDTH = 4;

/** 一行文本的前导空白（空格 / Tab）。 */
function leadingWhitespaceOf(line: string): string {
	return line.match(/^[ \t]*/)?.[0] ?? '';
}

/** 前导空白的可视列宽：Tab 推进到下一个 4 的倍数。 */
function leadingColumnWidth(whitespace: string): number {
	let width = 0;
	for (const char of whitespace) {
		width +=
			char === '\t'
				? CONTINUATION_TAB_WIDTH - (width % CONTINUATION_TAB_WIDTH)
				: 1;
	}
	return width;
}

/**
 * 从一行前导空白里按**列**剥掉 `columns` 列。
 * 返回被剥掉的原文字符串，以及剥完后仍残留的列数（跨列的 Tab 拆成空格余量）。
 */
function stripColumns(
	whitespace: string,
	columns: number,
): { removed: string; residual: number } {
	let position = 0;
	let cursor = 0;
	while (cursor < whitespace.length && position < columns) {
		const char = whitespace[cursor];
		position +=
			char === '\t'
				? CONTINUATION_TAB_WIDTH - (position % CONTINUATION_TAB_WIDTH)
				: 1;
		cursor += 1;
	}
	return {
		removed: whitespace.slice(0, cursor),
		residual: Math.max(0, leadingColumnWidth(whitespace) - columns),
	};
}

/**
 * 卡片续行渲染前的「列宽感知去缩进」。
 *
 * 与按字符求公共前缀不同：按**可视列宽**求公共缩进，于是「空格对齐的段落」与
 * 「Tab 缩进的列表」混在一张卡里时也能整体 dedent（按字符求首字符不同 → 公共
 * 前缀 = '' → 整块不 dedent → 段落与列表都被判成缩进代码块）。
 *
 * - `minColumns` = 所有非空行前导空白列宽的**最小值**；为 0（无公共缩进）时原样返回；
 * - 每行按列剥离 `minColumns` 列；跨列的 Tab 拆成空格余量（残余统一以空格表示）；
 * - **非列表行**残余 ≥4 列会被独立渲染判成缩进代码块 → 夹到 0；**列表行**保留
 *   残余，维持嵌套层级；
 * - `removed[i]` = 第 i 行实际被剥掉的前导空白，供写回按行还原（见
 *   `commitTaskContinuation`）。
 *
 * 极端取舍：「半 Tab 跨越切点」的混合缩进无法逐字节还原，此时只丢空白形态、
 * 不丢正文内容。
 */
export function dedentContinuationLines(inputLines: string[]): {
	text: string;
	removed: string[];
} {
	const removed = inputLines.map(() => '');
	const nonEmpty = inputLines.filter((line) => line.trim().length > 0);
	if (nonEmpty.length === 0) {
		return { text: inputLines.join('\n'), removed };
	}

	const minColumns = Math.min(
		...nonEmpty.map((line) => leadingColumnWidth(leadingWhitespaceOf(line))),
	);
	if (minColumns === 0) {
		// 无公共缩进：原样返回（避免把 Tab 规整成空格）
		return { text: inputLines.join('\n'), removed };
	}

	const text = inputLines
		.map((line, index) => {
			if (line.trim().length === 0) {
				return line;
			}
			const whitespace = leadingWhitespaceOf(line);
			const rest = line.slice(whitespace.length);
			const { removed: stripped, residual } = stripColumns(
				whitespace,
				minColumns,
			);
			const isList = LIST_MARKER_PATTERN.test(line.trimStart());
			const keep =
				isList || residual < CONTINUATION_TAB_WIDTH ? residual : 0;
			// keep = 0 且仍有残余（非列表行被夹平）时整段前导空白都算被剥掉，
			// 这样写回按 removed 补回即可无损还原。
			removed[index] = residual > keep ? whitespace : stripped;
			return ' '.repeat(keep) + rest;
		})
		.join('\n');

	return { text, removed };
}

/**
 * 抹掉一段多行文本的**公共前导缩进**（dedent），返回处理后的文本。
 *
 * 用于卡片续行：任务项下 `Shift+Enter` 敲出来的正文带着列表自动缩进，而渲染层是
 * **独立**渲染这几行的（没有外层 `<ul>` 语境），行首 ≥4 空格会被 Markdown 判成
 * 缩进代码块（`<pre><code>`，格式全失效还多一个复制按钮）。剥掉公共缩进即可还原。
 *
 * 是 `dedentContinuationLines` 的薄封装（只取 `text`）；编辑回写需要按行还原时
 * 请直接用 `dedentContinuationLines`。
 */
export function dedentLines(text: string): string {
	return dedentContinuationLines(text.split(/\r?\n/)).text;
}

/**
 * 一组文本行的**公共前导空白**（只看非空行；无公共前缀返回 `''`）。
 *
 * 续行写回（`commitTaskContinuation`）在「行数变化、无法按行还原」时用它兜底
 * 补回缩进——编辑器持有的是 dedent 后文本，提交时按原块公共前缀补回。
 * 常规（行数不变）路径优先用 `dedentContinuationLines` 的 `removed` 逐行还原。
 */
export function commonIndentPrefix(lines: string[]): string {
	const indents = lines
		.filter((line) => line.trim().length > 0)
		.map((line) => line.match(/^[ \t]*/)?.[0] ?? '');

	if (indents.length === 0) {
		return '';
	}

	let common = indents[0] ?? '';
	for (const indent of indents) {
		let length = 0;
		while (
			length < common.length &&
			length < indent.length &&
			common[length] === indent[length]
		) {
			length += 1;
		}
		common = common.slice(0, length);
		if (common.length === 0) {
			break;
		}
	}

	return common;
}

function collectChecklistItems(
	content: string,
	startLine: number,
	endLine: number,
	includeEmpty: boolean,
): NoteChecklistItem[] {
	const lines = content.split(/\r?\n/);
	const items: NoteChecklistItem[] = [];
	const from = Math.max(0, startLine);
	const to = Math.min(lines.length - 1, endLine);

	let inObsidianComment = false;
	let inHtmlComment = false;
	let fenceChar = '';
	let fenceLength = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const originalLine = lines[index] ?? '';
		const scanned = stripCommentContentFromLine(originalLine, {
			inObsidianComment,
			inHtmlComment,
		});
		inObsidianComment = scanned.nextInObsidianComment;
		inHtmlComment = scanned.nextInHtmlComment;
		const sanitized = scanned.sanitized;

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

		if (index < from || index > to) {
			continue;
		}

		if (sanitized.trim().length === 0) {
			continue;
		}

		const match = sanitized.match(TASK_LINE_PATTERN);
		if (!match) {
			continue;
		}

		const rawText = match[2] ?? '';
		if (!includeEmpty && rawText.trim().length === 0) {
			continue;
		}

		const { text, controls } = splitDisplayText(rawText);
		items.push({
			line: index,
			marker: match[1] ?? ' ',
			rawText,
			text,
			indentLevel: computeIndentLevel(originalLine),
			controls,
		});
	}

	return items;
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

function splitDisplayText(rawTaskContent: string): {
	text: string;
	controls: ControlToken[];
} {
	const core = rawTaskContent.trim();
	const scanned = scanControls(core);
	if (scanned.length === 0) {
		return { text: core, controls: [] };
	}

	// 用哨兵标记被剥离的控制项区间，再把「哨兵两侧的空白」收敛成单个空格，
	// 这样只会吃掉接缝处的空白，正文内部的多空格保持不变。
	// 哨兵选私有使用区字符（非控制字符，且正文里不会出现）。
	const SENTINEL = '\uE000';
	let marked = '';
	let cursor = 0;
	for (const hit of scanned) {
		marked += core.slice(cursor, hit.start) + SENTINEL;
		cursor = hit.end;
	}
	marked += core.slice(cursor);

	const text = marked
		.replace(/\s*\uE000(?:\s*\uE000)*\s*/g, ' ')
		.replace(/\uE000/g, '')
		.trim();
	return { text, controls: scanned.map((hit) => hit.token) };
}

function computeIndentLevel(line: string): number {
	const leadingWhitespace = line.match(/^[ \t]*/)?.[0] ?? '';
	return indentLevelOf(leadingWhitespace);
}

/* ------------------------------------------------------------------ *
 * 编辑原语（[[Plan-20261003-073911]] §5.1）
 *
 * 全部是纯字符串函数：`line → line | null`，`null` 表示「不是任务行 / 不匹配」。
 * 与解析层共用同一套缩进口径（`indentLevelOf`），保证「Tab 一次」与视图里
 * 看到的层级不会漂。
 * ------------------------------------------------------------------ */

/** 一行任务拆成可无损重组的各段。 */
export interface TaskLineParts {
	/** 前导空白，原样保留（Tab 也原样保留） */
	indent: string;
	/** 列表符号（含其后空白）：`- ` / `* ` / `+ ` / `1. ` */
	listMarker: string;
	/** 勾选态 */
	checked: ' ' | 'x' | 'X';
	/** `]` 之后的空白 */
	gap: string;
	/** 展示正文（已剥离 controls），两侧 trim */
	body: string;
	/** 本行控制项（行中 / 行尾一律收集） */
	controls: ControlToken[];
	/** 原始 core（未剥离），仅用于「未改动正文逐字节还原」 */
	source: string;
	/** 原始 core 的展示正文；`body === sourceText` 即判定「未改动」 */
	sourceText: string;
	/** 行尾空白（含 CRLF 的 `\r`），原样保留 */
	trail: string;
}

const TASK_LINE_PARTS_PATTERN =
	/^([ \t]*)((?:[-*+]|\d+\.)[ \t]+)\[([ xX])\]([ \t]*)([\s\S]*)$/;

/** 缩进宽度换算：每 2 空格或 1 个 Tab 记 1 级（与解析层一致）。 */
export function indentLevelOf(indent: string): number {
	let width = 0;
	for (const char of indent) {
		width += char === '\t' ? 2 : 1;
	}

	return Math.floor(width / 2);
}

function indentStringForLevel(level: number): string {
	return '  '.repeat(Math.max(0, level));
}

/** 把一行任务拆成可无损重组的各段；不是任务行时返回 `null`。 */
export function splitTaskLine(line: string): TaskLineParts | null {
	const match = line.match(TASK_LINE_PARTS_PATTERN);
	if (!match) {
		return null;
	}

	const rest = match[5] ?? '';
	const trailMatch = rest.match(/[ \t\r]*$/);
	const trail = trailMatch ? trailMatch[0] : '';
	const core = rest.slice(0, rest.length - trail.length);
	const { text, controls } = splitDisplayText(core);

	return {
		indent: match[1] ?? '',
		listMarker: match[2] ?? '',
		checked: (match[3] ?? ' ') as ' ' | 'x' | 'X',
		gap: match[4] ?? '',
		body: text,
		controls,
		source: core,
		sourceText: text,
		trail,
	};
}

/**
 * 任务行的续行缩进：让续行正文与任务正文**左对齐**（`- [ ] 甲` → 6 空格）。
 *
 * 复用 `splitTaskLine`；非任务行返回 `null`。`indent` 原样保留（含 Tab），只在
 * 「列表符号 + `[x]` + gap」上补空格，避免嵌套层级漂移。用于「新建续写区」时从
 * **任务行**推导缩进——`commonIndentPrefix([])` 恒为 `''`，不能沿用空块前缀。
 */
export function continuationIndentForTaskLine(line: string): string | null {
	const parts = splitTaskLine(line);
	if (!parts) {
		return null;
	}
	// listMarker 已含其后空白；`[x]` 恒 3 字符（'[' + 勾选位 + ']'）；gap 是 `]` 之后的空白。
	return (
		parts.indent + ' '.repeat(parts.listMarker.length + 3 + parts.gap.length)
	);
}

/** 把编辑器正文按给定缩进展开成续行物理行（空行保持空行）。 */
export function indentContinuationLines(
	nextText: string,
	indent: string,
): string[] {
	return nextText
		.split('\n')
		.map((line) => (line.trim().length === 0 ? '' : indent + line));
}

/**
 * 面板写回后，内联编辑器应持有的正文：剥离本行**所有**控制项
 * （`depends：` / `[model::]` / `#ioto/*`）；非任务行返回 `null`。
 * 修复 [[Plan-20261003-141212]]：写回成功后 re-seed 编辑器，避免随后的 blur
 * 提交用旧正文重建整行而抹掉面板所选控制项。
 */
export function taskBodyForEditor(line: string): string | null {
	return splitTaskLine(line)?.body ?? null;
}

/**
 * `splitTaskLine` 的逆运算，双通道：
 * - `body === sourceText`（正文未改动）→ 逐字节还原 `source`；
 * - 否则规范化：正文 + 控制项按原序拼到行尾（Johnny 已确认「输入即归位」）。
 */
export function composeTaskLine(parts: TaskLineParts): string {
	let core: string;
	if (parts.body === parts.sourceText) {
		core = parts.source;
	} else {
		const controlText = parts.controls.map((control) => control.raw).join(' ');
		core = `${parts.body.trim()}${
			controlText.length > 0 ? ` ${controlText}` : ''
		}`;
	}
	return `${parts.indent}${parts.listMarker}[${parts.checked}]${parts.gap}${core}${parts.trail}`;
}

/**
 * 3b 提交：只换正文，原样保留 indent / listMarker / checked / gap / trail，
 * 并把原行控制项拼回正文之后（正文未改动时逐字节还原）。正文含换行时拒绝。
 */
export function replaceTaskBody(line: string, nextBody: string): string | null {
	if (nextBody.includes('\n')) {
		return null;
	}

	const parts = splitTaskLine(line);
	if (!parts) {
		return null;
	}

	return composeTaskLine({ ...parts, body: nextBody.trim() });
}

/** 标题行内换行的唯一字面量（Q3：不带自闭合斜杠）。 */
export const SOFT_BREAK = '<br>';

/**
 * 在 `[from, to)` 处用 `<br>` 替换选区，返回新文本与新光标位。
 * 纯函数：零 obsidian / 零 DOM，`tests/` 直接 jiti 导入断言。
 *
 * 写回仍是**单行**（不含 `\n`），因此 `replaceTaskBody` 的换行守卫不会拦它。
 */
export function insertSoftBreak(
	value: string,
	from: number,
	to: number,
): { value: string; cursor: number } {
	const start = Math.min(Math.max(from, 0), value.length);
	const end = Math.min(Math.max(to, start), value.length);
	return {
		value: value.slice(0, start) + SOFT_BREAK + value.slice(end),
		cursor: start + SOFT_BREAK.length,
	};
}

/** 3a 勾选：`' '` ↔ `'x'`，`'X'` 视作已勾选 → 切到 `' '`，其余字节一律不动。 */
export function toggleTaskMarker(line: string): string | null {
	const parts = splitTaskLine(line);
	if (!parts) {
		return null;
	}

	const checked: ' ' | 'x' = parts.checked.toLowerCase() === 'x' ? ' ' : 'x';
	return composeTaskLine({ ...parts, checked });
}

/**
 * 3c-3 缩进：`delta = ±1` 级，clamp 到 `[0, maxLevel]`。
 * 输出统一为「每级 2 空格」（Tab 会被规整，属已知取舍）；缩进一律**重算**
 * 而不是在原字符串上加/减，避免混用导致层级错乱。
 */
export function setTaskIndent(
	line: string,
	delta: number,
	maxLevel = 8,
): string | null {
	const parts = splitTaskLine(line);
	if (!parts) {
		return null;
	}

	const upper = Math.max(0, maxLevel);
	const nextLevel = Math.min(
		Math.max(indentLevelOf(parts.indent) + delta, 0),
		upper,
	);
	return composeTaskLine({
		...parts,
		indent: indentStringForLevel(nextLevel),
	});
}

/**
 * 3c-1 新建同级：给定参考行，产出「同 indent / 同列表符号 / 同 trail」的新行；
 * `text` 为空则返回纯骨架；不继承任何控制项（`controls` 清空，`source` 与
 * `sourceText` 显式对齐 `body`，保证走「逐字节还原」通道）。
 */
export function buildSiblingTaskLine(
	referenceLine: string,
	text: string,
	marker: ' ' | 'x' = ' ',
): string | null {
	const parts = splitTaskLine(referenceLine);
	if (!parts) {
		return null;
	}

	const body = text.trim();
	return composeTaskLine({
		...parts,
		checked: marker,
		body,
		controls: [],
		source: body,
		sourceText: body,
	});
}

/**
 * 「添加任务」专用：拼出 `# <title>` 标题行（一号标题）。
 *
 * 语言包里只存**裸标题**（`任务` / `Tasks` / `任務`），因为 `findSectionByTitle`
 * 按去 `#` 的标题文本精确匹配；写进笔记时必须补 `# `，否则建出的是普通段落，
 * 既不会被识别成 Section，也定位不到刚建的那一段。
 */
export function buildTasksSectionHeading(title: string): string {
	return `# ${title.trim()}`;
}

/**
 * 「添加任务」专用：在参照行基础上**强制 0 级顶层**（`indent: ''`），
 * 保留列表符号与行尾空白，不继承控制项。参照行不是任务行（如新建 Section
 * 时的 `'- '`）时退回默认 `- ` 列表符号，保证仍能产出合法空任务行。
 */
export function buildTopLevelTaskLine(
	referenceLine: string,
	text = '',
	marker: ' ' | 'x' = ' ',
): string {
	const parts = splitTaskLine(referenceLine);
	const base: TaskLineParts =
		parts ??
		{
			indent: '',
			listMarker: '- ',
			checked: ' ',
			gap: ' ',
			body: '',
			controls: [],
			source: '',
			sourceText: '',
			trail: '',
		};
	const body = text.trim();
	return composeTaskLine({
		...base,
		indent: '',
		checked: marker,
		body,
		controls: [],
		source: body,
		sourceText: body,
	});
}
