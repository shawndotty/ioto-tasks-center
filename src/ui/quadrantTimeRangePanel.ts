/**
 * 四象限自定义时间区间的面板主体（[[Plan-20261116-083330]] §3.5）。
 *
 * 桌面锚定浮层与手机 Modal 共用同一份 DOM 与校验；校验每次输入实时重算，
 * 非法时禁用「应用」，只有 `invalid-order` 显示行内错误。
 */

import { t } from '../lang/helpter';
import {
	validateCustomRange,
	type TaskTimeField,
} from '../tasks-center/task-time-range';

export interface QuadrantTimeRangePanelOptions {
	field: TaskTimeField;
	start: string;
	end: string;
	onApply(field: TaskTimeField, start: string, end: string): void;
	onClear(): void;
	onCancel(): void;
}

export interface QuadrantTimeRangePanelHandle {
	focus(): void;
}

const FIELDS: TaskTimeField[] = ['created', 'updated'];

function fieldLabel(field: TaskTimeField): string {
	return field === 'created'
		? t('priorityQuadrant.time.fieldCreated')
		: t('priorityQuadrant.time.fieldUpdated');
}

export function buildQuadrantTimeRangePanel(
	container: HTMLElement,
	options: QuadrantTimeRangePanelOptions,
): QuadrantTimeRangePanelHandle {
	let field = options.field;
	let start = options.start;
	let end = options.end;

	const panelEl = container.createDiv({ cls: 'ioto-pq-time-panel' });

	const fieldsEl = panelEl.createDiv({ cls: 'ioto-pq-time-panel__fields' });
	fieldsEl.setAttribute('role', 'group');
	fieldsEl.setAttribute('aria-label', t('priorityQuadrant.time.label'));
	const fieldButtons = new Map<TaskTimeField, HTMLButtonElement>();
	for (const candidate of FIELDS) {
		const buttonEl = fieldsEl.createEl('button', {
			cls: 'ioto-pq-time-panel__field',
			attr: { type: 'button', 'data-time-field': candidate },
			text: fieldLabel(candidate),
		});
		buttonEl.addEventListener('click', () => {
			field = candidate;
			sync();
		});
		fieldButtons.set(candidate, buttonEl);
	}

	const datesEl = panelEl.createDiv({ cls: 'ioto-pq-time-panel__dates' });
	const startLabelEl = datesEl.createEl('label', {
		cls: 'ioto-pq-time-panel__date',
	});
	startLabelEl.createSpan({ text: t('priorityQuadrant.time.start') });
	const startInputEl = startLabelEl.createEl('input', {
		attr: { type: 'date' },
	});
	startInputEl.value = start;

	const endLabelEl = datesEl.createEl('label', {
		cls: 'ioto-pq-time-panel__date',
	});
	endLabelEl.createSpan({ text: t('priorityQuadrant.time.end') });
	const endInputEl = endLabelEl.createEl('input', { attr: { type: 'date' } });
	endInputEl.value = end;

	const errorEl = panelEl.createDiv({ cls: 'ioto-pq-time-panel__error' });
	errorEl.setText(t('priorityQuadrant.time.invalidRange'));
	errorEl.hidden = true;

	const actionsEl = panelEl.createDiv({ cls: 'ioto-pq-time-panel__actions' });
	const clearEl = actionsEl.createEl('button', {
		cls: 'ioto-pq-time-panel__action',
		attr: { type: 'button' },
		text: t('priorityQuadrant.time.clear'),
	});
	clearEl.addEventListener('click', () => options.onClear());
	const cancelEl = actionsEl.createEl('button', {
		cls: 'ioto-pq-time-panel__action',
		attr: { type: 'button' },
		text: t('priorityQuadrant.time.cancel'),
	});
	cancelEl.addEventListener('click', () => options.onCancel());
	const applyEl = actionsEl.createEl('button', {
		cls: 'ioto-pq-time-panel__action mod-cta',
		attr: { type: 'button' },
		text: t('priorityQuadrant.time.apply'),
	});
	applyEl.addEventListener('click', () => {
		if (validateCustomRange(start, end) !== 'ok') return;
		options.onApply(field, start, end);
	});

	startInputEl.addEventListener('input', () => {
		start = startInputEl.value;
		sync();
	});
	endInputEl.addEventListener('input', () => {
		end = endInputEl.value;
		sync();
	});

	function sync(): void {
		for (const [candidate, buttonEl] of fieldButtons) {
			buttonEl.classList.toggle('is-active', candidate === field);
			buttonEl.setAttribute(
				'aria-pressed',
				candidate === field ? 'true' : 'false',
			);
		}
		// 原生约束只做提示；JS 校验仍是最终防线（手输 / 老浏览器）。
		if (end.length > 0) startInputEl.max = end;
		else startInputEl.removeAttribute('max');
		if (start.length > 0) endInputEl.min = start;
		else endInputEl.removeAttribute('min');

		const state = validateCustomRange(start, end);
		applyEl.disabled = state !== 'ok';
		errorEl.hidden = state !== 'invalid-order';
	}

	sync();
	return { focus: () => startInputEl.focus() };
}
