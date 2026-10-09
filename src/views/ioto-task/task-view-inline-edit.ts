import { MarkdownRenderer, Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	parseChecklistItems,
	parseSections,
	splitTaskLine,
} from '../../tasks-center/note-structure';
import { applySearchHighlight } from './search-highlight';
import { normalizeQuery } from './task-query-filter';
import { commitTaskText } from './commit-task-line';
import { mountEmbeddedEditor } from './embedded-editor';
import { getSectionStateKey, renderCardActions } from './render-note';
import type { IOTOTaskView } from '../iotoTaskView';
import { lineAt, queryCard } from './task-view-helpers';

/** 销毁标题编辑器：先撤 autosave、置空 handle、再 destroy（防递归）。 */
export function destroyActiveEditor(view: IOTOTaskView): void {
	// 编辑器没了，待写的那次也就没意义了（blur 提交会写最终值）
	view.autosave.cancel();
	const handle = view.editingHandle;
	// 先置空，保证随后触发的 blur 走到 commitEdit 时直接短路，不会递归。
	view.editingHandle = null;
	if (handle) {
		try {
			handle.destroy();
		} catch {
			/* ignore */
		}
	}
}

export async function beginEdit(
	view: IOTOTaskView,
	line: number,
	caretOffset?: number | null,
): Promise<void> {
	if (!view.supportsInlineEdit() || !view.file) {
		new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
		return;
	}

	if (view.editingLine === line && view.editingHandle) {
		return;
	}

	// 方案 A：放大态只服务放大那张卡。要编辑别的卡（添加任务 / 插入模板 / 拆行等
	// 会 beginEdit 新行）先退出放大，回到常规两段式状态机，避免「放大错卡」错位。
	if (view.zoomLine !== null && view.zoomLine !== line) {
		view.exitZoom();
	}

	// 切换卡片：先提交上一个（标题编辑器 + 续行编辑器互相排斥）
	await view.commitEdit();
	await view.commitContinuationEdit();

	const file = view.file;
	if (!file) {
		return;
	}

	let cardEl = queryCard(view, line);
	if (!cardEl) {
		// 目标卡不在 DOM：多半是其 Section 处于折叠态（`renderSection` 折叠时直接
		// return，卡片根本不生成）。先展开目标 Section 再重绘一次，否则「添加了却
		// 看不到 / 进不了编辑」（[[Discuss-20261008-164745]] §四·2 / Q3）。
		if (expandSectionContaining(view, line)) {
			view.renderNote(view.data);
			cardEl = queryCard(view, line);
		}
	}
	if (!cardEl) {
		return;
	}

	const item = parseChecklistItems(view.data, {
		includeEmpty: true,
	}).find((entry) => entry.line === line);
	if (!item) {
		return;
	}

	const textEl = cardEl.querySelector<HTMLElement>(
		'.ioto-task-view__card-text',
	);
	if (!textEl) {
		return;
	}

	const hostEl = textEl.createDiv({
		cls: 'ioto-task-view__card-editor',
	});
	const originalLine = lineAt(view, line);

	const handle = await mountEmbeddedEditor({
		app: view.app,
		hostEl,
		component: view,
		file,
		initialValue: item.text,
		handlers: {
			onEnter: (cm, shiftKey) => view.onEditorEnter(cm, shiftKey),
			onSoftBreak: (cm) => view.onEditorSoftBreak(cm),
			onDeleteEmpty: () => view.onEditorDeleteEmpty(),
			onIndent: (delta) => view.onEditorIndent(delta),
			onEscape: () => view.onEditorEscape(),
			shouldDeferBlur: () => view.externalWritebackActive,
			onBlurDeferred: () => {
				view.externalWritebackBlurred = true;
			},
			onBlur: () => {
				// 兜底：窗口内即便被直接调用也不提交（主短路在 embedded-editor）。
				if (view.externalWritebackActive) {
					view.externalWritebackBlurred = true;
					return;
				}
				// blur 提交会写同一行的最终值，先撤掉待写的那次（内容相同，属无效写）
				view.autosave.cancel();
				// 方案 A：放大卡失焦**只落盘、不退出编辑态**（否则回落选中态）。
				// 编辑器不销毁、`.is-editing` 保留；焦点由随后的点击处理器交还编辑器。
				if (view.zoomLine === line) {
					void view.flushZoomEdit();
					return;
				}
				void view.commitEdit().then(() => {
					// 提交完成后按需把焦点还原到卡片（点空白的修复路径）
					view.restoreSelectionFocusAfterBlurCommit(line);
				});
			},
			onChange: () => {
				if (view.externalWritebackActive) {
					view.externalWritebackDirty = true;
					return;
				}
				view.autosave.schedule();
			},
		},
	});

	if (!handle) {
		hostEl.remove();
		new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
		return;
	}

	view.editingLine = line;
	view.editingOriginalLine = originalLine;
	view.editingHandle = handle;
	cardEl.addClass('is-editing');
	// `selected` 是 `editing` 的前置态：进编辑必先选中。走 `applySelection`
	// 而不是直接 addClass，是为了顺带清掉上一张卡的残留选中类
	//（`runLineAction` 新建兄弟行后直接编辑的路径上，旧行仍在 DOM 里）。
	view.applySelection(line);
	// 焦点给编辑器（`applySelection` 刚把焦点放在卡片上）
	handle.focus();
	// 模板 `%%Cursor%%`：挂载后默认落末尾，这里覆盖到指定偏移（clamp 在 handle 内）。
	if (typeof caretOffset === 'number') {
		handle.setCursor(caretOffset);
	}

	// 方案 A1（[[Discuss-20261008-164745]] §三）：把「滚入目标卡」推迟到下一帧。
	// `renderNote` 里 `restoreIotoTaskScroll` 会**排一个 rAF**（ioto-task-scroll.ts:133-141），
	// 下一帧把 `scrollTop` 写回重建前的位置；`applySelection` 的同步滚入会被它覆盖，
	// 导致新增任务虽获得焦点却重新掉出视口（列表越长越明显）。rAF 回调按注册顺序 FIFO，
	// 这里注册更晚 → 后跑 → 成为最后一个写 `scrollTop` 的人。`nearest` 只在必要时滚，
	// 已在视口内的卡零跳动。落在 `beginEdit` 这条共用链上，「添加任务」/`Enter` 拆行/
	// 条目模板插入三条路径一并修复。`cardEl` 可能因上面的展开重绘而失效，故重新取卡。
	if (typeof window !== 'undefined' && window.requestAnimationFrame) {
		window.requestAnimationFrame(() => {
			const target = queryCard(view, line);
			if (target) {
				view.scrollCardIntoView(target);
			}
		});
	}
}

