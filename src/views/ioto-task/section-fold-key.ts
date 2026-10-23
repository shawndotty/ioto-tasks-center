/**
 * Section 折叠键的**构造 / 解析 / 认领 / 交集**唯一口径（[[Plan-20261023-062616]] S1）。
 *
 * 新键 = `s:<level>:<title>`：**不含行号** → 免疫「加一行就掉态」的行漂移
 * （Research §1.2 实测：旧键 `level:startLine:title` 在上方插入任务后即失效）。
 * 带 `s:` 前缀是为了与 legacy 键一眼可分，认领时不用数冒号猜形态。
 *
 * 🔴 敢用「标题」当键的前提：只有**顶层 root 且 `level > 0`** 的节会进折叠集合
 * （`render-note.ts` 只对 roots 调 `renderSection`；`render-sections.ts` 只给
 * `level > 0` 画折叠头）⇒ 集合很小、标题基本唯一。真重名时「同名节共享折叠态」，
 * 是 fail-open（一起折 / 一起展），不会折错节。
 *
 * 零 import（连 `obsidian` 类型都不用）：jiti 可直导单测，不需要桩。
 */

/** 键计算所需的最小结构面（`NoteSection` 结构性满足，便于单测造假数据）。 */
export interface SectionFoldSeed {
	level: number;
	title: string;
}

/** 新键形态：`s:<level>:<title>`（title 可能含 `:`，解析时只切前两个冒号）。 */
export function sectionFoldKey(level: number, title: string): string {
	return `s:${level}:${title}`;
}

/**
 * 解析新键 / legacy 键；认不出返回 `null`（调用方丢弃）。
 *
 * - `s:` 开头 → 新键，第 2 段 level、其后整段 title；
 * - 否则按 legacy `level:startLine:title` → 取 level + title，**丢弃 startLine**
 *   （行号本就不可信：它只是旧键定位节的手段，不是身份）。
 */
export function parseSectionFoldKey(
	key: string,
): { level: number; title: string } | null {
	if (typeof key !== 'string') {
		return null;
	}
	if (key.startsWith('s:')) {
		const rest = key.slice(2);
		const colon = rest.indexOf(':');
		if (colon < 0) {
			return null;
		}
		const level = Number.parseInt(rest.slice(0, colon), 10);
		if (Number.isNaN(level)) {
			return null;
		}
		return { level, title: rest.slice(colon + 1) };
	}
	const firstColon = key.indexOf(':');
	const secondColon = key.indexOf(':', firstColon + 1);
	if (firstColon < 0 || secondColon < 0) {
		return null;
	}
	const level = Number.parseInt(key.slice(0, firstColon), 10);
	if (Number.isNaN(level)) {
		return null;
	}
	return { level, title: key.slice(secondColon + 1) };
}

/**
 * 无记录时的一次性认领：把 legacy 行号键（或已是新键）映射成**当前**的新键。
 *
 * 匹配顺序：先 `level + title` 精确命中 root；再**只按 title** 命中（同标题取第一个）
 * ——旧键的行号几乎必然已漂移，只按 level 找不到就退回按标题找；都找不到 → 丢弃
 * （老键指向的节已经不存在了，让它复活只会折错节）。去重、保序。
 */
export function claimSectionFoldKeys(
	legacy: readonly string[],
	roots: readonly SectionFoldSeed[],
): string[] {
	const claimed: string[] = [];
	const seen = new Set<string>();
	for (const key of legacy) {
		const parsed = parseSectionFoldKey(key);
		if (!parsed) {
			continue;
		}
		const exact = roots.find(
			(root) => root.level === parsed.level && root.title === parsed.title,
		);
		const matched = exact ?? roots.find((root) => root.title === parsed.title);
		if (!matched) {
			continue;
		}
		const next = sectionFoldKey(matched.level, matched.title);
		if (seen.has(next)) {
			continue;
		}
		seen.add(next);
		claimed.push(next);
	}
	return claimed;
}

/**
 * 有记录时的交集清理：只保留能匹配到**当前**某个 root 的键，顺带清掉删节 / 改名
 * 留下的死键（[[Plan-20261023-062616]] §0-4）。去重、保序。
 */
export function intersectSectionFoldKeys(
	keys: readonly string[],
	roots: readonly SectionFoldSeed[],
): string[] {
	const current = new Set(
		roots.map((root) => sectionFoldKey(root.level, root.title)),
	);
	const kept: string[] = [];
	const seen = new Set<string>();
	for (const key of keys) {
		const parsed = parseSectionFoldKey(key);
		if (!parsed) {
			continue;
		}
		const next = sectionFoldKey(parsed.level, parsed.title);
		if (!current.has(next) || seen.has(next)) {
			continue;
		}
		seen.add(next);
		kept.push(next);
	}
	return kept;
}
