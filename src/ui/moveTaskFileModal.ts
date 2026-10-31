/**
 * 「移动到其他任务文件」的文件选择器（[[Plan-20261031-205655]] §四.8）。
 *
 * 只负责**挑文件**：过滤掉非任务笔记与源文件本身，选中后把 `TFile` 交给调用方
 * （写盘走 `commitCrossFileMoveToPath`，与本模块无关）。
 *
 * 范式照 `duplicateTaskModal.ts`（原生 `Modal` + `ButtonComponent`），
 * 这里用 `FuzzySuggestModal` 是因为任务文件可能有几十上百个，需要搜索。
 */

import { FuzzySuggestModal } from 'obsidian';
import type { App, TFile } from 'obsidian';

import { t } from '../lang/helpter';

export interface MoveTaskFileModalOptions {
	/** 目标候选文件（已过滤好：任务笔记、非源文件）。 */
	files: readonly TFile[];
	onChoose: (file: TFile) => void;
}

export class MoveTaskFileModal extends FuzzySuggestModal<TFile> {
	private readonly files: readonly TFile[];
	private readonly onChoose: (file: TFile) => void;

	constructor(app: App, options: MoveTaskFileModalOptions) {
		super(app);
		this.files = options.files;
		this.onChoose = options.onChoose;
		this.setPlaceholder(t('view.iotoTaskView.moveToFile.placeholder'));
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
}
