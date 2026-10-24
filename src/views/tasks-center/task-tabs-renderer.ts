import { Menu, setIcon } from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { t } from '../../lang/helpter';
import { markActiveMenuItem } from './helpers';

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
		const taskFilterTabs = view.getVisibleTaskFilterTabs();
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
	if (!view.isBatchEditMode) {
		const batchEditButtonEl = settingsContainerEl.createEl('button', {
			cls: 'ioto-tasks-center__tab-batch-edit-button',
		});
		batchEditButtonEl.type = 'button';
		batchEditButtonEl.ariaLabel = t('view.enterBatchEditMode');
		batchEditButtonEl.title = t('view.enterBatchEditMode');
		setIcon(batchEditButtonEl, 'check-square');
		batchEditButtonEl.addEventListener('click', () => {
			view.toggleBatchEditMode();
		});
	}

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
	// 只剩一个可选 tab 时切无可切，整个 switcher 不渲染（右侧 gear 按钮照常）。
	if (view.getVisibleTaskFilterTabs().length <= 1) {
		return;
	}

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
	for (const tab of view.getVisibleTaskFilterTabs()) {
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
				// 默认图标是 .menu-item 的首个子节点（标题左侧）；打标后由 styles.css
				// 用 order 把勾排到「任务名（任务数）」之后。
				markActiveMenuItem(item);
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
