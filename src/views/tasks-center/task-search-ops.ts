import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type { TaskFileEntry } from '../../tasks-center/types';
import {
	getTaskFilterCounts as getTaskFilterCountsFn,
	getTaskFilterTabs,
	isTaskFilterTab,
	type TaskFilterTab,
} from '../task-filter-tabs';
import {
	buildTaskSearchStamp,
	orderTasksBySearchHits,
	type TaskSearchHit,
} from './task-search-index';
import { filterTasksByTime } from './task-time-filter';
import { t } from '../../lang/helpter';
import { renderTaskListBody as renderTaskListBodyFn } from './tasks-pane-renderer';
import { updateTaskSearchCountText } from './task-search-row';
import {
	TAB_BUTTON_SELECTOR,
	TAB_COUNT_SELECTOR,
	TASK_FILTER_SWITCHER_SELECTOR,
	TASK_LIST_CLASS,
	TASK_LIST_DESC_SELECTOR,
	TASK_ROW_CLASS,
} from './constants';

/**
 * 只重绘任务列表，不触碰搜索行与 header —— 保证输入过程中焦点与输入法 composition 不中断。
 */
export function renderTaskListIncremental(view: IOTOTasksCenterView): void {
	const listEl = view.contentEl.querySelector<HTMLElement>(
		`.${TASK_LIST_CLASS}`,
	);
	if (!listEl) {
		view.render();
		return;
	}

	view.outlinkPopover?.close();
	view.taskStatusChecklistPopover?.close();
	renderTaskListBodyFn(view, listEl);
	updateTaskTabCounts(view);
	updateTaskListDescriptionText(view);
	syncTaskSearchCount(view);
}

export function setTaskSearchQuery(view: IOTOTasksCenterView, value: string): void {
	const query = value.trim();
	if (
		view.taskSearchQuery === query &&
		view.taskSearchInputValue === value
	) {
		return;
	}

	view.taskSearchInputValue = value;
	view.taskSearchQuery = query;
	view.taskListScrollTop = 0;
	view.renderTaskListIncremental();
}

export function syncTaskSearchCount(view: IOTOTasksCenterView): void {
	updateTaskSearchCountText(view, view.taskSearchCountEl);
}

export function focusTaskSearch(view: IOTOTasksCenterView): void {
	const inputEl = view.taskSearchInputEl;
	if (!inputEl?.isConnected) {
		view.openTaskSearchModal();
		return;
	}

	inputEl.focus();
	inputEl.select();
}

export function focusFirstTaskRow(view: IOTOTasksCenterView): void {
	const rowEl = view.contentEl.querySelector<HTMLElement>(
		`.${TASK_ROW_CLASS}`,
	);
	rowEl?.focus();
}

export function getTaskSearchSummary(
	view: IOTOTasksCenterView,
): { matched: number; total: number } | null {
	if (!view.taskSearchQuery.trim()) {
		return null;
	}

	const timeFilter = view.getTaskListTimeFilter();
	const total = filterTasksByTime(
		view.getTasksForActiveTab(),
		timeFilter,
	).length;
	return {
		matched: view.getVisibleTasks().length,
		total,
	};
}

export function getTaskSearchHit(
	view: IOTOTasksCenterView,
	taskPath: string,
): TaskSearchHit | null {
	return (
		view.taskSearchSession.resolve(view.tasks, view.taskSearchQuery)?.get(
			taskPath,
		) ?? null
	);
}

export function applyTaskSearch(
	view: IOTOTasksCenterView,
	tasks: TaskFileEntry[],
): TaskFileEntry[] {
	return orderTasksBySearchHits(
		tasks,
		view.taskSearchSession.resolve(view.tasks, view.taskSearchQuery),
	);
}

export function getTaskFilterCounts(
	view: IOTOTasksCenterView,
): Record<TaskFilterTab, number> {
	const timeFilter = view.getTaskListTimeFilter();
	const key = [
		buildTaskSearchStamp(view.tasks),
		view.taskSearchQuery,
		timeFilter,
	].join('|');
	if (view.taskFilterCountsCache?.key === key) {
		return view.taskFilterCountsCache.counts;
	}

	const counts = getTaskFilterCountsFn(
		filterTasksByTime(view.applyTaskSearch(view.tasks), timeFilter),
	);
	view.taskFilterCountsCache = { key, counts };
	return counts;
}

export function getTaskFilterSwitcherLabel(view: IOTOTasksCenterView): string {
	const counts = view.getTaskFilterCounts();
	const activeTab = getTaskFilterTabs().find(
		(tab) => tab.key === view.activeTaskFilterTab,
	);
	return t('view.taskFilterSwitcher.current', [
		activeTab?.label ?? t('view.filter.current'),
		String(activeTab ? counts[activeTab.key] : 0),
	]);
}

function updateTaskTabCounts(view: IOTOTasksCenterView): void {
	const counts = view.getTaskFilterCounts();
	const tabButtonEls =
		view.contentEl.querySelectorAll<HTMLElement>(TAB_BUTTON_SELECTOR);
	for (const tabButtonEl of Array.from(tabButtonEls)) {
		const tabKey = tabButtonEl.dataset.tabKey;
		if (!isTaskFilterTab(tabKey)) {
			continue;
		}

		const countEl = tabButtonEl.querySelector<HTMLElement>(
			TAB_COUNT_SELECTOR,
		);
		countEl?.setText(`${counts[tabKey]}`);
	}

	const switcherEl = view.contentEl.querySelector<HTMLElement>(
		TASK_FILTER_SWITCHER_SELECTOR,
	);
	if (switcherEl) {
		const label = view.getTaskFilterSwitcherLabel();
		switcherEl.setText(label);
		switcherEl.ariaLabel = label;
		switcherEl.title = label;
	}
}

function updateTaskListDescriptionText(view: IOTOTasksCenterView): void {
	const descEl = view.contentEl.querySelector<HTMLElement>(
		TASK_LIST_DESC_SELECTOR,
	);
	descEl?.setText(view.getTaskListDescription());
}
