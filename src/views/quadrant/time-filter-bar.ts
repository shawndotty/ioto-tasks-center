/**
 * 四象限过滤条的时间范围控件（[[Plan-20261116-083330]] §3.3 / §3.4）。
 *
 * 一个控件同时表达「字段 + 时间段」：宽屏原生 `<select>`（optgroup 分组），
 * 窄屏菜单按钮（CSS 900px 断点互换，两个入口都在 DOM 里）。
 * 结构只建一次，`updateQuadrantTimeControls` 只回写值与自定义项文案，不重建。
 */

import { Menu } from 'obsidian';

import { t, type TranslationKey } from '../../lang/helpter';
import {
	QUADRANT_TIME_PRESET_KEYS,
	decodeQuadrantTimeFilter,
	encodeQuadrantTimeFilter,
	shortDate,
	type QuadrantTimeFilter,
	type QuadrantTimePreset,
	type TaskTimeField,
} from '../../tasks-center/task-time-range';
import type { QuadrantViewContext } from './context';

const PRESET_LABEL_KEYS: Record<QuadrantTimePreset, TranslationKey> = {
	'created-week': 'priorityQuadrant.time.presetWeek',
	'created-two-weeks': 'priorityQuadrant.time.presetTwoWeeks',
	'created-month': 'priorityQuadrant.time.presetMonth',
	'created-calendar-week': 'priorityQuadrant.time.presetCalendarWeek',
	'created-calendar-month': 'priorityQuadrant.time.presetCalendarMonth',
	'updated-week': 'priorityQuadrant.time.presetWeek',
	'updated-two-weeks': 'priorityQuadrant.time.presetTwoWeeks',
	'updated-month': 'priorityQuadrant.time.presetMonth',
	'updated-calendar-week': 'priorityQuadrant.time.presetCalendarWeek',
	'updated-calendar-month': 'priorityQuadrant.time.presetCalendarMonth',
};

const PRESET_GROUPS: Array<{
	field: TaskTimeField;
	label: TranslationKey;
	presets: QuadrantTimePreset[];
}> = [
	{
		field: 'created',
		label: 'priorityQuadrant.time.groupCreated',
		presets: QUADRANT_TIME_PRESET_KEYS.filter((preset) =>
			preset.startsWith('created'),
		),
	},
	{
		field: 'updated',
		label: 'priorityQuadrant.time.groupUpdated',
		presets: QUADRANT_TIME_PRESET_KEYS.filter((preset) =>
			preset.startsWith('updated'),
		),
	},
];

const CUSTOM_OPTION_VALUE = 'custom';

function customRangeText(filter: QuadrantTimeFilter, nowMs: number): string {
	if (filter.kind !== 'custom') return '';
	const start = (filter.start ?? '').trim();
	const end = (filter.end ?? '').trim();
	if (start.length > 0 && end.length > 0) {
		return t('priorityQuadrant.time.customRange', [
			shortDate(start, nowMs),
			shortDate(end, nowMs),
		]);
	}
	if (start.length > 0) {
		return t('priorityQuadrant.time.customFrom', [shortDate(start, nowMs)]);
	}
	return t('priorityQuadrant.time.customUntil', [shortDate(end, nowMs)]);
}

/** 菜单 / 下拉 / 按钮摘要共用的短标签。 */
export function timeFilterLabel(
	filter: QuadrantTimeFilter,
	nowMs: number = Date.now(),
): string {
	switch (filter.kind) {
		case 'none':
			return t('priorityQuadrant.time.all');
		case 'preset':
			return t(PRESET_LABEL_KEYS[filter.value]);
		case 'custom':
			return t('priorityQuadrant.time.customActive', [
				customRangeText(filter, nowMs),
			]);
	}
}

function isPresetActive(
	filter: QuadrantTimeFilter,
	preset: QuadrantTimePreset,
): boolean {
	return filter.kind === 'preset' && filter.value === preset;
}

function buildTimeSelectOptions(
	selectEl: HTMLSelectElement,
	ctx: QuadrantViewContext,
): void {
	selectEl.createEl('option', {
		text: t('priorityQuadrant.time.all'),
		value: encodeQuadrantTimeFilter({ kind: 'none' }),
	});
	for (const group of PRESET_GROUPS) {
		const groupEl = selectEl.createEl('optgroup', {
			attr: { label: t(group.label) },
		});
		for (const preset of group.presets) {
			groupEl.createEl('option', {
				text: t(PRESET_LABEL_KEYS[preset]),
				value: encodeQuadrantTimeFilter({ kind: 'preset', value: preset }),
			});
		}
	}
	selectEl.createEl('option', {
		text: t('priorityQuadrant.time.custom'),
		value: CUSTOM_OPTION_VALUE,
	});

	selectEl.addEventListener('change', () => {
		if (selectEl.value === CUSTOM_OPTION_VALUE) {
			// 先把下拉还原为当前过滤器：取消编辑时不留「Custom range…」的假选中。
			syncTimeSelect(selectEl, ctx.getTimeFilter(), Date.now());
			ctx.openTimeRangeEditor(selectEl);
			return;
		}
		ctx.setTimeFilter(decodeQuadrantTimeFilter(selectEl.value));
	});
}

