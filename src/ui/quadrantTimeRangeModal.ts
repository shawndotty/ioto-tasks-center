/**
 * 手机端自定义时间区间 Modal（[[Plan-20261116-083330]] §3.5）。
 *
 * 手机软键盘会遮挡 fixed 浮层，改用 Modal 壳承载同一面板；关闭后回焦触发控件。
 */

import { Modal, type App } from 'obsidian';

import { t } from '../lang/helpter';
import type { TaskTimeField } from '../tasks-center/task-time-range';
import {
	buildQuadrantTimeRangePanel,
	type QuadrantTimeRangePanelHandle,
} from './quadrantTimeRangePanel';

export interface QuadrantTimeRangeModalOptions {
	field: TaskTimeField;
	start: string;
	end: string;
	onApply(field: TaskTimeField, start: string, end: string): void;
	onClear(): void;
	onAfterClose?(): void;
}

export class QuadrantTimeRangeModal extends Modal {
	private panelHandle: QuadrantTimeRangePanelHandle | null = null;

	constructor(
		app: App,
		private readonly options: QuadrantTimeRangeModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText(t('priorityQuadrant.time.panelTitle'));
		this.contentEl.addClass('ioto-pq-time-modal');
		this.panelHandle = buildQuadrantTimeRangePanel(this.contentEl, {
			field: this.options.field,
			start: this.options.start,
			end: this.options.end,
			onApply: (field, start, end) => {
				this.options.onApply(field, start, end);
				this.close();
			},
			onClear: () => {
				this.options.onClear();
				this.close();
			},
			onCancel: () => this.close(),
		});
		this.panelHandle.focus();
	}

	onClose(): void {
		this.panelHandle = null;
		this.contentEl.empty();
		this.options.onAfterClose?.();
	}
}
