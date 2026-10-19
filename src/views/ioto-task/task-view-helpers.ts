import type { TaskViewHost } from './task-view-host';
import { isTaskContinuationLine, parentIndentLevelOfTaskLine } from '../../tasks-center/note-structure';
import { IOTO_TASK_SCROLL_SELECTOR } from './ioto-task-scroll';

/** 读 `this.data` 的第 `index` 行（0 基）；越界返回空串。 */
export function lineAt(view: TaskViewHost, index: number): string {
	return view.data.split('\n')[index] ?? '';
}

/** 统计从 `line + 1` 起的连续续行行数（与渲染层 isTaskContinuationLine 同口径）。 */
export function countContinuationLines(view: TaskViewHost, line: number): number {
	const lines = view.data.split('\n');
	const parent = parentIndentLevelOfTaskLine(lines[line] ?? '');
	let count = 0;
	for (let i = line + 1; i < lines.length; i += 1) {
		if (!isTaskContinuationLine(lines[i] ?? '', parent)) {
			break;
		}
		count += 1;
	}
	return count;
}

/** 按文件行号查卡片 DOM 节点（`.ioto-task-view__card[data-line="<line>"]`）。 */
export function queryCard(view: TaskViewHost, line: number): HTMLElement | null {
	return view.contentEl.querySelector<HTMLElement>(
		`.ioto-task-view__card[data-line="${line}"]`,
	);
}

/**
 * 取视图的滚动容器（`.ioto-task-view__scroll`）。
 *
 * 上提到 helpers（[[Research-20261019-131228]] §4.2）：`task-view-section-edit` 与
 * `task-view-section-zoom` 都要用它，避免复制第三份私有实现。
 */
export function queryScrollEl(view: TaskViewHost): HTMLElement | null {
	return (
		view.bodyEl?.querySelector<HTMLElement>(IOTO_TASK_SCROLL_SELECTOR) ?? null
	);
}

/** 按 Section 起始行查 DOM 节点（`data-start-line` 由 `render-sections.ts` 输出）。 */
export function querySectionEl(
	view: TaskViewHost,
	startLine: number,
): HTMLElement | null {
	return (
		view.bodyEl?.querySelector<HTMLElement>(
			`.ioto-task-view__section[data-start-line="${startLine}"]`,
		) ?? null
	);
}
