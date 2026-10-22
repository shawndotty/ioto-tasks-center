/**
 * 「显示最近任务」的渲染期过滤纯逻辑（[[Plan-20261005-101007]] §2.2）。
 *
 * 零 `obsidian` 依赖，照 `card-navigation.ts` 的范式组织，可被 jiti 直接导入单测。
 * 只消费解析层的有序 checklist 序列，不自己做字符串分析。
 */

/** `pickRecentTopLevelLines` 需要的最小字段：文件行号 + 缩进层级 + pin 态。 */
export interface RecentGroupableItem {
	line: number;
	indentLevel: number;
	/** 该行被 pin（`#ioto/pin`）。缺省 false。 */
	pinned?: boolean;
}

/**
 * 在一个 Section 的**有序** checklist 序列里，切出「顶级任务 + 其后续子任务」组，
 * 取末尾 `count` 组 + 任意含 pin 行的组的全部行号（并集，pin 不占 N 配额）。
 *
 * - 顶级 = `indentLevel === 0`；子任务 = 紧随其后、缩进更深（>0）的连续项。
 * - 只按**组数**计数，子任务不计入 N。
 * - 首个元素即为缩进 >0 的「无主缩进项」：自成一个兜底组，参与末尾 N 的截取。
 * - `count >= 组数` 时返回全集 → 行为等价「不裁剪」。
 * - `count < 1` 或非有限数时兜底为 1（至少保留最后一组）。
 * - pin 按**组**保留：组内任一行为 pin 即整组保留（不产生无父卡的孤立子任务）。
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

	// 行 → 是否 pin（groups 里存的是行号，pinned 挂在条目上，先摊平）
	const pinnedByLine = new Map<number, boolean>();
	for (const item of items) {
		pinnedByLine.set(item.line, item.pinned === true);
	}

	const n = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
	const keep = new Set<number>();
	groups.forEach((group, index) => {
		const inRecent = index >= groups.length - n;
		// pin 组无条件保留：并集而非替换 → 「显示总数 = N + N 之外的 pin 组数」天然成立
		const hasPin = group.some((line) => pinnedByLine.get(line) === true);
		if (!inRecent && !hasPin) return;
		for (const line of group) {
			keep.add(line);
		}
	});
	return keep;
}