/**
 * 目标行所在的 Section 若处于折叠态，就地展开它；返回是否发生了展开。
 *
 * 只有**顶层 Section** 会进 `collapsedSections`（`renderTaskNote` 只对 roots 调
 * `renderSection`），所以按「命中 key 在集合内」判定即可，无需再算顶层结构。
 * 展开后调用方需重绘一次才能取到卡片（[[Discuss-20261008-164745]] §四·2 / Q3）。
 */
export function expandSectionContaining(
	view: IOTOTaskView,
	line: number,
): boolean {
	for (const section of parseSections(view.data)) {
		const key = getSectionStateKey(section);
		if (!view.collapsedSections.has(key)) {
			continue;
		}
		if (line >= section.startLine && line <= section.endLine) {
			view.collapsedSections.delete(key);
			return true;
		}
	}
	return false;
}

export async function commitEdit(view: IOTOTaskView): Promise<void> {
	if (view.pendingCommit) {
		await view.pendingCommit;
		return;
	}

	if (
		view.editingHandle === null ||
		view.editingLine === null ||
		!view.file
	) {
		return;
	}

	view.pendingCommit = doCommitEdit(view);
	try {
		await view.pendingCommit;
	} finally {
		view.pendingCommit = null;
	}
}

export async function doCommitEdit(view: IOTOTaskView): Promise<void> {
	const handle = view.editingHandle;
	const line = view.editingLine;
	const originalLine = view.editingOriginalLine;
	const file = view.file;
	if (!handle || line === null || !file) {
		return;
	}

	const nextBody = handle.getValue();
	view.destroyActiveEditor();

	if (nextBody.includes('\n')) {
		new Notice(t('notice.iotoTaskView.bodyMultilineRejected'));
		view.editingLine = null;
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}

	const outcome = await commitTaskText(view.app, file, {
		line,
		originalLine,
		nextBody,
	});
	view.editingLine = null;
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		// 外部已改，拉权威内容；冲突是罕见路径，允许整树重建。
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}

	// ② 开启且该行现已完成：编辑期间这张卡由「编辑中兜底」保持可见，退出编辑
	// 边界要整树重绘才能真正收走（refreshCard 不重算可见性）（[[Report-20261007-092357]] §5.3）。
	const committed = splitTaskLine(lineAt(view, line));
	if (view.filters.onlyPending && committed?.checked.toLowerCase() === 'x') {
		view.renderNote(view.data);
		return;
	}

	// 纯文本提交「行数 / 缩进 / 其它卡片」全都没变，就地刷新单卡即可：
	// 既不会跳顶，也不会因整树重建吞掉正在进行的第二次点击（[[Plan-20261003-094145]] §5.3）。
	view.refreshCard(line);
}

/**
 * 就地重建该卡片的动作区徽章（入口：条目控制面板写回后 / 单卡刷新）。
 * 只读 `view.data`（此时已是最新），复用渲染层 `renderCardActions`；
 * 不重建卡片、不碰正文区与内联编辑器，因此不丢编辑态、不影响滚动位置。
 * `queryCard` 未命中（行漂移 / 卡片被折叠）时静默跳过，交后续整树渲染兜底。
 */
