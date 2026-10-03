/**
 * IOTOTask 视图「选择态」的纯导航逻辑（[[Plan-20261003-194909]] §5.3）。
 *
 * 职责：把「当前选中的文件行号」在**卡片 DOM 顺序**里挪到上/下一张，以及删除后重定位。
 * 视图层（`IOTOTaskView`）与渲染层（`render-note.ts`）都只调这三个函数，不各自重算。
 *
 * 为什么用 DOM 顺序而不是文件行号排序：
 * - 天然覆盖跨 Section 与缩进层级，调用方不必重建章节树；
 * - 被折叠 Section 的卡片根本不在 DOM 里，因而天然不可达，符合预期。
 *
 * 纯逻辑核心不 import obsidian，所有触 DOM 的点都走结构化最小接口，可被 jiti 单测。
 */

/** 与 `ioto-task-scroll.ts` 同名常量保持一致（同一批卡片 DOM）。 */
export const IOTO_TASK_CARD_SELECTOR = '.ioto-task-view__card';

interface CardElementLike {
	getAttribute?: (name: string) => string | null;
}

interface QueryableContainerLike {
	querySelectorAll?: (
		selector: string,
	) => ArrayLike<unknown> | null | undefined;
}

/**
 * 按 DOM 顺序收集全部可见卡片的 `data-line`（0 基文件行号）。
 * 解析失败（属性缺失 / 非数字）的卡片跳过，不影响其余项的相对顺序。
 */
export function collectCardLines(
	root: QueryableContainerLike | null | undefined,
): number[] {
	const nodes = root?.querySelectorAll?.(IOTO_TASK_CARD_SELECTOR);
	if (!nodes) {
		return [];
	}

	const lines: number[] = [];
	for (const node of Array.from(nodes)) {
		const line = readLine(node as CardElementLike);
		if (line !== null) {
			lines.push(line);
		}
	}

	return lines;
}

/**
 * 取 `current` 在 `lines` 里的上/下一张（`delta = -1` 向上 / `+1` 向下）。
 * 首尾**不循环**（越界返回 `null`）；`current` 不在列表里也返回 `null`。
 */
export function pickAdjacentLine(
	lines: number[],
	current: number,
	delta: 1 | -1,
): number | null {
	const index = lines.indexOf(current);
	if (index < 0) {
		return null;
	}

	const target = index + delta;
	if (target < 0 || target >= lines.length) {
		return null;
	}

	return lines[target] ?? null;
}

/**
 * 删除 `current` 之后，选择该落到哪张：优先「原位置的下一张」顶上，
 * 末位则退回「上一张」，删空了整个列表返回 `null`。
 *
 * 🔴 返回的是**删除后**的行号，不是删除前的。`data-line` 就是文件行号，而删行会让
 * 后续所有卡片整体前移 1，所以「下一张」的前值必须 −1 才是删除后的真实行号；
 * 「上一张」在删除点之前，行号不变。直接拿删除前的行号去选中会选中一张**不存在的卡**
 * （实测 `selectedLine=10` 而磁盘上只有 0–14 行的 5 张卡，选中态因此整个丢光）。
 *
 * 入参必须是**删除前**的 DOM 顺序。
 */
export function pickLineAfterDelete(
	lines: number[],
	current: number,
): number | null {
	const index = lines.indexOf(current);
	if (index < 0) {
		return null;
	}

	const rest = lines.filter((line) => line !== current);
	const target = rest[index] ?? rest[index - 1] ?? null;
	if (target === null) {
		return null;
	}

	// 目标在删除点之后 → 行号 −1；在之前（末位退回上一张）→ 不变
	return target > current ? target - 1 : target;
}

function readLine(card: CardElementLike | undefined): number | null {
	const raw = card?.getAttribute?.('data-line');
	if (raw === undefined || raw === null) {
		return null;
	}

	const parsed = Number.parseInt(raw, 10);
	return Number.isNaN(parsed) ? null : parsed;
}
