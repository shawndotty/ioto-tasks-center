import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	normalizeSectionTitle,
	parseSections,
	replaceSectionHeadingTitle,
} from '../../tasks-center/note-structure';
import { commitTaskLineAction } from './commit-task-line';
import { getSectionStateKey } from './render-note';
import { querySectionEl } from './task-view-helpers';
import type { TaskViewHost } from './task-view-host';

/**
 * Section 标题的**单行就地编辑**（[[Plan-20261019-122509]] §2.3）。
 *
 * 与正文编辑器是两条独立链路：
 * - 正文编辑器（`task-view-section-edit.ts`）= 标题行之下，写回时拼回标题；
 * - 本模块 = 原生 `<input>` 只换标题那一行。
 *
 * 三条落地不变量：
 * 1. **不重绘**（成功 / 失败都不整树重建）：`mousedown` 会先 blur 提交上一次改名，
 *    若提交走 `renderNote`，被双击的第二个标题元素会在两次 click 之间被销毁，
 *    `dblclick` 永远不触发；
 * 2. **标题一律以 `parseSections(view.data)` 的结果回写 DOM**，不用用户输入拼接
 *    （收尾 `#` 等会被 ATX 规则吃掉）；
 * 3. 空标题 = 取消（不写盘；空标题会让整节从解析里消失）。
 */

export interface SectionTitleEditorHandle {
	getValue(): string;
	selectAll(): void;
	focus(): void;
	destroy(): void;
}

const TITLE_SELECTOR = '.ioto-task-view__section-title';
const HEADER_SELECTOR = '.ioto-task-view__section-header';

/** 从当前 `view.data` 解析该行的折叠 key（改名后迁移用）。 */
function sectionKeyAt(view: TaskViewHost, startLine: number): string | null {
	const section = parseSections(view.data).find(
		(s) => s.startLine === startLine && s.level > 0,
	);
	return section ? getSectionStateKey(section) : null;
}

/** 不写盘的统一收尾：拆输入框、撤编辑态类、清会话字段。 */
function finishWithoutWrite(
	view: TaskViewHost,
	handle: SectionTitleEditorHandle,
	sectionEl: HTMLElement | null,
): void {
	view.sectionTitleEditLine = null;
	view.sectionTitleEditOriginalLine = '';
	view.sectionTitleEditHandle = null;
	view.sectionTitleEditSectionEl = null;
	handle.destroy();
	sectionEl?.removeClass('is-title-editing');
}

/** toggle 按钮的无障碍文案跟着标题走。 */
function updateToggleAriaLabel(
	sectionEl: HTMLElement,
	title: string,
): void {
	const toggleEl = sectionEl.querySelector<HTMLElement>(
		'.ioto-task-view__section-toggle',
	);
	toggleEl?.setAttribute(
		'aria-label',
		t('view.iotoTaskView.sectionToggle', [
			title || t('view.iotoTaskView.fallbackTitle'),
		]),
	);
}

export async function beginSectionTitleEdit(
	view: TaskViewHost,
	startLine: number,
): Promise<void> {
	if (!view.supportsInlineEdit() || !view.file) {
		new Notice(t('notice.iotoTaskView.inlineEditUnavailable'));
		return;
	}

	// 同节已在标题编辑：幂等聚焦 + 全选
	if (
		view.sectionTitleEditLine === startLine &&
		view.sectionTitleEditHandle
	) {
		view.sectionTitleEditHandle.focus();
		view.sectionTitleEditHandle.selectAll();
		return;
	}

	// v1：正文整块编辑态不开放改名（CSS 同时隐藏铅笔，双保险）
	if (view.editingKind === 'section') {
		return;
	}

	// 互斥：先提交其余四个编辑器（含另一节的标题编辑）
	await view.commitEdit();
	await view.commitContinuationEdit();
	await view.commitSectionEdit();
	await view.commitSectionTitleEdit();

	const file = view.file;
	if (!file) {
		return;
	}

	// 目标必须是真标题块（level > 0）；折叠态无需展开（折叠只藏 body）
	const section = parseSections(view.data).find(
		(s) => s.startLine === startLine && s.level > 0,
	);
	if (!section) {
		return;
	}

	const sectionEl = querySectionEl(view, startLine);
	const headerEl = sectionEl?.querySelector<HTMLElement>(HEADER_SELECTOR);
	const titleEl = headerEl?.querySelector<HTMLElement>(TITLE_SELECTOR);
	if (!sectionEl || !headerEl || !titleEl) {
		// 「只显示任务」/ 搜索过滤下该节可能没渲染：静默返回
		return;
	}

	sectionEl.addClass('is-title-editing');
	const inputEl = headerEl.createEl('input', {
		cls: 'ioto-task-view__section-title-input',
		attr: {
			type: 'text',
			'aria-label': t('view.iotoTaskView.sectionEditTitle'),
		},
	});
	inputEl.value = section.title;
	// 占 h# 原位（h# 由 CSS 隐藏），不新增包裹
	titleEl.insertAdjacentElement('afterend', inputEl);

	const handle: SectionTitleEditorHandle = {
		getValue: () => inputEl.value,
		selectAll: () => inputEl.select(),
		focus: () => inputEl.focus(),
		destroy: () => inputEl.remove(),
	};

	inputEl.addEventListener('keydown', (event) => {
		if (event.isComposing) {
			return; // IME 组字中：Enter / Esc 都交给输入法
		}
		if (event.key === 'Enter' || event.key === 'Escape') {
			// Esc = 提交并退出（与全插件「退出即保存」同口径）
			event.preventDefault();
			event.stopPropagation();
			void commitSectionTitleEdit(view);
		}
	});
	inputEl.addEventListener('blur', () => {
		void commitSectionTitleEdit(view);
	});
	// 多行粘贴：`<input>` 的 value 净化算法会**直接删掉**换行（不是折空格），
	// 中文标题会被粘成一段。粘贴阶段先折成单行空格再插入。
	inputEl.addEventListener('paste', (event) => {
		const text = event.clipboardData?.getData('text') ?? '';
		if (!/[\r\n]/.test(text)) {
			return;
		}
		event.preventDefault();
		const start = inputEl.selectionStart ?? inputEl.value.length;
		const end = inputEl.selectionEnd ?? start;
		const folded = normalizeSectionTitle(text);
		inputEl.value =
			inputEl.value.slice(0, start) + folded + inputEl.value.slice(end);
		const caret = start + folded.length;
		inputEl.setSelectionRange(caret, caret);
	});

	view.sectionTitleEditLine = startLine;
	view.sectionTitleEditOriginalLine =
		view.data.split('\n')[startLine] ?? '';
	view.sectionTitleEditHandle = handle;
	view.sectionTitleEditSectionEl = sectionEl;
	// 标题编辑非卡片选中语义：清掉卡片选中类（同 beginSectionEdit；不能依赖
	// `syncSelectionClass`——它对 `null` 直接早退，不会摘旧类）
	const prevSelected = view.selectedLine;
	view.selectedLine = null;
	if (prevSelected !== null) {
		view.queryCard(prevSelected)?.removeClass('is-selected');
	}

	inputEl.focus();
	inputEl.select();
}

