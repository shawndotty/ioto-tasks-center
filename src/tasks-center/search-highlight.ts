/**
 * 搜索命中高亮的纯逻辑 + DOM 应用层：Task View 卡片与任务链接弹窗预览共用
 * （[[Discuss-20261006-183552]] §四、[[Plan-20261028-221530]] §三 S1）。
 *
 * 纯函数层只做「**区间计算 + 切段**」，零 `obsidian` / 零 DOM，照
 * `task-query-filter.ts` / `recent-task-filter.ts` 的范式组织，可被 jiti 直接导入单测。
 *
 * 🔴 与过滤**同源**：过滤判据 `matchesTaskQuery` 也复用本模块的 `findMatchRanges`，
 * 保证「卡片可见 ⟺ 卡里至少有一处高亮」，不出现「卡留下了却零高亮」的漂移
 * （[[Discuss-20261006-183552]] §五.9）。
 *
 * DOM 应用层（`applySearchHighlight`）作用于 `MarkdownRenderer` 的**渲染产物**，
 * 把命中文本节点包成 `<span class="{hitClass}">`；绝不在 markdown 源码字符串上
 * 插标记（会撕坏 `[[链接]]` / `**强调**` / 内联字段）。
 *
 * 命中 span 的**类名由调用方决定**（默认 `SEARCH_HIT_CLASS`，即 Task View 口径）：
 * 同一个容器里可能同时存在两套高亮，染色 / 重扫 / 计数必须传同一个类名，
 * 否则重扫会残留旧 span、计数也会把别人的命中算进来。
 *
 * 🔴 `query` 支持两种入参（[[Plan-20261029-230738]] §三 S1）：
 * - `string` → **单条字面**，语义与 v2.7.7 逐条一致（Task View 5 个调用点零改动）；
 * - `string[]` → 多词：区间先合并再切段，**只负责「都染上」**；是 AND 还是 OR
 *   由调用方自己定（相关链接窗口选 AND，见 `filterTaskLinks`）。
 */

/** 命中区间 `[start, end)`：0 基、左闭右开、作用于**原始文本**。 */
export interface MatchRange {
	start: number;
	end: number;
}

/** 命中高亮 span 的类名（样式见 `styles.css`，取核心 `--text-highlight-bg`）。 */
export const SEARCH_HIT_CLASS = 'ioto-task-view__search-hit';

/** 切段结果：命中段 / 非命中段交替。 */
export interface QueryPart {
	text: string;
	hit: boolean;
}

/**
 * 匹配选项（[[Plan-20261029-083909]] §三 S1）。两项**全可选且默认值 = 今天的语义**，
 * 因此 Task View 的既有调用点一行不用改。
 */
export interface MatchOptions {
	/** 默认 `false`（= 今天的 `gi`）。只作用于正则的 `i` 标志，不做任何大小写转换。 */
	caseSensitive?: boolean;
	/** 默认 `false`（= 今天的纯子串）。中文 / `c++` 这类查询天然退化为子串。 */
	wholeWord?: boolean;
}

/**
 * 查询的两种形态（[[Plan-20261029-230738]] §三 S1）：
 * - `string` = **单条字面**，一秒都不按空格拆 —— Task View 的整串语义靠这条保住；
 * - 数组 = 多词口径，**怎么组合（AND / OR）由调用方决定**，本模块只负责「都染上」。
 */
export type SearchQuery = string | readonly string[];

/** 把查询归一成词表：`string` 只判空（空 / 纯空白 → 无词），绝不裁剪用于匹配的串。 */
function toQueries(query: SearchQuery): string[] {
	if (typeof query === 'string') {
		return query.trim().length === 0 ? [] : [query];
	}
	return query.filter((token) => token.length > 0);
}

/**
 * 把用户输入按空白拆成词表（**唯一**实现：过滤与染色共用，放两处必然漂移）。
 *
 * - `\s+` 覆盖 ASCII 空格、Tab、NBSP(U+00A0)、全角空格 U+3000、U+FEFF，
 *   中文输入法下打出的「全角空格」不会把整串变成一个查不到的词；
 * - 空段丢弃（首尾 / 连续空格折叠），字面去重且保留首次出现顺序
 *   —— 纯空白 → `[]`，逐词跑正则时不会白跑一遍。
 *
 * 🔴 只用于**调用层**（`filterTaskLinks` / 相关链接弹窗）。共享函数收到字符串时
 * 仍按整串字面处理，Task View 的搜索语义因此一字不改。
 */
export function tokenizeQuery(raw: string): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const token of raw.split(/\s+/)) {
		if (token.length === 0 || seen.has(token)) {
			continue;
		}
		seen.add(token);
		out.push(token);
	}
	return out;
}

