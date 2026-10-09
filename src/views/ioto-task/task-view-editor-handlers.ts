import type { EditorView } from '@codemirror/view';
import { Notice, setIcon } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	buildSiblingTaskLine,
	insertSoftBreak,
	replaceTaskBody,
	setTaskIndent,
	SOFT_BREAK,
	toggleTaskMarker,
} from '../../tasks-center/note-structure';
import {
	collectCardLines,
	pickAdjacentLine,
} from './card-navigation';
import {
	captureCardSnapshots,
	prepareSwapTransition,
} from './list-transition';
import { IOTO_TASK_CARD_SELECTOR, IOTO_TASK_SCROLL_SELECTOR } from './ioto-task-scroll';
import {
	commitTaskLineAction,
	type CommitOutcome,
	type TaskLineTransform,
} from './commit-task-line';
import type { IOTOTaskView } from '../iotoTaskView';
import { lineAt } from './task-view-helpers';

/**
 * `Esc`：**先提交、再落回本卡选择态**（[[Discuss-20261003-194148]] §七.1 已确认）。
 *
 * 与旧路径的区别：**不再丢弃未提交内容**、**不再无选中地整树重绘**——
 * 提交走 `commitEdit`，无冲突时就地刷单卡（`refreshCard` 去 `is-editing`、
 * 保留 `.is-selected`），因此既不跳顶也不丢数据。
 */
export function onEditorEscape(view: IOTOTaskView): void {
	const line = view.editingLine;
	if (line === null || view.editingHandle === null) {
		return;
	}

	// 方案 A（[[Discuss-20261008-173935]] Q4）：放大态 Esc = **提交文本 + 保持编辑态**，
	// 不再回落选中态。延后一拍：避免在核心编辑器自己的 keydown 回调里同步动作。
	if (view.zoomLine === line) {
		window.setTimeout(() => {
			void view.flushZoomEdit();
		}, 0);
		return;
	}

	// 先落状态：提交途中若发生冲突重绘，选中也能被回填
	view.selectedLine = line;
	// 延后一拍：避免在核心编辑器自己的 keydown 回调里同步卸载它
	window.setTimeout(() => {
		void view.commitEdit().then(() => {
			const cardEl = view.queryCard(line);
			if (!cardEl) {
				// 冲突重绘把卡挪没/折叠了：重建后回填
				view.renderNote(view.data);
				view.syncSelectionClass();
				return;
			}
			// 走 `applySelection`：它会先清掉上一张卡的残留选中类
			//（旧路径只 addClass，实测会留下 2 张 `.is-selected`）。
			view.applySelection(line);
		});
	}, 0);
}

/**
 * 标题编辑器：`Mod+Enter` 在光标 / 选区处插入 `<br>`（标题行内换行）。
 *
 * 只插字面 `<br>`、全程无 `\n` → `replaceTaskBody` / `autosaveEdit` 的换行守卫
 * 不会被触发；dispatch 触发 `onChange → autosave`，`<br>` 在**不退出编辑态**的情况
 * 下自动落盘，Live Preview 立即渲染为折行。续写区不注册 `onSoftBreak`，语义不受影响。
 */
export function onEditorSoftBreak(view: IOTOTaskView, cm: EditorView): boolean {
	if (!view.editingHandle || view.editingLine === null) {
		return false;
	}
	const sel = cm.state.selection.main;
	const { cursor } = insertSoftBreak(
		cm.state.doc.toString(),
		sel.from,
		sel.to,
	);
	cm.dispatch({
		changes: { from: sel.from, to: sel.to, insert: SOFT_BREAK },
		selection: { anchor: cursor },
	});
	return true;
}

export function onEditorEnter(
	view: IOTOTaskView,
	cm: EditorView,
	shiftKey: boolean,
): boolean {
	const handle = view.editingHandle;
	const line = view.editingLine;
	if (!handle || line === null) {
		return false;
	}

	const text = handle.getValue();
	const originalLine = view.editingOriginalLine;
	// 新行落点 = 「任务行 + 其下连续续行」之后
	const nextEditLine = line + 1 + view.countContinuationLines(line);

	// Shift+Enter：进入 / 新增续写区（标题正文的落盘交给 beginContinuationOrNew
	// 内部的 commitEdit）——与 Markdown View 的「Shift+Enter 软换行续写」手感一致。
	// 选择态 Shift+Enter 仍是新建同级任务（insertSibling），此处只改编辑态。
	if (shiftKey) {
		// 延后一拍执行，避免在核心编辑器自己的 keymap 回调里同步卸载它。
		window.setTimeout(() => {
			void view.beginContinuationOrNew(line);
		}, 0);
		return true;
	}

	// Enter：光标处拆分（语义不变），拆出的兄弟同样落到整块之后
	const selection = cm.state.selection.main;
	const head = Math.min(Math.max(selection.head, 0), text.length);
	const before = text.slice(0, head);
	const after = text.slice(head);

	// 延后一拍执行，避免在核心编辑器自己的 keymap 回调里同步卸载它。
	window.setTimeout(() => {
		void runLineAction(
			view,
			line,
			originalLine,
			(raw) => {
				const first = replaceTaskBody(raw, before);
				const sibling = buildSiblingTaskLine(raw, after);
				if (first === null || sibling === null) {
					return null;
				}
				return [first, sibling];
			},
			nextEditLine,
			{ insertAfterContinuations: true, animateRecentSwap: true },
		);
	}, 0);
	return true;
}

