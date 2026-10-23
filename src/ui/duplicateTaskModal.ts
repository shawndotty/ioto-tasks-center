import { ButtonComponent, Modal } from 'obsidian';

import { t } from '../lang/helpter';

export type DuplicateTaskChoice = 'task' | 'withContinuation' | null;

export interface DuplicateTaskModalOptions {
	/** 本卡续写行数，仅用于正文文案 */
	continuationCount: number;
}

/**
 * 「创建任务副本」三态弹窗（[[Plan-20261023-145916]] §5.2）。
 *
 * 不能用 `ConfirmModal`：它只有 `boolean` 两个出口，表达不了「不要续写区、但要任务」
 * （[[Research-20261023-143754]] D4）。三个按钮 = 三个结果，单击一次完成，无需复选框。
 */
export class DuplicateTaskModal extends Modal {
	private readonly continuationCount: number;
	private resolvePromise: ((value: DuplicateTaskChoice) => void) | null = null;
	private isResolved = false;

	constructor(app: Modal['app'], options: DuplicateTaskModalOptions) {
		super(app);
		this.continuationCount = options.continuationCount;
	}

	openAndPick(): Promise<DuplicateTaskChoice> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.setTitle(t('modal.duplicateTask.title'));

		const descriptionEl = this.contentEl.createEl('p', {
			text: t('modal.duplicateTask.desc', [String(this.continuationCount)]),
		});
		descriptionEl.addClass('ioto-tasks-center__modal-desc');

		const actionsEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__modal-actions',
		});

		new ButtonComponent(actionsEl)
			.setButtonText(t('modal.duplicateTask.cancel'))
			.onClick(() => this.close());

		new ButtonComponent(actionsEl)
			.setButtonText(t('modal.duplicateTask.taskOnly'))
			.onClick(() => this.pick('task'));

		// 默认焦点在这里：副本语义上默认「完整」（D4）。
		// 🔴 必须延后一拍：核心 `Modal.open()` 在 `onOpen()` 之后才聚焦 `modalEl`，
		// 浏览器随即把焦点落到第一个可聚焦子元素（= 取消按钮），同步 `focus()` 会被盖掉。
		const withContinuationBtn = new ButtonComponent(actionsEl)
			.setButtonText(t('modal.duplicateTask.withContinuation'))
			.setCta()
			.onClick(() => this.pick('withContinuation'));
		window.setTimeout(() => {
			withContinuationBtn.buttonEl.focus();
		}, 0);
	}

	onClose(): void {
		this.contentEl.empty();
		this.resolve(null);
	}

	private pick(choice: Exclude<DuplicateTaskChoice, null>): void {
		this.resolve(choice);
		this.close();
	}

	/** 与 `ConfirmModal.resolve` 同款幂等守卫：`pick` 会触发 `onClose` 二次回调 */
	private resolve(value: DuplicateTaskChoice): void {
		if (this.isResolved) {
			return;
		}
		this.isResolved = true;
		this.resolvePromise?.(value);
	}
}
