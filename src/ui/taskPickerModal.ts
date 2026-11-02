/**
 * 「切换到哪个任务」选择器（[[Plan-20261102-101509]] §4.2）。
 *
 * 只负责**挑文件**：候选过滤（任务笔记 / 排除当前任务）由调用方做好，选中后把
 * `TFile` 交回调用方（`TaskLinksModal.switchToTask` 重跑一次快照）。
 * 范式照 `moveTaskFileModal.ts`：任务文件可能上百个，用 `FuzzySuggestModal`
 * 借核心的模糊搜索，输入框就是需求里的「搜索框」。
 */

import { FuzzySuggestModal } from 'obsidian';
import type { App, TFile } from 'obsidian';

export interface TaskPickerModalOptions {
	/** 已过滤好的候选（按 vault 顺序，不做二次排序，与 moveTaskFileModal 一致）。 */
	files: readonly TFile[];
	placeholder: string;
	onChoose: (file: TFile) => void;
	/** 关窗时机（含选中路径）：把焦点还回触发按钮。 */
	onClosed?: () => void;
}

export class TaskPickerModal extends FuzzySuggestModal<TFile> {
	private readonly files: readonly TFile[];
	private readonly onChoose: (file: TFile) => void;
	private readonly onClosed: (() => void) | undefined;

	constructor(app: App, options: TaskPickerModalOptions) {
		super(app);
		this.files = options.files;
		this.onChoose = options.onChoose;
		this.onClosed = options.onClosed;
		this.setPlaceholder(options.placeholder);
	}

	getItems(): TFile[] {
		return [...this.files];
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onChoose(file);
	}

	onClose(): void {
		super.onClose();
		this.onClosed?.();
	}
}
