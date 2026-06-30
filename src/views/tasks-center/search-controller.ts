import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { t } from '../../lang/helpter';

export function canSearchTasks(view: IOTOTasksCenterView): boolean {
	return Boolean(
		view.selectedProject &&
		!view.isTasksLoading &&
		view.taskResult &&
		view.taskResult.status === 'success',
	);
}

export function shouldShowTaskSearchIcon(view: IOTOTasksCenterView): boolean {
	return Boolean(
		view.selectedProject &&
		view.taskResult &&
		view.taskResult.status === 'success' &&
		view.tasks.length > 0,
	);
}

export function toggleTaskSearchPopover(
	view: IOTOTasksCenterView,
	anchorEl: HTMLElement,
): void {
	if (view.isTaskSearchPopoverOpen) {
		closeTaskSearchPopover(view);
		view.render();
		return;
	}

	view.isTaskSearchPopoverOpen = true;
	view.shouldFocusTaskSearchPopover = true;
	view.contentEl
		.querySelector('.ioto-tasks-center__task-search-hint')
		?.remove();
	openTaskSearchPopover(view, anchorEl, true);
}

export function openTaskSearchPopover(
	view: IOTOTasksCenterView,
	anchorEl: HTMLElement,
	forceFocus: boolean,
): void {
	const popover = view.taskSearchPopover;
	if (!popover) {
		return;
	}

	if (!shouldShowTaskSearchIcon(view)) {
		closeTaskSearchPopover(view);
		return;
	}

	const shouldFocus = forceFocus || view.shouldFocusTaskSearchPopover;
	view.shouldFocusTaskSearchPopover = false;

	popover.open({
		anchorEl,
		placeholder: t('view.search.placeholder'),
		value: view.taskSearchInputValue,
		canSearch: canSearchTasks(view),
		showClear: Boolean(
			view.taskSearchInputValue || view.taskSearchQuery,
		),
		searchButtonText: t('view.search.button'),
		searchButtonAriaLabel: t('view.search.run'),
		clearButtonAriaLabel: t('view.search.clear'),
		clearButtonTitle: t('view.search.clearShort'),
		onChange: (value) => {
			view.taskSearchInputValue = value;
		},
		onApply: () => {
			applyTaskSearchQuery(view);
		},
		onClear: () => {
			clearTaskSearch(view);
		},
		onClose: () => {
			view.isTaskSearchPopoverOpen = false;
			view.shouldFocusTaskSearchPopover = false;
			view.render();
		},
		shouldFocus,
	});
}

export function closeTaskSearchPopover(view: IOTOTasksCenterView): void {
	view.taskSearchPopover?.close();
	view.isTaskSearchPopoverOpen = false;
	view.shouldFocusTaskSearchPopover = false;
}

export function applyTaskSearchQuery(view: IOTOTasksCenterView): void {
	const nextQuery = view.taskSearchInputValue;
	if (nextQuery === view.taskSearchQuery) {
		return;
	}

	view.taskSearchQuery = nextQuery;
	if (view.isTaskSearchPopoverOpen) {
		view.shouldFocusTaskSearchPopover = true;
	}
	view.render();
}

export function clearTaskSearch(view: IOTOTasksCenterView): void {
	if (!view.taskSearchInputValue && !view.taskSearchQuery) {
		return;
	}

	view.taskSearchInputValue = '';
	view.taskSearchQuery = '';
	if (view.isTaskSearchPopoverOpen) {
		view.shouldFocusTaskSearchPopover = true;
	}
	view.render();
}
