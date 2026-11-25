/**
 * 「润色进行中」状态的**唯一真源**（Plan-20261125-212649 §三）。
 *
 * 状态挂在视图上的 `Map<行号, 正文指纹 | null>`：值为 `null` 表示 flush 前尚未
 * 取到权威文本，此时只按行号命中；取到后立刻精化为正文指纹，避免上方增删行造成
 * 的短暂漂移被误判（§3.3）。
 *
 * 两条实现红线：
 * 1. **增删一律走方法调用**（`set` / `delete` / `clear`），调用方只碰方法、
 *    不替换整个 Map 字段，从而不触发 `scripts/check-view-writes.mjs`。
 * 2. **`refine` 不复活记录**：并发清理后静默忽略，避免状态条永远不消失。
 *
 * 零 `obsidian` 值依赖 / 零 DOM，可被 jiti 直接导入单测。
 */

/** 状态宿主的最小状态面（`IOTOTaskView` / `TaskViewHost` 结构性满足）。 */
export interface PolishStatusHost {
	polishPending: Map<number, string | null>;
}

/** 开始润色：写入该行记录（`taskKey` 未知时先写 `null`，flush 后精化）。 */
export function setPolishRunning(
	host: PolishStatusHost,
	line: number,
	taskKey: string | null,
): void {
	host.polishPending.set(line, taskKey);
}

/** 把 flush 前的 `null` 记录精化为权威正文指纹；记录已不存在时静默忽略。 */
export function refinePolishTaskKey(
	host: PolishStatusHost,
	line: number,
	taskKey: string,
): void {
	if (!host.polishPending.has(line)) {
		return;
	}
	host.polishPending.set(line, taskKey);
}

/** 结束润色：移除该行记录（幂等）。 */
export function clearPolishRunning(
	host: PolishStatusHost,
	line: number,
): void {
	host.polishPending.delete(line);
}

/** 换文件 / 视图卸载：清空全部记录。 */
export function clearAllPolishRunning(host: PolishStatusHost): void {
	host.polishPending.clear();
}

/** 读取该行记录：`undefined` = 未在润色；`null` = flush 前；字符串 = 正文指纹。 */
export function getPolishTaskKey(
	host: PolishStatusHost,
	line: number,
): string | null | undefined {
	return host.polishPending.get(line);
}

/**
 * 命中判定：无记录 → `false`；记录键为 `null` → 命中（flush 前窗口）；
 * 否则与当前正文指纹全等才命中。
 */
export function isPolishRunningFor(
	host: PolishStatusHost,
	line: number,
	currentKey: string,
): boolean {
	const entry = host.polishPending.get(line);
	if (entry === undefined) {
		return false;
	}
	return entry === null || entry === currentKey;
}