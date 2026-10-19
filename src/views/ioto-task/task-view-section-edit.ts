import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	composeSectionBlockLines,
	parseSections,
} from '../../tasks-center/note-structure';
import { getSectionStateKey } from './render-note';
import {
	commitBlockRange,
	type CommitOutcome,
} from './commit-task-line';
import { mountEmbeddedEditor } from './embedded-editor';
import type { EmbeddedEditorHandle } from './embedded-editor';
import { queryScrollEl, querySectionEl } from './task-view-helpers';
import type { TaskViewHost } from './task-view-host';

/**
 * 点 Section 头部「编辑本节内容」→ 该节**正文源码**（标题行之下）换成内嵌核心
 * 编辑器（[[Plan-20261019-122509]] §2.1，标题编辑拆到
 * `task-view-section-title-edit.ts`）。
 *
 * - 编辑器只呈现正文：`initialValue = originalLines.slice(1).join('\n')`；
 * - 写回区间仍然覆盖整块（含标题行）：行漂移复核用「标题行 + 原块序列」，
 *   写回时把标题行拼回去（`composeSectionBlockLines`）；
 * - 清空正文只留标题，**不再等于删整节**（删整节只走垃圾桶按钮）；
 * - 与卡片 / 续行 / 标题编辑器互斥：进入前先提交另外三条链；
 * - 只在退出（Esc / 失焦 / 切换）时提交（Q5：不排 autosave）。
 */

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

	// 切换：先提交另一个编辑器（标题 / 续行 / 另一节 / 节标题），互斥
	await view.commitEdit();
	await view.commitContinuationEdit();
	await view.commitSectionEdit();
	await view.commitSectionTitleEdit();

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

	// 防御：在「另一节」聚焦时进入本节编辑，两套隔离叠加会出现「两节都隐藏」的
	// 空白页 → 先退出聚焦（编辑目标节则保持，两套隔离幂等）。
	if (
		view.sectionZoomLine !== null &&
		view.sectionZoomLine !== startLine
	) {
		view.exitSectionZoom();
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
	// 编辑器只吃正文：写回区间仍含标题行（见文件头注释）
	const initialValue = originalLines.slice(1).join('\n');

	const handle = await mountEmbeddedEditor({
		app: view.app,
		hostEl,
		component: view,
		file,
		initialValue,
		handlers: {
			// 多行源码编辑：Enter 放行给核心真换行（不是新建同级任务）
			onEnter: () => false,
			// 清空正文只清正文（标题行由提交时拼回），删整节走垃圾桶按钮
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
			// 编辑器内点链接带走的焦点（换叶 / 交系统打开）：只落盘、保持编辑态，
			// 与只读态卡片链接、普通笔记「编辑态不因点链接退出」对齐
			// （[[Research-20261012-152546]] §四；口径同 endExternalEditorWriteback）。
			onLinkNavigationBlur: () => {
				void view.autosaveSection();
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
	// 隔离（styles.css 的 :has 规则）生效后本节是唯一可见内容；隐藏上方内容不会改变
	// scrollTop 数值，需显式归零，否则编辑节头部（含「关闭」按钮）会被顶出视口。
	// focus 可能驱动滚动，故置于 focus 之后取最终态。[[Discuss-20261010-133548]] §2.2
	const scrollEl = queryScrollEl(view);
	if (scrollEl) {
		scrollEl.scrollTop = 0;
	}
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
 * 提交：读编辑器正文（**不 trim 尾随换行** —— 块边界即 section 边界）→ 标题行 +
 * 正文拼成 `nextLines` 整块写回。
 *
 * - 空正文 → 只保留标题行（Section 不会消失，删整节只走垃圾桶）；
 * - `conflict` 拉权威内容重绘；其余一律整树重建（含 `unchanged`）——
 *   `unchanged` 只说明磁盘无需再写，`onLinkNavigationBlur → autosaveSection`
 *   可能已在编辑中写盘并同步 `view.data`（不重绘），DOM 会停在写盘前；
 * - 重建后把当前节滚回视口顶部（补偿 `beginSectionEdit` 的滚动归零）。
 *   [[Research-20261019-113227]] §五.1
 * - **编辑器 DOM 留到写盘 await 之后**再拆：`.is-editing` 一撤，正文区与其他
 *   Section（隔离态的 `display:none`）会立刻恢复成**编辑前**的样子；若这发生在
 *   await 之前，会先画一帧「旧高度 / 其他节闪现」，写完后重建再收起
 *   （[[Report-20261019-115725]] §3）。
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
	const editLine = view.sectionEditLine;
	// 逻辑退出立刻生效（切断重入），DOM 拆除延后到重绘前。
	view.autosave.cancel();
	view.sectionEditHandle = null;
	const releaseDom = (): void => {
		teardownSectionEditorDom(view, handle, editLine);
	};

	const outcome: CommitOutcome = await commitBlockRange(view.app, file, {
		startLine,
		endLine,
		originalLines,
		nextText: rawText,
		nextLines: composeSectionBlockLines(
			originalLines[0] ?? '',
			rawText,
			originalLines.slice(1),
		),
	});
	view.sectionEditLine = null;
	view.sectionEditOriginalLines = [];
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		releaseDom();
		view.renderNote(view.data);
		return;
	}
	// 与续行同一条不变量：退出编辑一律按最新 data 重建。
	// Section 常规路径不排 autosave，但 onLinkNavigationBlur → autosaveSection
	// 会在编辑中写盘并同步 view.data（不重绘）；此后 Esc 提交就是 unchanged，
	// 若仍按旧约定不重建，DOM 会停在写盘前。[[Research-20261019-113227]] §五.1
	// 隔离态下 renderNote 采到的滚动快照无意义（此刻只有本节、scrollTop≈0、锚点
	// data-line 已漂）→ resetScroll 跳过快照，重建后由下方统一滚回本节顶部
	//（本节 startLine 稳定：编辑约束在块内，上方行数不变，标题改名也不影响 startLine）。
	// [[Discuss-20261010-133548]] §2.3(a)
	// releaseDom 与 renderNote 必须同在一个同步任务里（否则会先画一帧编辑前的旧高度 /
	// 其他 Section 复现的中间态）。
	releaseDom();
	view.renderNote(view.data, { resetScroll: true });
	querySectionEl(view, startLine)?.scrollIntoView({ block: 'start' });
}

/** Section 编辑器 DOM 拆除（`destroySectionEditor` 与提交收尾共用）。 */
function teardownSectionEditorDom(
	view: TaskViewHost,
	handle: EmbeddedEditorHandle | null,
	startLine: number | null,
): void {
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
	if (startLine !== null) {
		querySectionEl(view, startLine)?.removeClass('is-editing');
	}
}

/** 销毁 Section 编辑器：去 DOM 编辑态 + 卸载 handle + 置空（比对 destroyContinuationEditor）。 */
export function destroySectionEditor(view: TaskViewHost): void {
	view.autosave.cancel();
	// 先置空，保证随后触发的 blur 走到 commitSectionEdit 时直接短路。
	const handle = view.sectionEditHandle;
	view.sectionEditHandle = null;
	teardownSectionEditorDom(view, handle, view.sectionEditLine);
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
			// 行漂移 / 编辑中点链接的自动落盘同样要把标题行拼回，否则标题会被吞掉
			nextLines: composeSectionBlockLines(
				view.sectionEditOriginalLines[0] ?? '',
				nextText,
				view.sectionEditOriginalLines.slice(1),
			),
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
