/**
 * 区间原子重写后，迁移视图里以**行号**为基准的跟踪态。
 *
 * 同口径的状态迁移点（拖拽 / 互换 / 缩进等任何「移动行块」操作）统一走这里：
 * - `selectedLine`：随块迁移；落在被规范化掉的空行（mapLine → null）上则清空。
 * - 多选集合（`multiAnchor` / `multiLines`）：随锚点一起迁移（[[Plan-20261101-063126]]
 *   §三-6）。只迁锚点会让不变量 `multiAnchor !== selectedLine` 立刻把集合判作废
 *   ——拖完多选就没了。收口在这里，所有移动类调用方自动获益。
 *
 * 🔴 Section 折叠态（`collapsedSections`）**不再需要迁移**：键已换成
 * `s:<level>:<title>`（不含行号，[[Plan-20261023-062616]]），行漂移不影响它。
 *
 * 白名单登记：本文件是 selectedLine 的合法直写点，见 scripts/check-view-writes.mjs。
 */

import { remapMultiFields } from './task-view-multi-selection';
import type { TaskViewHost } from './task-view-host';

export function remapTrackedLines(
	view: TaskViewHost,
	mapLine: (line: number | null) => number | null,
): void {
	// 🔴 顺序不可换：`currentMultiSelection` 拿 `selectedLine` 当**锚点快照**去校验
	// 不变量。若先把 selectedLine 改成新行号，`multiAnchor`（旧行号）与它对不上，
	// 集合会被判作废（members 直接变空），整组拖完就只剩一张选中。
	remapMultiFields(view, mapLine);
	if (view.selectedLine !== null) {
		view.selectedLine = mapLine(view.selectedLine);
	}
}
