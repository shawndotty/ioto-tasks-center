import type { TaskViewHost } from './task-view-host';
import { isTaskContinuationLine, parentIndentLevelOfTaskLine } from '../../tasks-center/note-structure';

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
