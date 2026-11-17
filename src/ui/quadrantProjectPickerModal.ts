/**
 * 四象限「创建任务」的项目选择器（[[Plan-20261116-145111]] §4.2）。
 *
 * 只负责**挑项目**：候选集已由扫描层收敛为未归档项目，这里不做二次过滤，
 * 名称原样列出（[[Plan-20261117-092238]] §5.6）。
 */

import { FuzzySuggestModal } from 'obsidian';
import type { App } from 'obsidian';

import { t } from '../lang/helpter';
import type { QuadrantProjectOption } from '../views/quadrant/data-loader';

export class QuadrantProjectPickerModal extends FuzzySuggestModal<QuadrantProjectOption> {
	private readonly projectOptions: readonly QuadrantProjectOption[];
	private resolvePromise:
		| ((value: QuadrantProjectOption | null) => void)
		| null = null;
	private isResolved = false;

	constructor(
		app: App,
		projectOptions: readonly QuadrantProjectOption[],
		titleText: string = t('priorityQuadrant.create.projectPickerTitle'),
		placeholderText: string = t(
			'priorityQuadrant.create.projectPickerPlaceholder',
		),
	) {
		super(app);
		this.projectOptions = projectOptions;
		this.setTitle(titleText);
		this.setPlaceholder(placeholderText);
	}

	pick(): Promise<QuadrantProjectOption | null> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	getItems(): QuadrantProjectOption[] {
		return [...this.projectOptions];
	}

	getItemText(option: QuadrantProjectOption): string {
		return option.name;
	}

	onChooseItem(option: QuadrantProjectOption): void {
		this.resolve(option);
		this.close();
	}

	onClose(): void {
		this.resolve(null);
	}

	private resolve(value: QuadrantProjectOption | null): void {
		if (this.isResolved) return;
		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}