function syncTimeSelect(
	selectEl: HTMLSelectElement,
	filter: QuadrantTimeFilter,
	nowMs: number,
): void {
	// 自定义过滤器没有独立 option，选中常驻的 `custom` 项（其文案由 update 回写）。
	selectEl.value =
		filter.kind === 'custom'
			? CUSTOM_OPTION_VALUE
			: encodeQuadrantTimeFilter(filter);
	const customOptionEl = selectEl.querySelector<HTMLOptionElement>(
		`option[value="${CUSTOM_OPTION_VALUE}"]`,
	);
	if (customOptionEl) {
		customOptionEl.setText(
			filter.kind === 'custom'
				? t('priorityQuadrant.time.customActive', [
						customRangeText(filter, nowMs),
					])
				: t('priorityQuadrant.time.custom'),
		);
	}
}

/** 宽屏 `<select>` + 窄屏菜单按钮（显示切换交给 CSS）。 */
export function buildQuadrantTimeControls(
	barEl: HTMLElement,
	ctx: QuadrantViewContext,
): void {
	const labelEl = barEl.createEl('label', {
		cls: 'ioto-pq-filterbar__time',
	});
	labelEl.createSpan({ text: t('priorityQuadrant.time.label') });
	const selectEl = labelEl.createEl('select', { cls: 'ioto-pq-time-select' });
	selectEl.ariaLabel = t('priorityQuadrant.time.label');
	buildTimeSelectOptions(selectEl, ctx);

	const menuBtnEl = barEl.createEl('button', { cls: 'ioto-pq-time-menu' });
	menuBtnEl.type = 'button';
	menuBtnEl.setAttribute('aria-haspopup', 'menu');
	menuBtnEl.createSpan({
		cls: 'ioto-pq-time-menu__label',
		text: t('priorityQuadrant.time.label'),
	});
	menuBtnEl.createSpan({ cls: 'ioto-pq-time-menu__value' });
	menuBtnEl.addEventListener('click', (event: MouseEvent) => {
		const menu = new Menu();
		buildQuadrantTimeMenu(menu, ctx, menuBtnEl);
		menu.showAtMouseEvent(event);
	});
}

export function updateQuadrantTimeControls(
	headerEl: HTMLElement,
	ctx: QuadrantViewContext,
): void {
	const nowMs = Date.now();
	const filter = ctx.getTimeFilter();

	const selectEl = headerEl.querySelector<HTMLSelectElement>(
		'.ioto-pq-time-select',
	);
	if (selectEl) syncTimeSelect(selectEl, filter, nowMs);

	const menuBtnEl = headerEl.querySelector<HTMLElement>('.ioto-pq-time-menu');
	if (menuBtnEl) {
		const label = timeFilterLabel(filter, nowMs);
		menuBtnEl
			.querySelector<HTMLElement>('.ioto-pq-time-menu__value')
			?.setText(filter.kind === 'none' ? '' : label);
		menuBtnEl.classList.toggle('is-active', filter.kind !== 'none');
		const title = t('view.taskFilterSwitcher.current', [
			t('priorityQuadrant.time.label'),
			label,
		]);
		menuBtnEl.setAttribute('aria-label', title);
		menuBtnEl.setAttribute('title', title);
	}
}

/**
 * 窄屏时间菜单：一律按 `ctx` 现状重建，不缓存。
 * 点击自定义只打开编辑器，不立即改状态（取消由 `updateQuadrantTimeControls` 还原）。
 */
export function buildQuadrantTimeMenu(
	menu: Menu,
	ctx: QuadrantViewContext,
	anchorEl: HTMLElement,
): void {
	const filter = ctx.getTimeFilter();
	menu.addItem((item) => {
		item.setTitle(t('priorityQuadrant.time.label')).setIsLabel(true);
	});
	menu.addItem((item) => {
		item.setTitle(t('priorityQuadrant.time.all'))
			.setChecked(filter.kind === 'none')
			.onClick(() => ctx.setTimeFilter({ kind: 'none' }));
	});

	for (const group of PRESET_GROUPS) {
		menu.addSeparator();
		menu.addItem((item) => {
			item.setTitle(t(group.label)).setIsLabel(true);
		});
		for (const preset of group.presets) {
			menu.addItem((item) => {
				item.setTitle(t(PRESET_LABEL_KEYS[preset]))
					.setChecked(isPresetActive(filter, preset))
					.onClick(() =>
						ctx.setTimeFilter({ kind: 'preset', value: preset }),
					);
			});
		}
	}

	menu.addSeparator();
	menu.addItem((item) => {
		item.setTitle(t('priorityQuadrant.time.custom'))
			.setChecked(filter.kind === 'custom')
			.onClick(() => ctx.openTimeRangeEditor(anchorEl));
	});
}
