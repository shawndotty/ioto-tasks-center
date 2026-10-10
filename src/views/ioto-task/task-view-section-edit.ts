import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import { parseSections } from '../../tasks-center/note-structure';
import { getSectionStateKey } from './render-note';
import {
	commitBlockRange,
	type CommitOutcome,
} from './commit-task-line';
import { mountEmbeddedEditor } from './embedded-editor';
import type { TaskViewHost } from './task-view-host';

/**
 * 点 Section 头部「编辑本节」→ 该节**整块源码**（含标题行）换成内嵌核心编辑器
 * （[[Plan-20261010-080827]] 批次 1，B 路线）。
 *
 * - 块范围 = `NoteSection.startLine..endLine`（含标题行，兑现「顺手改名」）；
 * - 与卡片 / 续行编辑器互斥：进入前先提交另外两条链；
 * - 只在退出（Esc / 失焦 / 切换）时提交（Q5：不排 autosave）；
 * - 提交后整树重建（行数几乎必然变，后续 `data-line` 全漂）。
 */

/** 取某 Section 的 DOM 节点（`data-start-line` 由 `render-sections.ts` 输出）。 */
function querySectionEl(
	view: TaskViewHost,
	startLine: number,
): HTMLElement | null {
	return (
		view.bodyEl?.querySelector<HTMLElement>(
			`.ioto-task-view__section[data-start-line="${startLine}"]`,
		) ?? null
	);
}

export async function beginSectionEdit(
	view: TaskViewHost,
	startLine: number,
): Promise<void> {
	if (!view.supportsInlineEdit() || !view.file) {
		new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
		return;
	}
	if (view.sectionEditLine === startLine && view.sectionEditHandle) {
		return;
	}

	// 切换：先提交另一个编辑器（标题 / 续行 / 另一节），互斥
	await view.commitEdit();
	await view.commitContinuationEdit();
	await view.commitSectionEdit();

	const file = view.file;
	if (!file) {
		return;
	}

	// 目标 Section：必须是真标题块（level > 0），引导区无入口（Q6）
	let section = parseSections(view.data).find((s) => s.startLine === startLine);
	if (!section || section.level <= 0) {
		return;
	}

	// 折叠态：先展开再进入（折叠时不渲染 body，点不到；与 beginEdit 同口径）
	if (view.collapsedSections.has(getSectionStateKey(section))) {
		view.collapsedSections.delete(getSectionStateKey(section));
		view.renderNote(view.data);
		section = parseSections(view.data).find((s) => s.startLine === startLine);
		if (!section || section.level <= 0) {
			return;
		}
	}

	// 退出放大：Section 编辑与单卡放大态互斥（Q4）
	if (view.zoomLine !== null) {
		view.exitZoom();
	}

	const sectionEl = querySectionEl(view, startLine);
	if (!sectionEl) {
		return;
	}

	sectionEl.addClass('is-editing');
	// 防御：同一节只允许一个编辑器宿主（历史空壳先清掉）
	sectionEl
		.querySelectorAll(':scope > .ioto-task-view__section-editor')
		.forEach((el) => el.remove());
	const hostEl = sectionEl.createDiv({
		cls: 'ioto-task-view__section-editor',
	});
	view.sectionEditHostEl = hostEl;

	const lines = view.data.split('\n');
	const originalLines = lines.slice(section.startLine, section.endLine + 1);
	const initialValue = originalLines.join('\n'); // 含标题行

	const handle = await mountEmbeddedEditor({
		app: view.app,
		hostEl,
		component: view,
		file,
		initialValue,
		handlers: {
			// 多行源码编辑：Enter 放行给核心真换行（不是新建同级任务）
			onEnter: () => false,
			// 不因清空而删整节（删除整节由提交时的空白判定负责）
			onDeleteEmpty: () => false,
			onIndent: () => false, // Tab 放行核心，本期不接管
			onEscape: () => onSectionEscape(view),
			shouldDeferBlur: () => view.externalWritebackActive,
			onBlurDeferred: () => {
				view.externalWritebackBlurred = true;
			},
			onBlur: () => {
				if (view.externalWritebackActive) {
					view.externalWritebackBlurred = true;
					return;
				}
				void view.commitSectionEdit();
			},
			onChange: () => {
				// Section 编辑只在退出时提交（Q5）：不排 `view.autosave`
				if (view.externalWritebackActive) {
					view.externalWritebackDirty = true;
				}
			},
		},
	});
	if (!handle) {
		sectionEl.removeClass('is-editing');
		hostEl.remove();
		view.sectionEditHostEl = null;
		new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
		return;
	}

	view.sectionEditLine = section.startLine;
	view.sectionEditStartLine = section.startLine;
	view.sectionEditEndLine = section.endLine;
	view.sectionEditOriginalLines = originalLines;
	view.sectionEditHandle = handle;
	// 整节编辑非卡片选中语义：清掉卡片选中类
	view.selectedLine = null;
	view.syncSelectionClass();
	handle.focus();
}