export async function commitSectionTitleEdit(
	view: TaskViewHost,
): Promise<void> {
	const handle = view.sectionTitleEditHandle;
	const line = view.sectionTitleEditLine;
	const file = view.file;
	if (!handle || line === null || !file) {
		return;
	}

	const rawValue = handle.getValue();
	const originalLine = view.sectionTitleEditOriginalLine;
	const sectionEl = view.sectionTitleEditSectionEl;
	// 逻辑退出立刻生效：切断 blur / 二次 Enter 的重入。
	// `sectionTitleEditLine` 暂时保留 → 写盘 await 期间仍算「有编辑器」，
	// 外部 vault 重读不会把本次提交冲掉。
	view.sectionTitleEditHandle = null;

	const nextTitle = normalizeSectionTitle(rawValue);
	if (nextTitle.length === 0) {
		finishWithoutWrite(view, handle, sectionEl);
		return;
	}

	const oldKey = sectionKeyAt(view, line);
	const outcome = await commitTaskLineAction(view.app, file, {
		line,
		originalLine,
		transform: (current) => replaceSectionHeadingTitle(current, nextTitle),
	});

	view.sectionTitleEditLine = null;
	view.sectionTitleEditOriginalLine = '';
	view.sectionTitleEditSectionEl = null;
	view.applyOutcome(outcome);
	handle.destroy();
	sectionEl?.removeClass('is-title-editing');

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}

	// 标题以解析结果为准（例如输入 `foo #` 会被 ATX 收尾规则吃掉 `#`）
	const nextSection = parseSections(view.data).find(
		(s) => s.startLine === line,
	);
	// 🔴 重新查 DOM：不复用可能已被重绘的旧引用
	const targetEl = querySectionEl(view, line);
	if (!nextSection || !targetEl) {
		view.renderNote(view.data);
		return;
	}

	const titleEl = targetEl.querySelector<HTMLElement>(TITLE_SELECTOR);
	if (titleEl) {
		titleEl.textContent = nextSection.title;
	}
	updateToggleAriaLabel(targetEl, nextSection.title);

	if (outcome.status === 'ok' && oldKey) {
		const newKey = getSectionStateKey(nextSection);
		if (newKey !== oldKey && view.collapsedSections.delete(oldKey)) {
			// 折叠态迁移：改名的节不该自己展开
			view.collapsedSections.add(newKey);
		}
	}
}

/** 销毁标题编辑器：撤输入框 + 编辑态类 + 会话字段（幂等）。 */
export function destroySectionTitleEditor(view: TaskViewHost): void {
	const handle = view.sectionTitleEditHandle;
	const sectionEl = view.sectionTitleEditSectionEl;
	view.sectionTitleEditHandle = null;
	view.sectionTitleEditLine = null;
	view.sectionTitleEditOriginalLine = '';
	view.sectionTitleEditSectionEl = null;
	handle?.destroy();
	sectionEl?.removeClass('is-title-editing');
}
