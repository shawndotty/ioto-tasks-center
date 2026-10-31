/**
 * 跨任务文件搬运的**写盘编排**（[[Plan-20261031-205655]] §四.5）。
 *
 * 三条硬约束（改这里前先读完）：
 * 1. **顺序不可反**：先写目标、再删源。先删后插一旦插入失败 = 任务凭空消失；
 *    先插后删最坏是「源里多一条」，用户看得见、能手动收拾（调研 C5）。
 * 2. **不自动回滚**：目标写成功、源删除冲突时，不把目标那份再删掉——回滚本身也
 *    可能失败，会把一次可解释的重复变成不可解释的半残。
 * 3. **两个视图各自 `applyOutcome`**：`data` / `lastLoadedText` 必须同步，否则
 *    `TextFileView` 的保存路径会把旧字节写回磁盘（`iotoTaskView.ts` 红线）。
 *
 * 写盘后**不要**再 `reloadFromVault`（`applyOutcome` 之后内容已相等，
 * `reloadFromVault` 会因 `content === lastLoadedText` 直接 return，白等一次 I/O）。
 */

import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	appendTaskBlockToNote,
	extractTaskBlock,
	moveTaskBlockAcrossNotes,
	removeTaskBlockFromNote,
} from '../../tasks-center/note-task-transfer';
import { isTaskNoteFile } from '../../tasks-center/task-note-menu';
import { MoveTaskFileModal } from '../../ui/moveTaskFileModal';
import { findSectionAtLine } from '../../tasks-center/note-structure';
import { commitBlockRange } from './commit-task-line';
import { sectionFoldKey } from './section-fold-key';
import { persistSectionFolds } from './task-view-section-fold';
import { checkForeignDropTarget } from './task-view-transfer-guard';
import type { BlockEdit } from '../../tasks-center/note-task-transfer';
import type { CommitBlockRangeOptions } from './commit-task-line';
import type { TaskDropTarget } from '../../tasks-center/note-structure';
import type { TFile } from 'obsidian';
import type { TaskViewHost } from './task-view-host';

/** `BlockEdit` → `commitBlockRange` 入参。走 `nextLines` 直给通道（`[]` 才是删块，
 * `['']` 是「留一行空行」），不能用 `nextText` 的全空白折叠语义。 */
function toBlockRangeOptions(edit: BlockEdit): CommitBlockRangeOptions {
	return {
		startLine: edit.startLine,
		endLine: edit.endLine,
		originalLines: edit.originalLines,
		nextLines: edit.nextLines,
		nextText: edit.nextLines.join('\n'),
	};
}

/** 源侧落盘 + 退出放大（口径同 `commitCardMove`）。 */
async function prepareSourceView(srcView: TaskViewHost): Promise<void> {
	await srcView.flushInlineEdits();
	if (srcView.zoomLine !== null) {
		srcView.exitZoom();
	}
	srcView.cancelPendingDelete(false);
}

/**
 * 目标侧收尾（顺序不能换）：展开折叠节 → 选中新块 → 滚进视野。
 *
 * 折叠键走 `section-fold-key`（`s:<level>:<title>`，不含行号），**不要**用
 * `render-sections` 的 `getSectionStateKey` —— 那会把渲染链拖进本模块的依赖图。
 */
function renderTargetSelection(view: TaskViewHost, line: number): void {
	const section = findSectionAtLine(view.data, line);
	if (section) {
		const key = sectionFoldKey(section.level, section.title);
		if (view.collapsedSections.delete(key)) {
			persistSectionFolds(view);
		}
	}
	view.selectedLine = line;
	view.renderNote(view.data);
	const card = view.queryCard(line);
	if (card) {
		view.scrollCardIntoView(card);
	}
}

/**
 * 删掉源文件里的任务块。成功 → `true`；冲突 / 无改动 → `false`
 * （调用方负责 Notice，且**不**回滚目标）。
 */
async function removeSourceBlock(
	srcView: TaskViewHost,
	srcFile: TFile,
	fromLine: number,
	dstName: string,
): Promise<boolean> {
	const edit = removeTaskBlockFromNote(srcView.data, fromLine);
	if (!edit) {
		srcView.renderNote(srcView.data);
		return false;
	}
	const outcome = await commitBlockRange(srcView.app, srcFile, toBlockRangeOptions(edit));
	srcView.applyOutcome(outcome);
	// 源任务已搬走：选中态不能留在一条不存在的任务上（白名单登记见
	// `scripts/check-view-writes.mjs`：跨文件移动是 selectedLine 的合法清零点之一）。
	srcView.selectedLine = null;
	if (outcome.status !== 'ok') {
		await srcView.reloadFromVault();
		new Notice(
			t('notice.iotoTaskView.crossMoveSourceKept', [dstName]),
		);
		return false;
	}
	srcView.renderNote(srcView.data);
	return true;
}

/**
 * A 主通路：从一个 `IOTOTask` 窗格拖到另一个 `IOTOTask` 窗格。
 *
 * 落点语义与同文件移动完全一致（`moveTaskBlockAcrossNotes` 复用 `resolveAnchor`）。
 */