export function onEditorDeleteEmpty(view: IOTOTaskView): boolean {
	const line = view.editingLine;
	if (line === null) {
		return false;
	}
	const originalLine = view.editingOriginalLine;
	window.setTimeout(() => {
		void runLineAction(
			view,
			line,
			originalLine,
			() => '',
			line > 0 ? line - 1 : null,
			{ swallowContinuations: true, animateRecentSwap: true },
		);
	}, 0);
	return true;
}

export function onEditorIndent(view: IOTOTaskView, delta: number): boolean {
	const line = view.editingLine;
	if (line === null) {
		return false;
	}
	const originalLine = view.editingOriginalLine;
	window.setTimeout(() => {
		void runLineAction(
			view,
			line,
			originalLine,
			(raw) => setTaskIndent(raw, delta),
			line,
		);
	}, 0);
	return true;
}

export async function runLineAction(
	view: IOTOTaskView,
	line: number,
	originalLine: string,
	transform: TaskLineTransform,
	nextEditLine: number | null,
	options?: {
		swallowContinuations?: boolean;
		insertAfterContinuations?: boolean;
		/** 单任务新增/删除：开启「只显示最近任务」时补进出场动画（§2.5.1）。 */
		animateRecentSwap?: boolean;
		/** 插入后进入编辑态时的光标偏移（模板 `%%Cursor%%`；相对行 body）。 */
		caretOffset?: number | null;
	},
): Promise<void> {
	const file = view.file;
	if (!file) {
		return;
	}

	// 结构性变更要把编辑面挪到「别的行」（新建 / 拆行 / 删空行）时，先在**重绘之前**
	// 同步退放大：否则 renderNote 的 restoreZoom() 会 fire-and-forget 地 enterZoom(旧行)，
	// 与下面的 beginEdit(nextEditLine) 抢同一份 editingLine/editingHandle → 双编辑器、
	// 旧卡残留 .is-editing、放大按钮图标错位。判据 `nextEditLine !== zoomLine` 天然排除
	// 「放大态内缩进」（nextEditLine === line === zoomLine），保持缩进不退出放大。
	// 见 [[Research-20261008-210807]] 方案 A 落点 1。
	if (view.zoomLine !== null && view.zoomLine !== nextEditLine) {
		view.exitZoom();
	}

	view.destroyActiveEditor();
	view.destroyContinuationEditor();
	const outcome = await commitTaskLineAction(view.app, file, {
		line,
		originalLine,
		transform,
		swallowContinuations: options?.swallowContinuations,
		insertAfterContinuations: options?.insertAfterContinuations,
	});
	view.editingLine = null;
	view.continuationLine = null;
	view.applyOutcome(outcome);
	await view.reloadFromVault();
	view.renderNote(view.data, {
		animateRecentSwap: options?.animateRecentSwap === true,
	});

	if (outcome.status !== 'conflict' && nextEditLine !== null) {
		// beginEdit 内会把 selectedLine 落到新行上
		await view.beginEdit(nextEditLine, options?.caretOffset ?? null);
		return;
	}

	// 没有后继编辑目标（删空首行 / 冲突回滚）：原卡已不存在，清掉选中避免悬空态
	view.selectedLine = null;
	view.refreshDeleteButtonVisibility();
}

/** 写盘 outcome 的统一收口：conflict 弹 Notice；`ok` 同步 `data` / `lastLoadedText`。 */
export function applyOutcome(view: IOTOTaskView, outcome: CommitOutcome): void {
	if (outcome.status === 'conflict') {
		new Notice(t('notice.iotoTaskView.commitConflict'));
	}
	view.syncCommittedContent(outcome);
}

/** 🔴 红线：写盘成功后 `data` 与 `lastLoadedText` 必须一起更新，
 * 否则 `getViewData()` 会返回过期字节、被 TextFileView 写回去。 */
export function syncCommittedContent(
	view: IOTOTaskView,
	outcome: CommitOutcome,
): void {
	if (outcome.status === 'ok') {
		view.data = outcome.content;
		view.lastLoadedText = outcome.content;
	}
}

