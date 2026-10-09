import { collectCardLines, pickAdjacentLine } from './card-navigation';
import type { TaskViewHost } from './task-view-host';
import { SEARCH_DEBOUNCE_MS } from './task-view-constants';
import { queryCard } from './task-view-helpers';
import type { SearchHost } from './search-scope';

/** Mod+F / 命令入口：显示搜索条并聚焦输入框（Q6 移动端复用它）。 */
export function revealSearch(view: TaskViewHost): void {
	if (!view.searchBarEl?.isConnected) {
		view.buildToolbar();
	}
	view.searchBarEl?.removeClass('is-hidden');
	view.refreshSearchToggleState();
	const input = view.searchInputEl;
	if (!input) {
		return;
	}
	const focus = (): void => {
		input.focus();
		input.select();
	};
	if (typeof window !== 'undefined' && window.requestAnimationFrame) {
		window.requestAnimationFrame(focus);
	} else {
		focus();
	}
}

/** 搜索条是否处于展开态（唯一的真源 = searchbar 的有无 is-hidden）。 */
export function isSearchOpen(view: TaskViewHost): boolean {
	return view.searchBarEl !== null && !view.searchBarEl.hasClass('is-hidden');
}

/**
 * 工具栏「搜索任务」按钮：未展开 → 同命令 revealSearch()；已展开 → 同 ×/Esc closeSearch()。
 * 复用既有开关语义，不新增第三种状态（[[Plan-20261009-064624]] §四）。
 */
export function toggleSearch(view: TaskViewHost): void {
	if (isSearchOpen(view)) {
		view.closeSearch();
	} else {
		view.revealSearch();
	}
}

/** 把搜索条真实显隐回写到按钮按下态（除整栏刷新外的三处显隐变更点调用）。 */
export function refreshSearchToggleState(view: TaskViewHost): void {
	view.searchToggleEl?.setAttribute(
		'aria-pressed',
		isSearchOpen(view) ? 'true' : 'false',
	);
}

export function onSearchInput(view: TaskViewHost): void {
	const value = view.searchInputEl?.value ?? '';
	if (view.searchDebounce !== null) {
		window.clearTimeout(view.searchDebounce);
	}
	view.searchDebounce = window.setTimeout(() => {
		view.searchDebounce = null;
		void applySearchQuery(view, value);
	}, SEARCH_DEBOUNCE_MS);
}

/**
 * 实时生效：改关键词 → 先 commit 正在编辑的卡（照 `toggleFilter` 口径）→ 重绘归顶。
 * 边界：与当前关键词相同则跳过（避免无意义的整树重建）。
 */
export async function applySearchQuery(
	view: TaskViewHost,
	value: string,
): Promise<void> {
	if (value === view.searchQuery) {
		return;
	}
	// 🔴 重绘会销毁编辑器：先让编辑态落盘退出（真正的保护，非 isCardVisible 的兜底）。
	await view.commitEdit();
	await view.commitContinuationEdit();
	view.searchQuery = value;
	view.renderNote(view.data, { resetScroll: true });
}

/** 关闭 + 清空（`关闭` 按钮与 `Esc` 共用）。 */
export function closeSearch(view: TaskViewHost): void {
	if (view.searchDebounce !== null) {
		window.clearTimeout(view.searchDebounce);
		view.searchDebounce = null;
	}
	view.searchBarEl?.addClass('is-hidden');
	view.refreshSearchToggleState();
	if (view.searchQuery !== '' || (view.searchInputEl?.value ?? '') !== '') {
		view.searchQuery = '';
		if (view.searchInputEl) {
			view.searchInputEl.value = '';
		}
		view.renderNote(view.data, { resetScroll: true });
	}
	// 焦点归还：优先选中卡，否则视图容器
	const card =
		view.selectedLine !== null ? queryCard(view, view.selectedLine) : null;
	if (card) {
		card.focus({ preventScroll: true });
	} else {
		view.contentEl.focus?.();
	}
}

/** `上一个`/`下一个`：在**可见卡**（= 命中卡）间定位，环绕，焦点留在搜索框。 */
export function stepMatch(view: TaskViewHost, delta: 1 | -1): void {
	const lines = collectCardLines(view.contentEl);
	if (lines.length === 0) {
		return;
	}
	const current =
		view.selectedLine !== null && lines.includes(view.selectedLine)
			? view.selectedLine
			: null;
	let target: number | null;
	if (current === null) {
		target =
			delta === 1
				? (lines[0] ?? null)
				: (lines[lines.length - 1] ?? null);
	} else {
		target =
			pickAdjacentLine(lines, current, delta) ??
			(delta === 1
				? (lines[0] ?? null)
				: (lines[lines.length - 1] ?? null)); // 环绕
	}
	if (target === null) {
		return;
	}
	highlightMatch(view, target);
}

/**
 * 定位到某张卡：**加选中类 + 滚动入视口，但不抢焦点**（保持搜索框焦点）。
 * 与 `applySelection` 的区别就在这里——后者会 `cardEl.focus()`，会跳出搜索框。
 */
export function highlightMatch(view: TaskViewHost, line: number): void {
	// 方案 A：放大态 = 单卡编辑面，搜索定位不改选中态（避免破坏「放大 ≡ 编辑」）
	if (view.zoomLine !== null) {
		return;
	}
	view.cancelPendingDelete(false);
	const prev = view.selectedLine;
	if (prev !== null && prev !== line) {
		queryCard(view, prev)?.removeClass('is-selected');
	}
	view.selectedLine = line;
	const cardEl = queryCard(view, line);
	if (!cardEl) {
		view.selectedLine = null;
		view.refreshDeleteButtonVisibility();
		return;
	}
	cardEl.addClass('is-selected');
	view.scrollCardIntoView(cardEl);
	view.refreshDeleteButtonVisibility();
	// 🔴 不 cardEl.focus()：Obsidian 查找条语义是焦点留在查找框
}

/** 无命中时禁用两个定位按钮。 */
export function refreshSearchNavState(view: TaskViewHost): void {
	const has = collectCardLines(view.contentEl).length > 0;
	view.searchPrevEl?.toggleAttribute('disabled', !has);
	view.searchNextEl?.toggleAttribute('disabled', !has);
}

/**
 * 释放搜索瞬态：清 debounce 计时器、归零关键词、清输入框、收起搜索条。
 * **不重绘**（调用方按需决定）；用于销毁 / 清空视图（[[Plan-20261006-161121]] §2.3f）。
 */
export function resetSearchState(view: TaskViewHost): void {
	if (view.searchDebounce !== null) {
		window.clearTimeout(view.searchDebounce);
		view.searchDebounce = null;
	}
	view.searchQuery = '';
	if (view.searchInputEl) {
		view.searchInputEl.value = '';
	}
	view.searchBarEl?.addClass('is-hidden');
	view.refreshSearchToggleState();
}

/**
 * 能否由 scope 接管 Mod+F：非编辑态（保留内嵌编辑器的 Cmd+F 查找）。
 * 非 active 视图由 `resolveSearchHost` 先挡掉（返回 `null` → 放行）。
 */
export function canRevealSearchFromScope(view: TaskViewHost): boolean {
	return view.editingLine === null && view.continuationLine === null;
}

/** 暴露给 search scope 的宿主（照 `modEnterHost` 范式）。 */
export function searchHost(view: TaskViewHost): SearchHost {
	return {
		canRevealSearch: () => canRevealSearchFromScope(view),
		revealSearch: () => view.revealSearch(),
	};
}
