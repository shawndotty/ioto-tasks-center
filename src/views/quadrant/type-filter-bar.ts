/**
 * 四象限过滤条的任务类型控件（[[Plan-20261117-085118]] §5.3）。
 *
 * 常显：宽屏图标 + 标签 + 计数，≤1024px 图标 + 计数（DOM 只有一份，切换交给 CSS）。
 * 结构只建一次，`updateQuadrantTypeControl` 只回写计数 / 激活态 / 可访问名。
 */

import { Menu } from 'obsidian';

import { t, type TranslationKey } from '../../lang/helpter';
import {
	QUADRANT_TASK_TYPES,
	type QuadrantTaskType,
} from '../../tasks-center/task-type-infer';
import type { QuadrantViewContext } from './context';
import {
	QUADRANT_CONTROL_ICONS,
	createQuadrantControlIcon,
} from './control-icon';

const TYPE_LABEL_KEYS: Record<QuadrantTaskType, TranslationKey> = {
	normal: 'task.type.normal',
	date: 'task.type.date',
	topic: 'task.type.topic',
	plan: 'task.type.plan',
};

export function buildQuadrantTypeControl(
	barEl: HTMLElement,
	ctx: QuadrantViewContext,
): void {
	const btnEl = barEl.createEl('button', { cls: 'ioto-pq-type-menu' });
	btnEl.type = 'button';
	btnEl.setAttribute('aria-haspopup', 'menu');
	createQuadrantControlIcon(
		btnEl,
		'ioto-pq-type-menu__icon',
		QUADRANT_CONTROL_ICONS.type,
	);
	btnEl.createSpan({
		cls: 'ioto-pq-type-menu__label',
		text: t('priorityQuadrant.type.label'),
	});
	btnEl.createSpan({ cls: 'ioto-pq-type-menu__count' });
	btnEl.addEventListener('click', (event: MouseEvent) => {
		const menu = new Menu();
		buildQuadrantTypeMenu(menu, ctx);
		menu.showAtMouseEvent(event);
	});
}

export function updateQuadrantTypeControl(
	headerEl: HTMLElement,
	ctx: QuadrantViewContext,
): void {
	const btnEl = headerEl.querySelector<HTMLElement>('.ioto-pq-type-menu');
	if (!btnEl) return;
	const model = ctx.getModel();
	const activeKeys = ctx.getTypeKeys();
	const all = activeKeys.size === QUADRANT_TASK_TYPES.length;
	const included = [...activeKeys].reduce(
		(sum, key) => sum + (model?.typeCounts[key] ?? 0),
		0,
	);
	btnEl
		.querySelector<HTMLElement>('.ioto-pq-type-menu__count')
		?.setText(String(included));
	btnEl.classList.toggle('is-active', !all);
	const label = t('view.taskFilterSwitcher.current', [
		t('priorityQuadrant.type.label'),
		all ? t('priorityQuadrant.type.all') : String(included),
	]);
	btnEl.setAttribute('aria-label', label);
	btnEl.setAttribute('title', label);
}

/**
 * 「全部类型」是唯一逃生口：固定语义为全选，不做 toggle，避免误触清空。
 * 4 项始终创建，不读 `enabledTaskCreationTypes`（历史文件仍应可按类型筛选）。
 */
export function buildQuadrantTypeMenu(
	menu: Menu,
	ctx: QuadrantViewContext,
): void {
	const model = ctx.getModel();
	const activeKeys = ctx.getTypeKeys();
	menu.addItem((item) => {
		item.setTitle(t('priorityQuadrant.type.label')).setIsLabel(true);
	});
	menu.addItem((item) => {
		item.setTitle(t('priorityQuadrant.type.all'))
			.setChecked(activeKeys.size === QUADRANT_TASK_TYPES.length)
			.onClick(() => ctx.setTypeKeys(QUADRANT_TASK_TYPES));
	});
	menu.addSeparator();
	for (const key of QUADRANT_TASK_TYPES) {
		menu.addItem((item) => {
			item.setTitle(
				t('view.taskFilterSwitcher.menuItem', [
					t(TYPE_LABEL_KEYS[key]),
					String(model?.typeCounts[key] ?? 0),
				]),
			)
				.setChecked(activeKeys.has(key))
				.onClick(() => ctx.toggleTypeKey(key));
		});
	}
}