export async function toggleTask(
	view: IOTOTaskView,
	line: number,
	cardEl: HTMLElement,
): Promise<void> {
	const file = view.file;
	if (!file) {
		return;
	}

	const currentMarker = cardEl.getAttribute('data-task') ?? ' ';
	const nextMarker: ' ' | 'x' =
		currentMarker.toLowerCase() === 'x' ? ' ' : 'x';

	// 乐观更新：先改 DOM，不等 vault.process 返回，保证点击手感。
	cardEl.setAttribute('data-task', nextMarker);
	const checkboxEl = cardEl.querySelector<HTMLElement>(
		'.ioto-task-view__card-checkbox',
	);
	if (checkboxEl) {
		setIcon(
			checkboxEl,
			nextMarker === 'x' ? 'check' : '',
		);
		checkboxEl.setAttribute(
			'aria-pressed',
			nextMarker === 'x' ? 'true' : 'false',
		);
	}

	// 编辑态内勾选：blur 提交若在途，先等它落定再定位，避免两次写盘对同一行
	// 互相错位（[[Report-20261007-092357]] §5.5）。正常操作下恒为 null，无副作用。
	if (view.pendingCommit) {
		await view.pendingCommit;
	}

	const originalLine = lineAt(view, line);
	const outcome = await commitTaskLineAction(view.app, file, {
		line,
		originalLine,
		transform: toggleTaskMarker,
	});

	if (outcome.status === 'ok') {
		view.data = outcome.content;
		view.lastLoadedText = outcome.content;

		// 编辑态内勾选：写盘后同步快照，等价于 autosaveEdit 的收尾，否则随后的
		// blur / autosave 提交会拿旧 originalLine 判 conflict → 整树重建冲掉编辑态
		// （[[Report-20261007-092357]] §2.3-1）。
		if (view.editingLine === line) {
			view.editingOriginalLine = lineAt(view, line);
		}

		// ② 开启时把新完成的任务「就地移除」（不整树重建，避免跳顶）。
		// 编辑态例外：该卡由「编辑中兜底」保持可见，就地移除等于把编辑器连根拔掉；
		// 退出编辑时改走 `doCommitEdit` 末尾的 `renderNote` 收尾（§5.3）。
		if (
			view.filters.onlyPending &&
			nextMarker === 'x' &&
			view.editingLine !== line
		) {
			// ⚠️ 落点必须用 pickAdjacentLine 取**真实**相邻行号：② 只动 DOM、
			// 不动文件行，行号不漂移；`pickLineAfterDelete` 的 −1 假设会让选中
			// 指向一张不存在的卡（[[Plan-20261004-110845]] §5.2）。
			const order = collectCardLines(view.contentEl);
			const next =
				pickAdjacentLine(order, line, 1) ??
				pickAdjacentLine(order, line, -1);

			// 就地移除这一条（不走 renderNote）同样补进出场
			// （[[Plan-20261005-150106]] §2.5.3 / Q2）：被勾掉的卡淡出、
			// 其余卡 FLIP 上移。快照必须在 remove() 之前采集。
			// [[Plan-20261005-152203]] §3.4：改为「同步 prepare + 双 rAF play」——
			// 其余卡不再先跳到新位再退回，被删卡不再有 2 帧空窗。
			view.cancelListTransition();
			const scrollEl =
				cardEl.closest<HTMLElement>(IOTO_TASK_SCROLL_SELECTOR);
			const oldSnapshots =
				scrollEl && !view.prefersReducedMotion()
					? captureCardSnapshots(
							scrollEl,
							IOTO_TASK_CARD_SELECTOR,
						)
					: [];
			cardEl.remove();
			if (scrollEl && oldSnapshots.length > 0) {
				const plan = prepareSwapTransition({
					scrollEl,
					oldSnapshots,
					newSnapshots: captureCardSnapshots(
						scrollEl,
						IOTO_TASK_CARD_SELECTOR,
					),
					reducedMotion: false,
				});
				if (plan) {
					const token = view.listTransitionToken;
					view.listTransitionCleanup = () => plan.cancel();
					view.scheduleListPlay(() => {
						if (
							token !== view.listTransitionToken ||
							!scrollEl.isConnected
						) {
							plan.cancel();
							return;
						}
						plan.play();
					});
				}
			}

			if (next !== null) {
				view.applySelection(next);
			} else {
				view.selectedLine = null;
				view.refreshDeleteButtonVisibility();
			}
		}
	} else if (outcome.status === 'conflict') {
		new Notice(t('notice.iotoTaskView.commitConflict'));
		await view.reloadFromVault();
		view.renderNote(view.data);
	}
}
