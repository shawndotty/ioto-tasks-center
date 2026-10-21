import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { t } from '../../lang/helpter';

export function renderTaskFilterEmptyState(
	view: IOTOTasksCenterView,
	container: HTMLElement,
): void {
	const tabLabel =
		view
			.getVisibleTaskFilterTabs()
			.find((tab) => tab.key === view.activeTaskFilterTab)?.label ??
		t('view.label.currentFilter');
	view.renderState(
		container,
		t('view.filter.emptyTitle'),
		t('view.filter.emptyDesc', [tabLabel]),
		'is-empty',
	);
}

export function renderTaskSearchEmptyState(
	view: IOTOTasksCenterView,
	container: HTMLElement,
): void {
	const keyword = view.taskSearchQuery.trim();
	view.renderState(
		container,
		t('view.search.emptyTitle'),
		t('view.search.emptyDesc', [keyword]),
		'is-empty',
	);
}

export function renderState(
	view: IOTOTasksCenterView,
	container: HTMLElement,
	title: string,
	description: string,
	stateClass: 'is-empty' | 'is-loading',
): void {
	const stateEl = container.createDiv({
		cls: `ioto-tasks-center__state ${stateClass}`,
	});
	stateEl.createDiv({
		cls: 'ioto-tasks-center__state-title',
		text: title,
	});
	stateEl.createDiv({
		cls: 'ioto-tasks-center__state-desc',
		text: description,
	});
}
