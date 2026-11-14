/**
 * 子任务层级折叠控制器（[[Plan-20261114-203739]] S3）。
 *
 * 状态真源是 `TaskViewHost.subtasksCollapsed`（`Set<string>`，键见
 * `task-hierarchy-fold.ts`），**内存真源**；跨会话镜像落在 localStorage，存取收口在
 * `task-view-fold-store.ts` 的 `tasks` 字段。
 *
 * 与续写区折叠同口径：单卡切换**不重绘**，只改集合 + DOM 类；批量切换同样不重绘。
 * 唯一例外：折叠会遮住正在编辑的子孙时，先 `flushInlineEdits()` 提交（整树重建），
 * 再按 `data-fold-key` 重查活节点应用，不碰已脱落的闭包节点。
 */

import { collectCardLines } from './card-navigation';
import {
	applySubtaskFoldState,
	collectSubtaskFoldKeys,
	readSubtaskLines,
	SUBTASK_HIDDEN_CLASS,
	syncSubtaskVisibility,
} from './task-hierarchy-fold';
import { keepVisibleCardLine } from './task-view-editing-state';
import {
	createFoldStorage,
	resolveSubtaskFolds,
	saveSubtaskFolds,
} from './task-view-fold-store';
import type { TaskHierarchyFold } from './render-note-types';
import type { TaskViewHost } from './task-view-host';

export function buildSubtaskFoldController(
	view: TaskViewHost,
): TaskHierarchyFold {
	return {
		isCollapsed: (key) => view.subtasksCollapsed.has(key),
		toggle: (key, cardEl) => {
			void toggleSubtaskFold(view, key, cardEl);
		},
	};
}

/** 当前文件是否有「有子孙」的父任务（命令门禁用；只读 `view.data`，不扫 DOM）。 */
export function hasSubtaskFolds(view: TaskViewHost): boolean {
	return collectSubtaskFoldKeys(view.data ?? '').length > 0;
}

/**
 * 单卡切换。`data-sub-force="1"`（搜索 / 编辑中强制展开）的箭头是惰性的：
 * 不折叠、不改集合，否则会破坏「搜索 / 编辑时不藏卡」的既有契约。
 */
async function toggleSubtaskFold(
	view: TaskViewHost,
	key: string,
	cardEl: HTMLElement,
): Promise<void> {
	if (cardEl.dataset.subForce === '1') {
		return;
	}
	const collapse = !view.subtasksCollapsed.has(key);
	const editingLine = keepVisibleCardLine(view);
	const subLines = readSubtaskLines(cardEl.dataset);

	if (collapse && editingLine !== null && subLines.includes(editingLine)) {
		// 编辑器正落在将被隐藏的子孙里：先提交（会整树重建），节点全部换新。
		view.subtasksCollapsed.add(key);
		await view.flushInlineEdits();
		applySubtaskFold(view, key, cardEl, true);
		return;
	}

	applySubtaskFold(view, key, cardEl, collapse);
}

function applySubtaskFold(
	view: TaskViewHost,
	key: string,
	cardEl: HTMLElement,
	collapse: boolean,
): void {
	const liveCard = querySubtaskCard(view, key) ?? cardEl;

	if (collapse) {
		view.subtasksCollapsed.add(key);
		const selectedLine = view.selectedLine;
		if (
			selectedLine !== null &&
			readSubtaskLines(liveCard.dataset).includes(selectedLine)
		) {
			// 选中态不能悬空在即将隐藏的卡上：先落到父卡（`select` 自带清多选）。
			const parentLine = Number(liveCard.dataset.line);
			if (Number.isFinite(parentLine)) {
				view.select(parentLine);
			}
		}
	} else {
		view.subtasksCollapsed.delete(key);
	}

	applySubtaskFoldState(liveCard, collapse);
	syncSubtaskVisibility(view.contentEl);
	persistSubtaskFolds(view);
}

