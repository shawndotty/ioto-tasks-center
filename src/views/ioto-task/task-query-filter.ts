/**
 * Task View 关键词搜索的渲染期过滤纯逻辑（[[Plan-20261006-161121]] §2.1）。
 *
 * 零 `obsidian` / 零 DOM 依赖，照 `recent-task-filter.ts` 的范式组织，可被 jiti
 * 直接导入单测。关键词是**视图实例上的瞬态输入**，不进 `TaskNoteFilters` / 不落盘
 * （[[Discuss-20261006-160043]] §三）。
 *
 * 卡片可见性是 ①②③ + 关键词四层过滤的**唯一真源**：`render-note.ts` 的
 * 「空态判定」与「逐卡 skip」都调 `isCardVisible`，避免两处各写一遍导致漂移。
 */

import { findMatchRanges } from './search-highlight';

/** 归一化查询：去首尾空白 + 小写。空串 / 纯空白 = 不过滤。 */
export function normalizeQuery(raw: string): string {
	return raw.trim().toLocaleLowerCase();
}

/**
 * 关键词是否命中一张卡：标题 + 续行，字面大小写不敏感包含。空查询恒 true。
 *
 * 🔴 命中判据复用 `search-highlight.ts` 的 `findMatchRanges`，与高亮**同源**：保证
 * 「卡片可见 ⟺ 卡里至少有一处高亮」，不出现大小写 / locale 边角下的漂移
 * （[[Discuss-20261006-183552]] §四.1 / §五.9）。对旧 `toLocaleLowerCase().includes()`
 * 是**行为等价重构**（既有 `tests/task-query-filter.test.mjs` 覆盖）。
 */
export function matchesTaskQuery(
	title: string,
	continuation: string | undefined,
	normalized: string,
): boolean {
	if (normalized.length === 0) return true;
	if (findMatchRanges(title, normalized).length > 0) return true;
	return continuation ? findMatchRanges(continuation, normalized).length > 0 : false;
}

/** 卡片可见性输入（由渲染层从 `NoteChecklistItem` 映射，保持本模块纯净）。 */
export interface CardVisibilityInput {
	line: number;
	done: boolean;
	title: string;
	continuation?: string;
}

export interface CardVisibilityContext {
	/** ③ 最近任务（null = 未开启） */
	recentLines: ReadonlySet<number> | null;
	/** ② 只显示未完成 */
	onlyPending: boolean;
	/** 关键词（已归一化） */
	normalizedQuery: string;
	/** 需无条件保留的卡片行号（编辑中的卡 / 其续行）；`null` = 不保留 */
	keepVisibleLine: number | null;
}

/**
 * 卡片是否可见：四层过滤的**唯一真源**。
 * `renderSectionBody` 的「空态判定」与 `renderChecklistGroup` 的「逐卡 skip」
 * 都调它，避免两处各写一遍导致漂移（[[Discuss-20261006-160043]] §五.1/§五.2）。
 */
export function isCardVisible(
	item: CardVisibilityInput,
	ctx: CardVisibilityContext,
): boolean {
	if (ctx.recentLines && !ctx.recentLines.has(item.line)) return false;
	if (ctx.onlyPending && item.done) return false;
	// 🔴 编辑中的卡 / 其续行被编辑的卡：无条件保留
	//（重绘兜底；真正的保护是改查询前先 commitEdit）
	if (ctx.keepVisibleLine === item.line) return true;
	if (ctx.normalizedQuery.length > 0) {
		return matchesTaskQuery(
			item.title,
			item.continuation,
			ctx.normalizedQuery,
		);
	}
	return true;
}