/** `Esc`：先提交、再落回（与续行同构；Section 无卡片选中态可回填）。 */
export function onSectionEscape(view: TaskViewHost): void {
	if (view.sectionEditLine === null || view.sectionEditHandle === null) {
		return;
	}
	// 延后一拍：避免在核心编辑器自己的 keydown 回调里同步卸载它
	window.setTimeout(() => {
		void view.commitSectionEdit();
	}, 0);
}

/**
 * 提交 / 删节：读编辑器正文（**不 trim 尾随换行** —— 块边界即 section 边界）
 * → 整块写回。
 *
 * - 全空白 → 删除整块；
 * - `conflict` 拉权威内容重绘；`unchanged` 不写盘、不重绘；
 * - `ok` → 整树重建（行数会变，后续 `data-line` 全漂）。
 */
export async function commitSectionEdit(view: TaskViewHost): Promise<void> {
	const handle = view.sectionEditHandle;
	if (!handle || view.sectionEditLine === null || !view.file) {
		return;
	}

	const rawText = handle.getValue();
	const startLine = view.sectionEditStartLine;
	const endLine = view.sectionEditEndLine;
	const originalLines = view.sectionEditOriginalLines;
	const file = view.file;
	view.destroySectionEditor();

	const outcome: CommitOutcome = await commitBlockRange(view.app, file, {
		startLine,
		endLine,
		originalLines,
		nextText: rawText,
	});
	view.sectionEditLine = null;
	view.sectionEditOriginalLines = [];
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}
	if (outcome.status !== 'ok') {
		return; // unchanged：无写入，无需重绘
	}
	// 行数可能变化 → 整树重建（带滚动快照）
	view.renderNote(view.data);
}

/** 销毁 Section 编辑器：去 DOM 编辑态 + 卸载 handle + 置空（比对 destroyContinuationEditor）。 */
export function destroySectionEditor(view: TaskViewHost): void {
	view.autosave.cancel();
	const handle = view.sectionEditHandle;
	// 先置空，保证随后触发的 blur 走到 commitSectionEdit 时直接短路。
	view.sectionEditHandle = null;
	if (handle) {
		try {
			handle.destroy();
		} catch {
			/* ignore */
		}
	}
	// destroy() 只 empty 了子节点，宿主 div 仍在 → 显式移除并置空
	view.sectionEditHostEl?.remove();
	view.sectionEditHostEl = null;
	const startLine = view.sectionEditLine;
	if (startLine !== null) {
		querySectionEl(view, startLine)?.removeClass('is-editing');
	}
}

/**
 * Section 编辑态自动落盘：**只写盘，不退出编辑态**（供外部写回窗口结束路径调用）。
 *
 * 不 destroy、不 `renderNote`；成功后按最新 `data` 重算块范围（起止行号 + 原文），
 * 否则下一次落盘用旧序列判 `conflict`。
 */
export async function autosaveSection(view: TaskViewHost): Promise<void> {
	const handle = view.sectionEditHandle;
	const startLine = view.sectionEditLine;
	const file = view.file;
	if (!handle || startLine === null || !file) {
		return;
	}
	if (view.autosaveRunning) {
		return;
	}

	const nextText = handle.getValue();

	view.autosaveRunning = true;
	try {
		const outcome = await commitBlockRange(view.app, file, {
			startLine: view.sectionEditStartLine,
			endLine: view.sectionEditEndLine,
			originalLines: view.sectionEditOriginalLines,
			nextText,
		});

		// 落盘期间已退出编辑：以随后那次提交为准，不再改内存 / 快照
		if (
			view.sectionEditHandle !== handle ||
			view.sectionEditLine !== startLine
		) {
			return;
		}
		view.syncCommittedContent(outcome);
		if (outcome.status === 'ok') {
			// 行数可能变化 → 按最新 data 重算块范围
			const section = parseSections(view.data).find(
				(s) => s.startLine === startLine,
			);
			if (section) {
				const lines = view.data.split('\n');
				view.sectionEditEndLine = section.endLine;
				view.sectionEditOriginalLines = lines.slice(
					section.startLine,
					section.endLine + 1,
				);
			}
		}
	} finally {
		view.autosaveRunning = false;
	}
}