/**
 * 二态切换**全文件**的全部子任务父卡。
 *
 * - 作用域取 `view.data` 而非 DOM：被过滤的父卡也要进集合，否则关掉过滤后仍是旧态；
 * - 强制展开的父卡（`data-sub-force="1"`、编辑行落在其子孙内）折叠时连键都不 add，
 *   否则搜索结束 / 提交后的整树重建会把它们折上；
 * - 逐键 add / delete，**不** `clear()` 重写；落盘在循环外只调一次；不重绘。
 *
 * @returns 是否真的改了（`false` = 该笔记没有任何父任务）
 */
export function toggleAllSubtaskFolds(view: TaskViewHost): boolean {
	const keys = collectSubtaskFoldKeys(view.data ?? '');
	if (keys.length === 0) {
		return false;
	}
	const collapse = !keys.every((key) => view.subtasksCollapsed.has(key));
	const editingLine = keepVisibleCardLine(view);
	const cards = Array.from(
		view.contentEl.querySelectorAll<HTMLElement>(
			'.ioto-task-view__card[data-fold-key]',
		),
	);

	// 渲染期已标强制 + 渲染后才开始的编辑（data-sub-force 尚未更新）都算强制。
	const forcedKeys = new Set<string>();
	for (const el of cards) {
		const key = el.dataset.foldKey;
		if (!key) {
			continue;
		}
		if (
			el.dataset.subForce === '1' ||
			(editingLine !== null &&
				readSubtaskLines(el.dataset).includes(editingLine))
		) {
			forcedKeys.add(key);
		}
	}

	for (const key of keys) {
		if (!collapse) {
			view.subtasksCollapsed.delete(key);
			continue;
		}
		if (!forcedKeys.has(key)) {
			view.subtasksCollapsed.add(key);
		}
	}

	for (const el of cards) {
		const key = el.dataset.foldKey;
		if (!key || forcedKeys.has(key)) {
			continue;
		}
		applySubtaskFoldState(el, collapse);
	}

	syncSubtaskVisibility(view.contentEl);
	persistSubtaskFolds(view);

	const selectedLine = view.selectedLine;
	if (selectedLine !== null && isCardHidden(view, selectedLine)) {
		const fallback = collectCardLines(view.contentEl)[0];
		if (fallback !== undefined) {
			view.select(fallback);
		}
	}
	return true;
}

function querySubtaskCard(
	view: TaskViewHost,
	key: string,
): HTMLElement | null {
	// 键只含 `[a-z0-9:]`，无需转义。
	return view.contentEl.querySelector<HTMLElement>(
		`.ioto-task-view__card[data-fold-key="${key}"]`,
	);
}

function isCardHidden(view: TaskViewHost, line: number): boolean {
	return (
		view.contentEl
			.querySelector<HTMLElement>(
				`.ioto-task-view__card[data-line="${line}"]`,
			)
			?.classList.contains(SUBTASK_HIDDEN_CLASS) === true
	);
}

/**
 * 装载时调用（`setViewData` 的 `clear === true` 分支、`renderNote` 之前）。
 * 无 localStorage API / 尚未绑定文件 → 空集（退化为「全展开」）。
 */
export function hydrateSubtaskFolds(view: TaskViewHost): void {
	view.subtasksCollapsed.clear();
	const storage = createFoldStorage(view.app);
	const path = view.file?.path ?? '';
	if (!storage || !path) {
		return;
	}
	for (const key of resolveSubtaskFolds(storage, path)) {
		view.subtasksCollapsed.add(key);
	}
}

/** 显式折叠 / 展开 / 批量之后调用：整份镜像落盘（空集也写 `[]`，与续写区同口径）。 */
export function persistSubtaskFolds(view: TaskViewHost): void {
	const storage = createFoldStorage(view.app);
	const path = view.file?.path;
	if (!storage || !path) {
		return;
	}
	saveSubtaskFolds(storage, path, [...view.subtasksCollapsed]);
}
