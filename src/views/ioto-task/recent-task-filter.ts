/**
 * 「显示最近任务」的渲染期过滤纯逻辑（[[Plan-20261005-101007]] §2.2）。
 *
 * 零 `obsidian` 依赖，照 `card-navigation.ts` 的范式组织，可被 jiti 直接导入单测。
 * 只消费解析层的有序 checklist 序列，不自己做字符串分析。
 */

/** `pickRecentTopLevelLines` 需要的最小字段：文件行号 + 缩进层级。 */
export interface RecentGroupableItem {
	line: number;
	indentLevel: number;
}

/**
 * 在一个 Section 的**有序** checklist 序列里，切出「顶级任务 + 其后续子任务」组，
 * 取末尾 `count` 组的全部行号。
 *
 * - 顶级 = `indentLevel === 0`；子任务 = 紧随其后、缩进更深（>0）的连续项。
 * - 只按**组数**计数，子任务不计入 N。
 * - 首个元素即为缩进 >0 的「无主缩进项」：自成一个兜底组，参与末尾 N 的截取。
 * - `count >= 组数` 时返回全集 → 行为等价「不裁剪」。
 * - `count < 1` 或非有限数时兜底为 1（至少保留最后一组）。
 */
export function pickRecentTopLevelLines(
	items: readonly RecentGroupableItem[],
	count: number,
): Set<number> {
	const groups: number[][] = [];
	let current: number[] | null = null;
	for (const item of items) {
		// 顶级任务开新组；前导孤儿缩进项（首个即 >0）兜底成组。
		if (item.indentLevel === 0 || current === null) {
			current = [];
			groups.push(current);
		}
		current.push(item.line);
	}

	const n = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
	const keep = new Set<number>();
	for (const group of groups.slice(-n)) {
		for (const line of group) {
			keep.add(line);
		}
	}
	return keep;
}