export function refreshCardActions(view: IOTOTaskView, line: number): void {
	const cardEl = queryCard(view, line);
	if (!cardEl) {
		return;
	}
	const item = parseChecklistItems(view.data, {
		includeEmpty: true,
	}).find((entry) => entry.line === line);
	renderCardActions(cardEl, item?.controls ?? [], {
		line,
		editing: view.buildEditingController(),
	});
}

/**
 * 只刷新单张卡片：去掉编辑态、卸掉空编辑器容器、按最新 `data` 重渲染正文。
 *
 * 前提：调用方只改了该行**正文**（`replaceTaskBody` 保留 checked / indent / controls）。
 * 若将来提交语义扩展到改 `data-task` / `data-indent` 等属性，这里会漏更新，需改回整树重建。
 */
export function refreshCard(view: IOTOTaskView, line: number): void {
	const cardEl = queryCard(view, line);
	if (!cardEl) {
		// 行号漂移 / 卡片被折叠：退回整树重建。
		view.renderNote(view.data);
		return;
	}

	cardEl.removeClass('is-editing');
	const textEl = cardEl.querySelector<HTMLElement>(
		'.ioto-task-view__card-text',
	);
	if (!textEl) {
		return;
	}

	const item = parseChecklistItems(view.data, {
		includeEmpty: true,
	}).find((entry) => entry.line === line);

	// 顺带移除 `.card-editor` 空壳（destroyActiveEditor 只清空了它的子节点）。
	textEl.empty();
	// 与标题路径对称：顺带清掉续行容器的历史空壳
	cardEl
		.querySelector('.ioto-task-view__card-continuation')
		?.querySelectorAll(':scope > .ioto-task-view__continuation-editor')
		.forEach((el) => el.remove());
	if (item) {
		void MarkdownRenderer.render(
			view.app,
			item.text,
			textEl,
			view.file?.path ?? '',
			view,
		);
		// 就地重绘只重建标题（不动续行容器），续行里的高亮自然保留，只需对标题复跑。
		// `applySearchHighlight` 自带 unwrap，重复调用安全（[[Discuss-20261006-183552]] §4.3）。
		applySearchHighlight(textEl, normalizeQuery(view.searchQuery));
	}
	// 动作区也按最新 `data` 重建（幂等），覆盖 blur 提交等所有「就地刷单卡」路径。
	view.refreshCardActions(line);
	// 标题纯文本提交（`doCommitEdit` 已清 `editingLine`）不走 renderNote，
	// 必须在此重算删除按钮显隐，否则退出编辑后按钮不回来（§4.4 落点 D / 坑 6）。
	view.refreshDeleteButtonVisibility();
}

/**
 * 编辑态自动落盘：**只写盘，不退出编辑态**（与 `commitEdit()` 并列，不复用）。
 *
 * 与 `doCommitEdit()` 的三点区别：
 * 1. 不调 `destroyActiveEditor()` —— 编辑器、光标、滚动位置、选中态全部保留；
 * 2. 不 `refreshCard` / `renderNote` —— 纯正文变更不改变行数 / 缩进 / 其它卡片；
 * 3. conflict 静默跳过（不 Notice、不重建），交给最终 blur 提交统一处理。
 *
 * 🔴 红线：成功后必须刷新 `editingOriginalLine`，否则下一次落盘的
 * `lines[index] === originalLine` 校验失配 → 判 conflict → 整树重建冲掉编辑态。
 */
export async function autosaveEdit(view: IOTOTaskView): Promise<void> {
	// 续行编辑态：只写盘、不退出编辑（与标题自动落盘同构）
	if (view.continuationHandle && view.continuationLine !== null) {
		await view.autosaveContinuation();
		return;
	}

	const handle = view.editingHandle;
	const line = view.editingLine;
	const file = view.file;
	if (!handle || line === null || !file) {
		return;
	}
	// 与 blur 提交 / 上一次落盘互斥
	if (view.pendingCommit !== null || view.autosaveRunning) {
		return;
	}

	const nextBody = handle.getValue();
	// 与 `doCommitEdit` 同一守卫：换行会破坏任务行结构，交给最终提交去弹提示
	if (nextBody.includes('\n')) {
		return;
	}

	view.autosaveRunning = true;
	try {
		const outcome = await commitTaskText(view.app, file, {
			line,
			originalLine: view.editingOriginalLine,
			nextBody,
		});

		// 落盘期间已退出编辑（blur / 卸载 / `clear()`）：磁盘与内存都以随后那次
		// 提交的 outcome 为准，这里不再改内存，也不再动 `editingOriginalLine`
		//（它可能已被重置或指向另一行）。
		if (view.editingHandle !== handle || view.editingLine !== line) {
			return;
		}
		view.syncCommittedContent(outcome);
		if (outcome.status === 'ok') {
			view.editingOriginalLine = lineAt(view, line);
		}
	} finally {
		view.autosaveRunning = false;
	}
}
