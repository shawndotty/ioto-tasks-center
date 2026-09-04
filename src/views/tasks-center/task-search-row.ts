import { SearchComponent } from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { t } from '../../lang/helpter';
import { canSearchTasks } from './search-controller';

const TASK_SEARCH_FILTER_DELAY_MS = 80;

export function renderTaskSearchRow(
	view: IOTOTasksCenterView,
	container: HTMLElement,
): void {
	const rowEl = container.createDiv({
		cls: 'ioto-tasks-center__task-search-row',
	});
	const fieldEl = rowEl.createDiv({
		cls: 'ioto-tasks-center__task-search-field',
	});

	const search = new SearchComponent(fieldEl);
	const inputEl = search.inputEl;
	inputEl.addClass('ioto-tasks-center__task-search-input');
	inputEl.setAttr('enterkeyhint', 'search');
	inputEl.setAttr('autocapitalize', 'off');
	inputEl.setAttr('autocomplete', 'off');
	inputEl.setAttr('spellcheck', 'false');
	inputEl.disabled = !canSearchTasks(view);
	search.setPlaceholder(t('view.search.placeholder'));
	search.setValue(view.taskSearchInputValue);
	view.taskSearchInputEl = inputEl;

	const countEl = rowEl.createDiv({
		cls: 'ioto-tasks-center__task-search-count',
	});
	countEl.setAttribute('aria-live', 'polite');
	view.taskSearchCountEl = countEl;

	let filterTimer: number | null = null;
	let composing = false;

	const cancelPendingFilter = (): void => {
		if (filterTimer === null) {
			return;
		}

		window.clearTimeout(filterTimer);
		filterTimer = null;
	};

	const applyFilter = (): void => {
		cancelPendingFilter();
		view.setTaskSearchQuery(inputEl.value);
	};

	const scheduleFilter = (): void => {
		cancelPendingFilter();
		filterTimer = window.setTimeout(
			applyFilter,
			TASK_SEARCH_FILTER_DELAY_MS,
		);
	};

	search.onChange((value) => {
		view.taskSearchInputValue = value;
		if (composing) {
			return;
		}

		scheduleFilter();
	});

	inputEl.addEventListener('compositionstart', () => {
		composing = true;
		cancelPendingFilter();
	});

	inputEl.addEventListener('compositionend', () => {
		composing = false;
		applyFilter();
	});

	search.clearButtonEl.addEventListener('click', () => {
		cancelPendingFilter();
		inputEl.focus();
		view.setTaskSearchQuery('');
	});

	inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
		if (composing) {
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			inputEl.value = '';
			view.taskSearchInputValue = '';
			applyFilter();
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			event.stopPropagation();
			if (filterTimer !== null) {
				applyFilter();
			}

			const [firstTask] = view.getVisibleTasks();
			if (firstTask) {
				void view.openTaskFile(firstTask);
			}

			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			if (filterTimer !== null) {
				applyFilter();
			}

			view.focusFirstTaskRow();
		}
	});

	view.syncTaskSearchCount();
}

export function updateTaskSearchCountText(
	view: IOTOTasksCenterView,
	countEl: HTMLElement | null,
): void {
	if (!countEl) {
		return;
	}

	const summary = view.getTaskSearchSummary();
	countEl.setText(
		summary ? t('view.search.resultCount', [String(summary.matched), String(summary.total)]) : '',
	);
	countEl.toggleClass('is-hidden', !summary);
}
