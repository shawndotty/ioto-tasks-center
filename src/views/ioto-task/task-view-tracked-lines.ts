/**
 * 区间原子重写后，迁移视图里以**行号**为基准的跟踪态。
 *
 * 同口径的状态迁移点（拖拽 / 互换 / 缩进等任何「移动行块」操作）统一走这里：
 * - `selectedLine`：随块迁移；落在被规范化掉的空行（mapLine → null）上则清空。
 * - `collapsedSections`：key = `level:startLine:title`，标题行恒在块内，
 *   按 mapLine 重算 startLine（标题含 `:` 时只 split 前两个冒号，同
 *   `shiftTrackedLines` 口径）；标题行被删（理论上拖拽不会删标题）则丢弃该键。
 *
 * 白名单登记：本文件是 selectedLine / collapsedSections 两个字段的合法直写点，
 * 见 scripts/check-view-writes.mjs。
 */

import type { TaskViewHost } from './task-view-host';

export function remapTrackedLines(
	view: TaskViewHost,
	mapLine: (line: number | null) => number | null,
): void {
	if (view.selectedLine !== null) {
		view.selectedLine = mapLine(view.selectedLine);
	}

	const remapped = new Set<string>();
	for (const key of view.collapsedSections) {
		const firstColon = key.indexOf(':');
		const secondColon = key.indexOf(':', firstColon + 1);
		if (firstColon < 0 || secondColon < 0) {
			continue;
		}
		const level = key.slice(0, firstColon);
		const startLine = Number.parseInt(
			key.slice(firstColon + 1, secondColon),
			10,
		);
		const title = key.slice(secondColon + 1);
		if (Number.isNaN(startLine)) {
			continue;
		}
		const nextLine = mapLine(startLine);
		if (nextLine !== null) {
			remapped.add(`${level}:${nextLine}:${title}`);
		}
	}
	view.collapsedSections = remapped;
}
