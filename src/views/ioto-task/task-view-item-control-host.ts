import type { TFile } from 'obsidian';

import {
	replaceTaskBody,
	taskBodyForEditor,
} from '../../tasks-center/note-structure';
import {
	commitTaskLineAction,
	type CommitOutcome,
} from './commit-task-line';
import type { IOTOTaskView } from '../iotoTaskView';
import type { ItemControlBridgeHost } from './task-view-constants';
import { lineAt, queryCard } from './task-view-helpers';

/**
 * 「条目控制」桥接宿主：仅在内联编辑态返回；其余情况返回 `null`（命令原样透传）。
 * 见 item-control-bridge.ts 与 [[Plan-20261003-105625]] §5.5。
 */
export function getItemControlHost(
	view: IOTOTaskView,
): ItemControlBridgeHost | null {
	const line = view.editingLine;
	const file = view.file;
	const handle = view.editingHandle;
	if (line === null || !file || !handle) {
		return null;
	}

	const originalLine = lineAt(view, line);
	const diskLines = view.data.split('\n');

	return {
		file,
		line,
		originalLine,
		readBridgeLine: () =>
			replaceTaskBody(originalLine, handle.getValue()) ?? originalLine,
		readDiskLine: (index) => diskLines[index] ?? '',
		commitBridgeLine: (nextLine) =>
			commitFromItemControl(view, line, originalLine, nextLine),
		getLineCoords: (targetLine) => {
			const rect = queryCard(view, targetLine)?.getBoundingClientRect();
			return rect
				? {
						top: rect.top,
						left: rect.left,
						bottom: rect.bottom,
						right: rect.right,
					}
				: { top: 0, left: 0, bottom: 0, right: 0 };
		},
		getScrollWidth: () =>
			view.contentEl
				.querySelector('.ioto-task-view__scroll')
				?.getBoundingClientRect().width ?? 0,
	};
}

/**
 * quickPanel 开放宿主契约（ioto-settings）：声明本视图可承载快捷面板。
 *
 * 鸭子类型实现——不 import `ioto-settings`；面板的挂载 / 清理 / 定位全部
 * 由对端 `PanelService` 管理（见 [[Plan-20261005-070644]] §五）。
 */
export function getQuickPanelHost(view: IOTOTaskView): HTMLElement | null {
	return view.contentEl ?? null;
}

/**
 * AI 条目来源开放契约（ioto-settings）：声明「当前选中卡片 = AI 条目来源」。
 *
 * 鸭子类型实现——不 import `ioto-settings`；只服务移动端 API 通道的
 * 「任务条目模式」（桌面走 CLI，不进此路径）。`selectedLine` 是 0-based
 * 文件行号，与对端 `resolveCursorItem` 同口径；`view.data` 是 TextFileView
 * 内存整篇正文（派发前已 flush，与磁盘一致）。
 * 见 [[Plan-20261007-161702]] §五。
 */
export function getAITaskItemSource(
	view: IOTOTaskView,
): { file: TFile; line: number; text: string } | null {
	if (!view.file || view.selectedLine === null) return null;
	return { file: view.file, line: view.selectedLine, text: view.data };
}

/**
 * 面板确认后的整行写回：复用 `commitTaskLineAction`（原子 + 冲突定位），
 * 成功后走 `applyOutcome` 红线同步 `data` / `lastLoadedText`，并同步
 * `editingOriginalLine`，避免随后的 blur 提交误判冲突。
 */
export async function commitFromItemControl(
	view: IOTOTaskView,
	line: number,
	originalLine: string,
	nextLine: string,
): Promise<CommitOutcome> {
	const file = view.file;
	if (!file) {
		return { status: 'unchanged' };
	}

	const outcome = await commitTaskLineAction(view.app, file, {
		line,
		originalLine,
		transform: () => nextLine,
	});
	view.applyOutcome(outcome);
	if (outcome.status === 'ok') {
		view.editingOriginalLine = nextLine;
		// 🔴 面板写回后必须把内联编辑器同步到新正文，否则下一次 blur 提交
		// 会用旧正文覆盖整行，把 depends：/ [model::] 等控制项抹掉。
		const body = taskBodyForEditor(nextLine);
		if (typeof body === 'string') {
			view.editingHandle?.setValue(body);
		}
		// 写回只同步了内存与编辑器；动作区徽章需就地重建，
		// 否则要整页刷新才显示（[[Plan-20261003-174312]] §3.3）。
		view.refreshCardActions(line);
	}
	return outcome;
}
