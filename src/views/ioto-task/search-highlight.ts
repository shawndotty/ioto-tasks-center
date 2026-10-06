/**
 * Task View 搜索命中关键词高亮（[[Discuss-20261006-183552]] §四）。
 *
 * 纯函数层只做「**区间计算 + 切段**」，零 `obsidian` / 零 DOM，照
 * `task-query-filter.ts` / `recent-task-filter.ts` 的范式组织，可被 jiti 直接导入单测。
 *
 * 🔴 与过滤**同源**：过滤判据 `matchesTaskQuery` 也复用本模块的 `findMatchRanges`，
 * 保证「卡片可见 ⟺ 卡里至少有一处高亮」，不出现「卡留下了却零高亮」的漂移
 * （[[Discuss-20261006-183552]] §五.9）。
 *
 * DOM 应用层（`applySearchHighlight`）作用于 `MarkdownRenderer` 的**渲染产物**，
 * 把命中文本节点包成 `<span class="ioto-task-view__search-hit">`；绝不在 markdown
 * 源码字符串上插标记（会撕坏 `[[链接]]` / `**强调**` / 内联字段）。
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

/** 转义正则元字符（查询里可能含 `.` `(` `)` `+` 等，须按字面处理）。 */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 在 `text` 中找出 `normalizedQuery` 的全部**不重叠**字面命中区间。
 * 大小写不敏感；查询按字面（非正则）处理；空查询 / 空文本 → `[]`。
 *
 * 🔴 用 `RegExp(…, 'gi')` 在**原串**上取 index——不要先小写再取 index：个别 locale
 * 的小写会改变长度（如 `İ`），那样切原串会错位（[[Discuss-20261006-183552]] §五.2）。
 */
export function findMatchRanges(
	text: string,
	normalizedQuery: string,
): MatchRange[] {
	if (normalizedQuery.length === 0 || text.length === 0) {
		return [];
	}
	const re = new RegExp(escapeRegExp(normalizedQuery), 'gi');
	const ranges: MatchRange[] = [];
	for (const match of text.matchAll(re)) {
		const start = match.index ?? 0;
		ranges.push({ start, end: start + (match[0] ?? '').length });
	}
	return ranges;
}

/**
 * 把 `text` 按命中切成 `[{text, hit}]`；非命中段保留为普通文本。
 * 可自检不变量：`splitByQuery(t, q).map(p => p.text).join('') === t`（切段不丢字）。
 */
export function splitByQuery(
	text: string,
	normalizedQuery: string,
): QueryPart[] {
	if (text.length === 0) {
		return [];
	}
	const ranges = findMatchRanges(text, normalizedQuery);
	if (ranges.length === 0) {
		return [{ text, hit: false }];
	}
	const parts: QueryPart[] = [];
	let cursor = 0;
	for (const range of ranges) {
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
 */
function unwrapSearchHighlight(root: HTMLElement): void {
	const hits = root.querySelectorAll<HTMLElement>(`.${SEARCH_HIT_CLASS}`);
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
 * `<span class="ioto-task-view__search-hit">`。
 *
 * - 幂等：先 unwrap 旧命中，再重新切。
 * - 空查询 = 只 unwrap、不包裹（清空搜索无残留）。
 * - **不**触碰 `code` / `pre`（Q5 默认照常高亮）；只跳过 `script` / `style` 这类
 *   不应改写的节点。编辑器容器调用方不传（只对 `.card-text` / `__md` 跑）。
 * - 核心 `MarkdownRenderer.render` 的基础 DOM 是**同步** append 的，故渲染后**同步**
 *   调用即可命中；返回的 Promise 只等数学 / mermaid 等后处理器（v1 不覆盖）。
 */
export function applySearchHighlight(
	root: HTMLElement,
	normalizedQuery: string,
): void {
	unwrapSearchHighlight(root);
	if (normalizedQuery.length === 0) {
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
		if (!parent || parent.closest('script, style')) {
			continue;
		}
		const parts = splitByQuery(textNode.data, normalizedQuery);
		if (!parts.some((part) => part.hit)) {
			continue; // 全段无命中 → 不改动
		}
		const doc = root.ownerDocument;
		const fragment = doc.createDocumentFragment();
		for (const part of parts) {
			if (part.hit) {
				const span = doc.createElement('span');
				span.className = SEARCH_HIT_CLASS;
				span.textContent = part.text;
				fragment.appendChild(span);
			} else {
				fragment.appendChild(doc.createTextNode(part.text));
			}
		}
		textNode.replaceWith(fragment);
	}
}