/** 转义正则元字符（查询里可能含 `.` `(` `)` `+` 等，须按字面处理）。 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 「词字符」与 `\b` 的 `\w` 同集：中文 / 标点都不是，故中文查询天然退化为子串。 */
const WORD_CHAR = /[A-Za-z0-9_]/;

/** `undefined`（越界）视为非词字符 → 串首 / 串尾的边界自然成立。 */
function isWordChar(ch: string | undefined): boolean {
	return ch !== undefined && WORD_CHAR.test(ch);
}

/**
 * 在 `text` 中找出 `query` 的全部**不重叠**字面命中区间。
 * 默认大小写不敏感；查询按字面（非正则）处理；空查询 / 空文本 → `[]`。
 *
 * 🔴 用 `RegExp(…, 'g' | 'gi')` 在**原串**上取 index——不要先小写再取 index：个别
 * locale 的小写会改变长度（如 `İ`），那样切原串会错位（[[Discuss-20261006-183552]] §五.2）。
 * 大小写只通过正则的 `i` 标志控制，绝不做大小写转换。
 *
 * 🔴 全词匹配**不用 `\b`**：`/\b笔记\b/.test('笔记') === false`、
 * `/\bc\+\+\b/.test('c++ 手册') === false` —— 中文与标点结尾的查询会静默归零。
 * 改用「命中区间左右邻字符都不是词字符」的后置过滤（[[Plan-20261029-083909]] §五.1）。
 *
 * 🔴 多词（数组入参）**必须合并区间**：`登录` 是 `登录问题` 的子串，两段区间会重叠，
 * 直接切段会把同一段文字画两遍（[[Plan-20261029-230738]] §七 唯一真坑）。
 */
export function findMatchRanges(
	text: string,
	query: SearchQuery,
	options: MatchOptions = {},
): MatchRange[] {
	const queries = toQueries(query);
	if (queries.length === 0 || text.length === 0) {
		return [];
	}
	if (queries.length === 1) {
		return findSingleMatchRanges(text, queries[0] as string, options);
	}

	const ranges: MatchRange[] = [];
	for (const token of queries) {
		ranges.push(...findSingleMatchRanges(text, token, options));
	}
	return mergeRanges(ranges);
}

/** 单条查询的命中区间（多词路径逐词调用它，再统一合并）。 */
function findSingleMatchRanges(
	text: string,
	query: string,
	options: MatchOptions,
): MatchRange[] {
	if (query.length === 0 || text.length === 0) {
		return [];
	}
	const re = new RegExp(escapeRegExp(query), options.caseSensitive ? 'g' : 'gi');
	const ranges: MatchRange[] = [];
	for (const match of text.matchAll(re)) {
		const start = match.index ?? 0;
		const end = start + (match[0] ?? '').length;
		if (options.wholeWord && (isWordChar(text[start - 1]) || isWordChar(text[end]))) {
			continue;
		}
		ranges.push({ start, end });
	}
	return ranges;
}

/**
 * 区间合并：按 `start` 升序、`end` 降序排好，依次吞掉与之重叠的下一段。
 * **相接也算合并**（`[0,2)` + `[2,4)` → `[0,4)`）：两段相邻命中切出来会变成两个
 * 紧挨的 span，计数与「N/M」都会虚高一段。
 */
function mergeRanges(ranges: readonly MatchRange[]): MatchRange[] {
	if (ranges.length <= 1) {
		return ranges.map((range) => ({ start: range.start, end: range.end }));
	}
	const sorted = [...ranges].sort(
		(left, right) => left.start - right.start || right.end - left.end,
	);
	const merged: MatchRange[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range.start <= last.end) {
			if (range.end > last.end) {
				last.end = range.end;
			}
			continue;
		}
		merged.push({ start: range.start, end: range.end });
	}
	return merged;
}

/**
 * 把 `text` 按命中切成 `[{text, hit}]`；非命中段保留为普通文本。
 * 可自检不变量：`splitByQuery(t, q).map(p => p.text).join('') === t`（切段不丢字）。
 *
 * 🔴 区间若已被前一段吃掉（`start < cursor`）必须跳过：多词路径靠 `mergeRanges`
 * 保证不重叠，这里的守卫是第二道保险 —— 漏了就会把已切走的文字再吐一遍。
 */
export function splitByQuery(
	text: string,
	query: SearchQuery,
	options: MatchOptions = {},
): QueryPart[] {
	if (text.length === 0) {
		return [];
	}
	const ranges = findMatchRanges(text, query, options);
	if (ranges.length === 0) {
		return [{ text, hit: false }];
	}
	const parts: QueryPart[] = [];
	let cursor = 0;
	for (const range of ranges) {
		if (range.start < cursor) {
			continue;
		}
		if (range.start > cursor) {
			parts.push({ text: text.slice(cursor, range.start), hit: false });
		}
		parts.push({ text: text.slice(range.start, range.end), hit: true });
		cursor = range.end;
	}
	if (cursor < text.length) {
		parts.push({ text: text.slice(cursor), hit: false });
	}
	return parts;
}

