import { Menu, setIcon } from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { getTaskFilterTabs } from '../task-filter-tabs';
import { t } from '../../lang/helpter';

export function renderTaskTabs(
	view: IOTOTasksCenterView,
	container: HTMLElement,
): void {
	const tabBarEl = container.createDiv({
		cls: 'ioto-tasks-center__tabs-bar',
	});

	if (view.isCompactLayout) {
		renderCompactTaskFilterSwitcher(view, tabBarEl);
	} else {
		const taskFilterTabs = getTaskFilterTabs();
		const tabListEl = tabBarEl.createDiv({
			cls: 'ioto-tasks-center__tabs ioto-tasks-center__tabs-list',
		});
		const counts = view.getTaskFilterCounts();

		for (const tab of taskFilterTabs) {
			const tabButtonEl = tabListEl.createEl('button', {
				cls: 'ioto-tasks-center__tab',
			});
			tabButtonEl.type = 'button';
			tabButtonEl.dataset.tabKey = tab.key;
			tabButtonEl.createSpan({
				cls: 'ioto-tasks-center__tab-label',
				text: tab.label,
			});
			tabButtonEl.createSpan({
				cls: 'ioto-tasks-center__tab-count',
				text: `${counts[tab.key]}`,
			});

			if (tab.key === view.activeTaskFilterTab) {
				tabButtonEl.addClass('is-active');
			}

			tabButtonEl.addEventListener('click', () => {
				if (tab.key === view.activeTaskFilterTab) {
					return;
				}

				view.activeTaskFilterTab = tab.key;
				view.render();
			});
		}
	}

	const settingsContainerEl = tabBarEl.createDiv({
		cls: 'ioto-tasks-center__tabs-settings',
	});
	const settingsButtonEl = settingsContainerEl.createEl('button', {
		cls: 'ioto-tasks-center__tab-settings-button',
	});
	settingsButtonEl.type = 'button';
	settingsButtonEl.ariaLabel = t('view.taskListSettings');
	settingsButtonEl.title = t('view.taskListSettings');
	setIcon(settingsButtonEl, 'sliders-horizontal');
	settingsButtonEl.addEventListener('click', (event: MouseEvent) => {
		view.showTaskPresentationMenu(event);
	});
}

function renderCompactTaskFilterSwitcher(
	view: IOTOTasksCenterView,
	tabBarEl: HTMLElement,
): void {
	const buttonLabel = view.getTaskFilterSwitcherLabel();
	const switcherEl = tabBarEl.createEl('button', {
		cls: 'ioto-tasks-center__task-filter-switcher',
		text: buttonLabel,
	});
	switcherEl.type = 'button';
	switcherEl.ariaLabel = buttonLabel;
	switcherEl.title = buttonLabel;
	switcherEl.addEventListener('click', (event: MouseEvent) => {
		showTaskFilterSwitcherMenu(view, event);
	});
}

function showTaskFilterSwitcherMenu(
	view: IOTOTasksCenterView,
	event: MouseEvent,
): void {
	const counts = view.getTaskFilterCounts();
	const menu = new Menu();
	for (const tab of getTaskFilterTabs()) {
		const isActive = tab.key === view.activeTaskFilterTab;
		menu.addItem((item) => {
			item.setTitle(
				t('view.taskFilterSwitcher.menuItem', [
					tab.label,
					String(counts[tab.key]),
				]),
			);
			if (isActive) {
				item.setIcon('check');
			}
			item.onClick(() => {
				if (isActive) {
					return;
				}

				view.activeTaskFilterTab = tab.key;
				view.render();
			});
		});
	}

	menu.showAtMouseEvent(event);
}
