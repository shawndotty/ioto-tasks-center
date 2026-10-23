/**
 * 区间原子重写后，迁移视图里以**行号**为基准的跟踪态。
 *
 * 同口径的状态迁移点（拖拽 / 互换 / 缩进等任何「移动行块」操作）统一走这里：
 * - `selectedLine`：随块迁移；落在被规范化掉的空行（mapLine → null）上则清空。
 *
 * 🔴 Section 折叠态（`collapsedSections`）**不再需要迁移**：键已换成
 * `s:<level>:<title>`（不含行号，[[Plan-20261023-062616]]），行漂移不影响它。
 *
 * 白名单登记：本文件是 selectedLine 的合法直写点，见 scripts/check-view-writes.mjs。
 */

import type { TaskViewHost } from './task-view-host';

export function remapTrackedLines(
	view: TaskViewHost,
	mapLine: (line: number | null) => number | null,
): void {
	if (view.selectedLine !== null) {
		view.selectedLine = mapLine(view.selectedLine);
	}
}
