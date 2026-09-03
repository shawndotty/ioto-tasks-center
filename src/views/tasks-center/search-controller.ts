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

export function toggleTaskSearchModal(view: IOTOTasksCenterView): void {
	if (view.isTaskSearchModalOpen) {
		closeTaskSearchModal(view);
		return;
	}

	openTaskSearchModal(view);
}

export function openTaskSearchModal(view: IOTOTasksCenterView): void {
	const modal = view.taskSearchModal;
	if (!modal || !shouldShowTaskSearchIcon(view)) {
		return;
	}

	view.isTaskSearchModalOpen = true;
	view.contentEl
		.querySelector('.ioto-tasks-center__task-search-hint')
		?.remove();
	modal.openSearch({
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
		onClosed: () => {
			handleTaskSearchModalClosed(view);
		},
	});
}

export function closeTaskSearchModal(view: IOTOTasksCenterView): void {
	view.taskSearchModal?.close();
	view.isTaskSearchModalOpen = false;
}

function handleTaskSearchModalClosed(view: IOTOTasksCenterView): void {
	if (!view.isTaskSearchModalOpen) {
		return;
	}

	view.isTaskSearchModalOpen = false;
	view.render();
}

export function applyTaskSearchQuery(view: IOTOTasksCenterView): void {
	view.taskSearchQuery = view.taskSearchInputValue;
	closeTaskSearchModal(view);
}

export function clearTaskSearch(view: IOTOTasksCenterView): void {
	if (!view.taskSearchInputValue && !view.taskSearchQuery) {
		return;
	}

	view.taskSearchInputValue = '';
	view.taskSearchQuery = '';
	view.render();
}
