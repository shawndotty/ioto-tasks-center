/**
 * 四象限 / 侧栏共用的任务卡片构造器（[[Plan-20261115-201917]] §3.5）。
 *
 * 卡片是 `div[role=button]`，`⋯` 是真 `button`，避免交互元素嵌套。
 * `data-quadrant-key` / `data-task-path` 为后续拖拽预留，本期不挂 drop 处理器。
 */

import {
	getTaskStatusLabel,
	type TaskFileEntry,
} from '../../tasks-center/types';
import type { QuadrantBucketKey } from '../../tasks-center/quadrant-data';
import {
	getTaskProjectNameFromPath,
	resolveTaskDisplayTitle,
} from '../../tasks-center/task-display-title';
import { t } from '../../lang/helpter';
import { getTaskPriorityClassName } from '../tasks-center/helpers';
import { QUADRANT_CARD_CLASS } from './constants';

export interface QuadrantTaskCardOptions {
	task: TaskFileEntry;
	bucketKey: QuadrantBucketKey;
	showPriorityBadge: boolean;
	colorTitleByPriority: boolean;
	/** 任务标题是否保留「项目名-」前缀（与 `showProjectNameInTaskList` 同义）。 */
	showProjectNameInTitle: boolean;
	busy: boolean;
	onOpen: (mods: MouseEvent | null) => void;
	onOpenMenu: (event: MouseEvent, anchor: HTMLElement) => void;
}

export function renderQuadrantTaskCard(
	container: HTMLElement,
	options: QuadrantTaskCardOptions,
): HTMLElement {
	const { task } = options;
	const isUnlabeled = options.bucketKey === 'unlabeled';
	const title = resolveTaskDisplayTitle(
		task,
		options.showProjectNameInTitle,
	);
	const priorityClass =
		task.priority === undefined
			? null
			: getTaskPriorityClassName(task.priority);

	const cardEl = container.createDiv({
		cls: `${QUADRANT_CARD_CLASS}${isUnlabeled ? ' is-unlabeled' : ''}`,
	});
	cardEl.dataset.taskPath = task.path;
	cardEl.dataset.quadrantKey = options.bucketKey;
	cardEl.dataset.statusKey = task.status.key;
	cardEl.setAttribute('role', 'button');
	cardEl.setAttribute('tabindex', '0');
	cardEl.setAttribute(
		'aria-label',
		t('priorityQuadrant.card.openAria', [title]),
	);

	if (options.showPriorityBadge && task.priority !== undefined) {
		const badgeEl = cardEl.createSpan({
			cls: `ioto-pq-card__priority${priorityClass ? ` ${priorityClass}` : ''}`,
			text: `P${task.priority}`,
		});
		badgeEl.setAttribute(
			'aria-label',
			t('priorityQuadrant.card.priorityAria', [String(task.priority)]),
		);
	}

	cardEl.createSpan({
		cls: `ioto-pq-card__title${
			priorityClass && options.colorTitleByPriority
				? ` ${priorityClass} is-priority-colored`
				: ''
		}`,
		text: title,
	});

	const metaEl = cardEl.createSpan({ cls: 'ioto-pq-card__meta' });
	metaEl.createSpan({
		cls: 'ioto-pq-card__project',
		text: getTaskProjectNameFromPath(task.path),
	});
	metaEl.createSpan({
		cls: 'ioto-pq-card__status',
		text: getTaskStatusLabel(task.status.key),
	});
	if (task.starred) {
		const starEl = metaEl.createSpan({
			cls: 'ioto-pq-card__star',
			text: '⭐',
		});
		starEl.setAttribute(
			'aria-label',
			t('priorityQuadrant.card.starAria'),
		);
	}

	const moreEl = cardEl.createEl('button', {
		cls: 'clickable-icon ioto-pq-card__more',
	});
	moreEl.type = 'button';
	moreEl.setText('⋯');
	moreEl.ariaLabel = t('priorityQuadrant.card.moreAria');
	moreEl.disabled = options.busy;

	if (options.busy) {
		cardEl.addClass('is-busy');
		cardEl.setAttribute('aria-busy', 'true');
	}

	cardEl.addEventListener('click', (event) => {
		// 拖拽松手后的首个 click 只用于消费抑制标志，不打开任务。
		if (cardEl.dataset.iotoSuppressClick === '1') {
			delete cardEl.dataset.iotoSuppressClick;
			return;
		}
		if (options.busy) return;
		const target = event.target;
		if (
			target instanceof HTMLElement &&
			target.closest('.ioto-pq-card__more')
		) {
			return;
		}
		options.onOpen(event);
	});
	cardEl.addEventListener('keydown', (event) => {
		if (options.busy || event.target !== cardEl) return;
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		options.onOpen(null);
	});
	cardEl.addEventListener('contextmenu', (event) => {
		if (options.busy) return;
		event.preventDefault();
		event.stopPropagation();
		options.onOpenMenu(event, cardEl);
	});

	// 触屏滚动 / 点按都不该冒泡成「打开任务」。
	moreEl.addEventListener('pointerdown', (event) => {
		event.stopPropagation();
	});
	moreEl.addEventListener('keydown', (event) => {
		event.stopPropagation();
	});
	moreEl.addEventListener('click', (event) => {
		event.stopPropagation();
		if (options.busy) return;
		options.onOpenMenu(event, moreEl);
	});

	return cardEl;
}
