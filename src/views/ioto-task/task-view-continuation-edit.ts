import type { EditorView } from '@codemirror/view';
import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	continuationIndentForTaskLine,
	dedentLines,
	indentContinuationLines,
	isTaskContinuationLine,
	parentIndentLevelOfTaskLine,
	shouldDelegateContinuationEnter,
} from '../../tasks-center/note-structure';
import {
	commitTaskContinuation,
	commitTaskLineAction,
	type CommitOutcome,
} from './commit-task-line';
import { mountEmbeddedEditor } from './embedded-editor';
import type { EmbeddedEditorHandle } from './embedded-editor';
import type { TaskViewHost } from './task-view-host';

/**
 * 点续行块进入就地多行编辑。
 *
 * - 与标题编辑器互斥：进入前先提交标题 / 其它续行编辑器；
 * - 块范围 = `line + 1` 起连续 `isTaskContinuationLine`；编辑器持有 dedent 后文本；
 * - 提交 / 失焦走 `commitContinuationEdit`，整树重建（续行行数会变，后续卡会漂）。
 */
export async function beginContinuationEdit(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	if (!view.supportsInlineEdit() || !view.file) {
		new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
		return;
	}
	if (view.continuationLine === line && view.continuationHandle) {
		return;
	}

	// 切换：先提交另一个编辑器（标题 / 另一条续行 / Section / 节标题），互斥
	await view.commitEdit();
	await view.commitContinuationEdit();
	await view.commitSectionEdit();
	await view.commitSectionTitleEdit();

	const file = view.file;
	if (!file) {
		return;
	}

	// 块范围：line + 1 起连续 isTaskContinuationLine（父缩进 = 任务行缩进）
	const lines = view.data.split('\n');
	const parent = parentIndentLevelOfTaskLine(lines[line] ?? '');
	let end = line + 1;
	while (
		end < lines.length &&
		isTaskContinuationLine(lines[end] ?? '', parent)
	) {
		end += 1;
	}
	if (end === line + 1) {
		return; // 无续行（DOM 与 data 不一致的兜底）
	}
	const originalLines = lines.slice(line + 1, end);

	const cardEl = view.queryCard(line);
	const contEl = cardEl?.querySelector<HTMLElement>(
		'.ioto-task-view__card-continuation',
	);
	if (!contEl) {
		return;
	}

	contEl.addClass('is-editing');
	// 防御：同一个 .card-continuation 只允许存在一个续行宿主（历史空壳先清掉）
	contEl
		.querySelectorAll(':scope > .ioto-task-view__continuation-editor')
		.forEach((el) => el.remove());
	const hostEl = contEl.createDiv({
		cls: 'ioto-task-view__continuation-editor',
	});
	view.continuationHostEl = hostEl;

	const handle = await mountEmbeddedEditor({
		app: view.app,
		hostEl,
		component: view,
		file,
		initialValue: dedentLines(originalLines.join('\n')), // 去公共前缀后再编辑
		handlers: {
			// Enter / Shift+Enter 都换行（忽略 shiftKey）
			onEnter: (cm) => view.onContinuationEnter(cm),
			onDeleteEmpty: () => view.onContinuationDeleteEmpty(),
			onIndent: () => false, // Tab 放行给核心（插入缩进），本期不接管
			onEscape: () => view.onContinuationEscape(),
			shouldDeferBlur: () => view.externalWritebackActive,
			onBlurDeferred: () => {
				view.externalWritebackBlurred = true;
			},
			onBlur: () => {
				if (view.externalWritebackActive) {
					view.externalWritebackBlurred = true;
					return;
				}
				void view.commitContinuationEdit();
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
		contEl.removeClass('is-editing');
		hostEl.remove();
		view.continuationHostEl = null;
		new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
		return;
	}

	view.continuationLine = line;
	view.continuationStartLine = line + 1;
	view.continuationEndLine = end - 1;
	view.continuationOriginalLines = originalLines;
	view.continuationHandle = handle;
	view.applySelection(line); // 卡片高亮 + 清掉旧选中
	handle.focus();
}

/**
 * 起一个**空草稿**续行编辑器（磁盘上尚无可编辑的续行块）。
 *
 * 与 `beginContinuationEdit` 同构，差别只在：空种子 / 磁盘上无块（不读块范围）/
 * 卡片底部无 `.card-continuation` 时临时建一个（`continuationDraftContainerEl`）。
 * **有内容才落盘**（空草稿在磁盘上不可表示，`isTaskContinuationLine('')` 恒 `false`）；
 * 提交统一走 `commitContinuationEdit` 的「任务行展开」分支。
 */
export async function beginNewContinuationEdit(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	if (!view.supportsInlineEdit() || !view.file) {
		new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
		return;
	}
	if (view.continuationLine === line && view.continuationHandle) {
		return;
	}

	// 切换：先提交另一个编辑器（标题 / 另一条续行 / Section / 节标题），互斥
	await view.commitEdit();
	await view.commitContinuationEdit();
	await view.commitSectionEdit();
	await view.commitSectionTitleEdit();

	const file = view.file;
	if (!file) {
		return;
	}
	const cardEl = view.queryCard(line);
	if (!cardEl) {
		return;
	}
	if (continuationIndentForTaskLine(view.lineAt(line)) === null) {
		return; // 非任务行（DOM 与 data 不一致的兜底）
	}

	// 卡片底部：无续行容器则临时建一个（草稿专用）
	let contEl = cardEl.querySelector<HTMLElement>(
		'.ioto-task-view__card-continuation',
	);
	let createdContainer = false;
	if (!contEl) {
		contEl = cardEl.createDiv({
			cls: 'ioto-task-view__card-continuation',
			attr: { 'data-line': String(line) },
		});
		createdContainer = true;
	}
	contEl.addClass('is-editing');
	// 防御：同一容器只允许一个编辑器宿主（历史空壳先清掉）
	contEl
		.querySelectorAll(':scope > .ioto-task-view__continuation-editor')
		.forEach((el) => el.remove());
	const hostEl = contEl.createDiv({
		cls: 'ioto-task-view__continuation-editor',
	});
	view.continuationHostEl = hostEl;
	view.continuationDraftContainerEl = createdContainer ? contEl : null;

	const handle = await mountEmbeddedEditor({
		app: view.app,
		hostEl,
		component: view,
		file,
		initialValue: '', // 空种子：有内容才落盘
		handlers: {
			onEnter: (cm) => view.onContinuationEnter(cm),
			onDeleteEmpty: () => view.onContinuationDeleteEmpty(),
			onIndent: () => false,
			onEscape: () => view.onContinuationEscape(),
			shouldDeferBlur: () => view.externalWritebackActive,
			onBlurDeferred: () => {
				view.externalWritebackBlurred = true;
			},
			onBlur: () => {
				if (view.externalWritebackActive) {
					view.externalWritebackBlurred = true;
					return;
				}
				void view.commitContinuationEdit();
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
		contEl.removeClass('is-editing');
		hostEl.remove();
		if (createdContainer) {
			contEl.remove();
		}
		view.continuationHostEl = null;
		view.continuationDraftContainerEl = null;
		new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
		return;
	}

	view.continuationLine = line;
	view.continuationStartLine = line + 1; // 草稿期占位，提交时不用
	view.continuationEndLine = line; // 空区间（start > end）
	view.continuationOriginalLines = [];
	view.continuationIsNew = true;
	view.continuationHandle = handle;
	view.applySelection(line);
	handle.focus();
}

/**
 * 续行编辑器 Enter：
 * - 普通列表行 → 放行核心（原生补 marker / 序号 / 空项退出）；
 * - 其余行 → 光标处裸换行（原语义，含 Shift+Enter）。
 */
export function onContinuationEnter(view: TaskViewHost, cm: EditorView): boolean {
	const { from, to } = cm.state.selection.main;
	const line = cm.state.doc.lineAt(from).text;
	if (shouldDelegateContinuationEnter(line)) {
		return false;
	}
	cm.dispatch({
		changes: { from, to, insert: '\n' },
		selection: { anchor: from + 1 },
		scrollIntoView: true,
	});
	return true;
}

/** 空内容 `Backspace`：删除整段续行并退出编辑。 */
export function onContinuationDeleteEmpty(view: TaskViewHost): boolean {
	window.setTimeout(() => void view.commitContinuationEdit(true), 0);
	return true;
}

/** `Esc`：先提交、再落回本卡选择态（与标题编辑器同构）。 */
export function onContinuationEscape(view: TaskViewHost): void {
	const line = view.continuationLine;
	if (line === null || view.continuationHandle === null) {
		return;
	}
	view.selectedLine = line;
	window.setTimeout(() => {
		void view.commitContinuationEdit().then(() => {
			const cardEl = view.queryCard(line);
			if (!cardEl) {
				view.renderNote(view.data);
				view.syncSelectionClass();
				return;
			}
			view.applySelection(line);
		});
	}, 0);
}

/**
 * 提交 / 删段：读编辑器正文（去末尾空行）→ 按原公共前缀重新缩进写回。
 *
 * - **新建草稿**（`continuationIsNew`）：走「任务行展开」`commitTaskLineAction`，
 *   缩进从任务行推导；空草稿不落盘（磁盘上不可表示空续行）；
 * - **既有块**：`commitTaskContinuation` 整段替换（`''` → 删段，语义不变）；
 * - `forceEmpty`（空内容 `Backspace`）直接视为删段；
 * - 续行行数会变、后续卡 `data-line` 会漂 → 退出后**必须**整树重建；
 * - `conflict` 拉权威内容重绘；`ok` / `unchanged` 退出后**均**整树重建
 *   （`unchanged` 只表示磁盘无需再写，不代表 DOM 与 `data` 一致：
 *   编辑期节流自动落盘已同步 `view.data` 但不重绘）。[[Research-20261019-113227]] §4.1
 * - **编辑器 DOM 必须留到写盘 await 之后**再拆：`.is-editing` 一撤，只读区会立刻
 *   显示**进入编辑前的旧内容**；若这发生在 await 之前，浏览器会先画一帧「旧内容
 *   高度」，写完后 `renderNote` 再撑开 → 输入框「先缩小再扩大」
 *   （[[Report-20261019-115725]] §2）。
 */
export async function commitContinuationEdit(
	view: TaskViewHost,
	forceEmpty = false,
): Promise<void> {
	const handle = view.continuationHandle;
	if (!handle || view.continuationLine === null || !view.file) {
		return;
	}

	const rawText = handle.getValue();
	// 去掉末尾空行（编辑器习惯）；forceEmpty（空内容 Backspace）直接视为删段
	let nextText = rawText.replace(/\n+$/u, '');
	if (forceEmpty || rawText.trim().length === 0) {
		nextText = '';
	}

	const line = view.continuationLine;
	const startLine = view.continuationStartLine;
	const endLine = view.continuationEndLine;
	const originalLines = view.continuationOriginalLines;
	const isNew = view.continuationIsNew;
	const file = view.file;
	// 逻辑退出立刻生效（切断 blur / 自动落盘的重入），DOM 拆除延后到重绘前。
	view.autosave.cancel();
	view.continuationHandle = null;
	const releaseDom = (): void => {
		teardownContinuationEditorDom(
			view,
			handle,
			line,
			view.continuationDraftContainerEl,
		);
	};

	// ① 新草稿 + 空内容：磁盘上不可表示空续行 → 不落盘、不重绘
	if (isNew && nextText.length === 0) {
		view.continuationLine = null;
		view.continuationOriginalLines = [];
		releaseDom();
		return;
	}

	let outcome: CommitOutcome;
	if (isNew) {
		// ② 新建块：任务行展开成 `[任务行, ...新续行]`，缩进从任务行推导
		//（空块的 `commonIndentPrefix([])` 恒为 `''`，不能沿用）。
		const indent = continuationIndentForTaskLine(view.lineAt(line));
		if (indent === null) {
			view.continuationLine = null;
			view.continuationOriginalLines = [];
			releaseDom();
			return;
		}
		outcome = await commitTaskLineAction(view.app, file, {
			line,
			originalLine: view.lineAt(line),
			transform: (raw) => [
				raw,
				...indentContinuationLines(nextText, indent),
			],
			insertAfterContinuations: true, // 与既有续行（若竞态中出现）不抢位
		});
	} else {
		outcome = await commitTaskContinuation(view.app, file, {
			startLine,
			endLine,
			originalLines,
			nextText,
		});
	}
	view.continuationLine = null;
	view.continuationOriginalLines = [];
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		releaseDom();
		view.renderNote(view.data);
		return;
	}
	// 退出编辑的唯一收尾：除 conflict 外一律按最新 data 整树重建。
	// `unchanged` 只代表「磁盘无需再写」——编辑期的节流自动落盘可能已把新正文
	// 写盘并同步 `view.data`（autosaveContinuation 设计上不重绘），此刻只读 DOM
	// 仍停在进入编辑前的快照；续行行数若已变，后续卡片的 data-line 也一起漂。
	// 不能只 refreshCard(line)：行号漂移必须整树重算。[[Research-20261019-113227]] §4.1
	// releaseDom 与 renderNote 必须同在一个同步任务里：拆 DOM 会让卡片先退回**旧的**
	// 只读续行（高度塌缩），若两者之间隔着帧边界就是用户看到的「先缩小再扩大」。
	releaseDom();
	view.selectedLine = line;
	view.renderNote(view.data);
}

/** 续行编辑器 DOM 拆除（`destroyContinuationEditor` 与提交收尾共用）。 */
function teardownContinuationEditorDom(
	view: TaskViewHost,
	handle: EmbeddedEditorHandle | null,
	line: number | null,
	draftContainerEl: HTMLElement | null,
): void {
	if (handle) {
		try {
			handle.destroy();
		} catch {
			/* ignore */
		}
	}
	// destroy() 只 empty 了子节点，宿主 div 仍在 → 显式移除并置空
	view.continuationHostEl?.remove();
	view.continuationHostEl = null;
	if (line !== null) {
		view.queryCard(line)
			?.querySelector('.ioto-task-view__card-continuation')
			?.removeClass('is-editing');
	}
	// 新建草稿时临时建的空续行容器：一并回收，绝不留空壳
	if (draftContainerEl) {
		view.continuationDraftContainerEl = null;
		draftContainerEl.remove();
	}
	view.continuationIsNew = false;
}

/** 销毁续行编辑器：去 DOM 编辑态 + 卸载 handle + 置空（比对 `destroyActiveEditor`）。 */
export function destroyContinuationEditor(view: TaskViewHost): void {
	view.autosave.cancel();
	// 先置空，保证随后触发的 blur 走到 commitContinuationEdit 时直接短路。
	const handle = view.continuationHandle;
	view.continuationHandle = null;
	teardownContinuationEditorDom(
		view,
		handle,
		view.continuationLine,
		view.continuationDraftContainerEl,
	);
}

/**
 * 续行编辑态自动落盘：**只写盘，不退出编辑态**。
 *
 * 不 destroy、不 `renderNote`（避免编辑被打断）；成功后刷新续行块快照
 * （起止行号 + 原文），否则下一次落盘用旧序列判 `conflict`。
 */
export async function autosaveContinuation(view: TaskViewHost): Promise<void> {
	if (view.continuationIsNew) {
		return; // 草稿不自动落盘：首次写入统一由 blur / Esc 的 commitContinuationEdit 完成
	}
	const handle = view.continuationHandle;
	const line = view.continuationLine;
	const file = view.file;
	if (!handle || line === null || !file) {
		return;
	}
	if (view.autosaveRunning) {
		return;
	}

	const nextText = handle.getValue().replace(/\n+$/u, '');

	view.autosaveRunning = true;
	try {
		const outcome = await commitTaskContinuation(view.app, file, {
			startLine: view.continuationStartLine,
			endLine: view.continuationEndLine,
			originalLines: view.continuationOriginalLines,
			nextText,
		});

		// 落盘期间已退出编辑：以随后那次提交为准，不再改内存 / 快照
		if (view.continuationHandle !== handle || view.continuationLine !== line) {
			return;
		}
		view.syncCommittedContent(outcome);
		if (outcome.status === 'ok') {
			// 行数可能变化 → 按最新 data 重算块范围（父缩进 = 任务行缩进）
			const lines = view.data.split('\n');
			const parent = parentIndentLevelOfTaskLine(lines[line] ?? '');
			let end = line + 1;
			while (
				end < lines.length &&
				isTaskContinuationLine(lines[end] ?? '', parent)
			) {
				end += 1;
			}
			view.continuationStartLine = line + 1;
			view.continuationEndLine = end - 1;
			view.continuationOriginalLines = lines.slice(line + 1, end);
		}
	} finally {
		view.autosaveRunning = false;
	}
}
