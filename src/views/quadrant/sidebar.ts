/**
 * 未标注优先级侧栏（[[Plan-20261115-201917]] §3.5）。
 *
 * 侧栏卡片与象限卡片同一构造器，但隐藏优先级徽标、追加 `is-unlabeled`，
 * 用虚线边框与象限卡片区分。
 */

import { t } from '../../lang/helpter';
import type { QuadrantViewContext } from './context';
import { renderQuadrantTaskCard } from './task-card';

export function renderQuadrantSidebar(
	sidebarEl: HTMLElement,
	ctx: QuadrantViewContext,
	scrollPositions: ReadonlyMap<string, number>,
): void {
	sidebarEl.empty();
	const model = ctx.getModel();

	const headerEl = sidebarEl.createDiv({
		cls: 'ioto-pq-sidebar__header',
	});
	headerEl.createEl('h3', {
		cls: 'ioto-pq-sidebar__title',
		text: t('priorityQuadrant.sidebar.title'),
	});
	headerEl.createSpan({
		cls: 'ioto-pq-sidebar__count',
		text: String(model?.counts.unlabeled ?? 0),
	});

	const listEl = sidebarEl.createDiv({ cls: 'ioto-pq-sidebar__list' });
	listEl.dataset.scrollKey = 'unlabeled';

	const tasks = model?.unlabeled ?? [];
	if (tasks.length === 0) {
		listEl.createEl('p', {
			cls: 'ioto-pq-sidebar__empty',
			text: t('priorityQuadrant.quadrant.empty'),
		});
	} else {
		for (const task of tasks) {
			renderQuadrantTaskCard(listEl, {
				task,
				bucketKey: 'unlabeled',
				showPriorityBadge: false,
				colorTitleByPriority: false,
				showProjectNameInTitle: ctx.getShowProjectNameInTaskList(),
				busy: ctx.isCardBusy(task.path),
				onOpen: (mods) => ctx.openTask(task.path, mods),
				onOpenMenu: (event, anchor) =>
					ctx.openPriorityMenu(task, event, anchor),
			});
		}
	}

	const savedScrollTop = scrollPositions.get('unlabeled');
	if (savedScrollTop !== undefined) {
		listEl.scrollTop = savedScrollTop;
	}
}
