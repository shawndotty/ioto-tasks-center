/**
 * 2×2 象限渲染（[[Plan-20261115-201917]] §3.5）。
 *
 * 每次渲染重建四个 section；重建前按 `data-scroll-key` 记录 `scrollTop`，
 * 重建后恢复，避免写优先级后列表跳回顶部。
 */

import { t } from '../../lang/helpter';
import {
	QUADRANT_KEYS,
	type QuadrantKey,
} from '../../tasks-center/quadrant-data';
import { getTaskPriorityClassName } from '../tasks-center/helpers';
import type { QuadrantViewContext } from './context';
import { renderQuadrantTaskCard } from './task-card';

const QUADRANT_INDEX: Record<QuadrantKey, number> = {
	p0: 0,
	p1: 1,
	p2: 2,
	p3: 3,
};

export function captureQuadrantScroll(
	container: HTMLElement,
): Map<string, number> {
	const positions = new Map<string, number>();
	for (const el of Array.from(
		container.querySelectorAll<HTMLElement>('[data-scroll-key]'),
	)) {
		const key = el.dataset.scrollKey;
		if (key) positions.set(key, el.scrollTop);
	}
	return positions;
}

export function renderQuadrantGrid(
	gridEl: HTMLElement,
	ctx: QuadrantViewContext,
	scrollPositions: ReadonlyMap<string, number>,
): void {
	gridEl.empty();
	const model = ctx.getModel();
	if (!model) return;

	const showPriorityBadge = ctx.getShowTaskPriority();
	const colorTitleByPriority = ctx.getColorTaskTitleByPriority();
	const showProjectNameInTitle = ctx.getShowProjectNameInTaskList();

	for (const key of QUADRANT_KEYS) {
		const index = QUADRANT_INDEX[key];
		const sectionEl = gridEl.createEl('section', {
			cls: 'ioto-pq-quadrant',
		});
		sectionEl.dataset.quadrantKey = key;
		sectionEl.setAttribute('aria-labelledby', `ioto-pq-${key}-title`);

		const headerEl = sectionEl.createDiv({
			cls: 'ioto-pq-quadrant__header',
		});
		headerEl.createSpan({
			cls: `ioto-pq-quadrant__dot ${getTaskPriorityClassName(index)}`,
		});
		const titleEl = headerEl.createEl('h3', {
			cls: 'ioto-pq-quadrant__title',
			text: `P${index}`,
		});
		titleEl.id = `ioto-pq-${key}-title`;
		headerEl.createSpan({
			cls: 'ioto-pq-quadrant__count',
			text: String(model.counts[key]),
		});

		const listEl = sectionEl.createDiv({
			cls: 'ioto-pq-quadrant__list',
		});
		listEl.dataset.scrollKey = key;

		const tasks = model.buckets[key];
		if (tasks.length === 0) {
			listEl.createEl('p', {
				cls: 'ioto-pq-quadrant__empty',
				text: t('priorityQuadrant.quadrant.empty'),
			});
		} else {
			for (const task of tasks) {
				renderQuadrantTaskCard(listEl, {
					task,
					bucketKey: key,
					showPriorityBadge,
					colorTitleByPriority,
					showProjectNameInTitle,
					busy: ctx.isCardBusy(task.path),
					onOpen: (mods) => ctx.openTask(task.path, mods),
					onOpenMenu: (event, anchor) =>
						ctx.openPriorityMenu(task, event, anchor),
				});
			}
		}

		const savedScrollTop = scrollPositions.get(key);
		if (savedScrollTop !== undefined) {
			listEl.scrollTop = savedScrollTop;
		}
	}
}