export async function commitCrossFileMove(
	srcView: TaskViewHost,
	dstView: TaskViewHost,
	fromLine: number,
	drop: TaskDropTarget,
): Promise<void> {
	const srcFile = srcView.file;
	const dstFile = dstView.file;
	if (!srcFile || !dstFile || srcFile.path === dstFile.path) {
		return;
	}
	// 二次守卫：拖拽期状态可能已经变了（目标被改成编辑态 / 过滤态等）。
	if (checkForeignDropTarget(dstView, srcFile.path).ok !== true) {
		return;
	}
	if (!srcView.supportsInlineEdit() || !srcView.data) {
		return;
	}

	await prepareSourceView(srcView);

	const result = moveTaskBlockAcrossNotes(
		srcView.data,
		dstView.data,
		fromLine,
		drop,
	);
	if (!result) {
		// 等价槽位 / 参数无效：纯函数未产出变化，按当前数据重建复原视觉。
		srcView.renderNote(srcView.data);
		return;
	}

	// ③ 先写目标（顺序不可反，见模块头注释）。
	const dstOutcome = await commitBlockRange(
		dstView.app,
		dstFile,
		toBlockRangeOptions(result.target),
	);
	dstView.applyOutcome(dstOutcome);
	if (dstOutcome.status !== 'ok') {
		if (dstOutcome.status === 'conflict') {
			await dstView.reloadFromVault();
		}
		new Notice(
			t('notice.iotoTaskView.crossMoveTargetChanged', [
				dstFile.basename,
			]),
		);
		srcView.renderNote(srcView.data);
		return; // 目标零写入 → 源也不动
	}

	// ④ 再删源；失败只降级提示，不自动回滚。
	await removeSourceBlock(srcView, srcFile, fromLine, dstFile.basename);

	// ⑤ 目标侧：展开折叠节 → 选中新块 → 滚进视野。
	renderTargetSelection(dstView, result.targetNewStartLine);
}

/**
 * A′-1 / A′-2 / B 通路：目标只给了 `TFile`（没有视图），统一「追加到该文件的
 * `<任务>` 节末」——命中节 → 节末；未命中 → 文末新建 `# 任务`。
 *
 * 目标文件若同时开在某个 TaskView 里，会由它自己的 `vault.on('modify')` 刷新，
 * 这里**不主动去找**（找不到也无所谓）。
 */
export async function commitCrossFileMoveToPath(
	srcView: TaskViewHost,
	fromLine: number,
	targetFile: TFile,
): Promise<void> {
	const srcFile = srcView.file;
	if (!srcFile || srcFile.path === targetFile.path) {
		return;
	}
	if (!srcView.supportsInlineEdit() || !srcView.data) {
		return;
	}

	await prepareSourceView(srcView);

	const block = extractTaskBlock(srcView.data, fromLine);
	if (!block) {
		srcView.renderNote(srcView.data);
		return;
	}

	// 用 `read` 不用 `cachedRead`：要最新字节，落点靠它算。
	const targetContent = await srcView.app.vault.read(targetFile);
	const appended = appendTaskBlockToNote(
		targetContent,
		block.blockLines,
		block.level,
		t('view.iotoTaskView.tasksSectionTitle'),
	);
	if (!appended) {
		srcView.renderNote(srcView.data);
		return;
	}

	const outcome = await commitBlockRange(
		srcView.app,
		targetFile,
		toBlockRangeOptions(appended.edit),
	);
	if (outcome.status !== 'ok') {
		new Notice(
			t('notice.iotoTaskView.crossMoveTargetChanged', [
				targetFile.basename,
			]),
		);
		srcView.renderNote(srcView.data);
		return;
	}

	const removed = await removeSourceBlock(
		srcView,
		srcFile,
		fromLine,
		targetFile.basename,
	);
	if (removed) {
		new Notice(
			t('notice.iotoTaskView.crossMoveDone', [targetFile.basename]),
		);
	}
}

/** 命令 / 右键菜单的门禁：可写且当前有选中卡（无选中 → 命令从面板隐藏）。 */
export function canMoveSelectedTaskToFile(view: TaskViewHost): boolean {
	return view.supportsInlineEdit() && view.selectedLine !== null;
}

/** 命令面板入口：把「当前选中的任务」搬到用户挑的另一个任务文件。 */
export function promptMoveSelectedTaskToFile(view: TaskViewHost): void {
	const line = view.selectedLine;
	if (line === null) {
		return;
	}
	promptMoveTaskToFile(view, line);
}

/**
 * 打开文件选择器，选中后走 A′/B 的同一通道（`commitCrossFileMoveToPath`）。
 * 右键菜单传显式行号，命令面板传 `selectedLine`。
 */
export function promptMoveTaskToFile(
	view: TaskViewHost,
	line: number,
): void {
	const srcFile = view.file;
	if (!srcFile) {
		return;
	}
	const { tasksRootPath } = view.taskFileLinkPolicyProvider();
	const files = view.app.vault
		.getMarkdownFiles()
		.filter(
			(file) =>
				file.path !== srcFile.path &&
				isTaskNoteFile(file, tasksRootPath),
		);
	if (files.length === 0) {
		return;
	}
	new MoveTaskFileModal(view.app, {
		files,
		onChoose: (file) => {
			void commitCrossFileMoveToPath(view, line, file);
		},
	}).open();
}