/**
 * 展开 `root` 内所有旧的命中 span（把每个 span 换回等价文本节点，再合并相邻文本）。
 * 保证 `applySearchHighlight` **幂等**：就地重绘路径（`refreshCard`）不 unwrap 会
 * 叠加嵌套 span、越点越深（[[Discuss-20261006-183552]] §五.3）。
 *
 * 🔴 必须收**同一个** `hitClass`：只清自己那一套，别顺手把容器里别的高亮拆掉。
 */
function unwrapSearchHighlight(root: HTMLElement, hitClass: string): void {
	const hits = root.querySelectorAll<HTMLElement>(`.${hitClass}`);
	for (const hit of Array.from(hits)) {
		const parent = hit.parentNode;
		if (!parent) {
			continue;
		}
		parent.replaceChild(
			root.ownerDocument.createTextNode(hit.textContent ?? ''),
			hit,
		);
	}
	root.normalize();
}

/**
 * 把 `root`（`MarkdownRenderer` 的渲染产物容器）里所有文本节点按关键词包成
 * `<span class="{hitClass}">`。
 *
 * - 幂等：先 unwrap 旧命中，再重新切。
 * - 空查询 = 只 unwrap、不包裹（清空搜索无残留；纯空白同样按空处理）。
 * - **不**触碰 `code` / `pre`（Q5 默认照常高亮）；跳过 `script` / `style`，
 *   以及 `svg` / `mjx-container` / `.math` —— 公式与图表由后处理器接管，
 *   切碎它们的文本节点会把渲染结果拆坏（[[Plan-20261028-221530]] §三 S1）。
 * - 核心 `MarkdownRenderer.render` 的基础 DOM 是**同步** append 的，故渲染后**同步**
 *   调用即可命中；返回的 Promise 只等数学 / mermaid 等后处理器。
 */
export function applySearchHighlight(
	root: HTMLElement,
	query: SearchQuery,
	hitClass: string = SEARCH_HIT_CLASS,
	options: MatchOptions = {},
): void {
	unwrapSearchHighlight(root, hitClass);
	const queries = toQueries(query);
	if (queries.length === 0) {
		return;
	}

	// 先收集文本节点数组：边遍历边改 DOM 不安全（TreeWalker 会被替换操作扰动）。
	const walker = root.ownerDocument.createTreeWalker(
		root,
		NodeFilter.SHOW_TEXT,
	);
	const textNodes: Text[] = [];
	let node = walker.nextNode();
	while (node) {
		textNodes.push(node as Text);
		node = walker.nextNode();
	}

	for (const textNode of textNodes) {
		const parent = textNode.parentElement;
		if (
			!parent ||
			parent.closest('script, style, svg, mjx-container, .math')
		) {
			continue;
		}
		const parts = splitByQuery(textNode.data, queries, options);
		if (!parts.some((part) => part.hit)) {
			continue; // 全段无命中 → 不改动
		}
		const doc = root.ownerDocument;
		const fragment = doc.createDocumentFragment();
		for (const part of parts) {
			if (part.hit) {
				const span = doc.createElement('span');
				span.className = hitClass;
				span.textContent = part.text;
				fragment.appendChild(span);
			} else {
				fragment.appendChild(doc.createTextNode(part.text));
			}
		}
		textNode.replaceWith(fragment);
	}
}

/**
 * 收集容器内全部命中 span（文档顺序）。
 *
 * 顺序即「下一个」的行走顺序：`querySelectorAll` 天然返回文档序，**不要再排序** ——
 * 排序会打乱同一行内的先后（[[Plan-20261028-221530]] §三 S1）。
 */
export function collectSearchHits(
	root: HTMLElement,
	hitClass: string = SEARCH_HIT_CLASS,
): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(`.${hitClass}`));
}

/**
 * 命中索引步进（纯函数，供「上一个 / 下一个」共用）：
 *
 * - `total <= 0` → `-1`（没有可落脚的位置）；
 * - `current < 0`（尚未定位）→ 正向落 `0`、反向落 `total - 1`；
 * - 其余按 `±1` **环绕**，负数取模要拉回正区间。
 */
export function stepHitIndex(
	current: number,
	total: number,
	delta: number,
): number {
	if (total <= 0) {
		return -1;
	}
	if (current < 0) {
		return delta >= 0 ? 0 : total - 1;
	}
	return (((current + delta) % total) + total) % total;
}
