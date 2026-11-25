/**
 * 任务描述润色的对照预览弹窗（Plan-20261125-210407 §5.1）。
 *
 * 左原文 / 右润色后 / 底部状态条 + 应用 / 重新生成 / 取消。
 * 关闭 / Esc / 取消一律不改任何字节；「应用」由调用方在 resolve 后统一写回。
 */

import {
	ButtonComponent,
	Component,
	MarkdownRenderer,
	Modal,
	Notice,
} from 'obsidian';

import { t } from '../lang/helpter';

export interface PolishPreviewState {
	/** 当前右侧文本（已清洗，不含交付物尾） */
	text: string;
	/** 是否允许应用（校验未通过时为 false） */
	canApply: boolean;
	/** 禁止应用的原因（canApply=true 时为 null） */
	blockedReason: string | null;
	/** 状态条只展示非空项 */
	statusLines: string[];
}

export type PolishPreviewResult =
	| { action: 'apply'; state: PolishPreviewState }
	| { action: 'cancel' };

export interface PolishPreviewOptions {
	original: string;
	initial: PolishPreviewState;
	/** 重新生成：沿用同一原文快照，返回最新状态 */
	onRegenerate: () => Promise<PolishPreviewState>;
}

export class PolishPreviewModal extends Modal {
	private state: PolishPreviewState;
	private resolvePromise: ((result: PolishPreviewResult) => void) | null =
		null;
	private isResolved = false;
	private regenerateBtn: ButtonComponent | null = null;
	private applyBtn: ButtonComponent | null = null;
	private rightEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private readonly renderer = new Component();
	private pending = false;

	constructor(
		app: Modal['app'],
		private readonly options: PolishPreviewOptions,
	) {
		super(app);
		this.state = options.initial;
	}

	openAndWait(): Promise<PolishPreviewResult> {
		return new Promise((resolve) => {
			this.resolvePromise = resolve;
			this.open();
		});
	}

	onOpen(): void {
		this.renderer.load();
		this.setTitle(t('polish.description.title'));
		this.modalEl.addClass('ioto-polish-preview-modal');
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('ioto-polish-preview');

		const columnsEl = contentEl.createDiv({
			cls: 'ioto-polish-preview__columns',
		});
		const originalCol = columnsEl.createDiv({
			cls: 'ioto-polish-preview__column',
		});
		originalCol.createDiv({
			cls: 'ioto-polish-preview__heading',
			text: t('polish.description.original'),
		});
		const originalBody = originalCol.createDiv({
			cls: 'ioto-polish-preview__body markdown-rendered',
		});
		void MarkdownRenderer.render(
			this.app,
			this.options.original,
			originalBody,
			'',
			this.renderer,
		);

		const polishedCol = columnsEl.createDiv({
			cls: 'ioto-polish-preview__column',
		});
		polishedCol.createDiv({
			cls: 'ioto-polish-preview__heading',
			text: t('polish.description.polished'),
		});
		this.rightEl = polishedCol.createDiv({
			cls: 'ioto-polish-preview__body markdown-rendered',
		});

		this.statusEl = contentEl.createDiv({
			cls: 'ioto-polish-preview__status',
		});

		const actionsEl = contentEl.createDiv({
			cls: 'ioto-polish-preview__actions',
		});
		new ButtonComponent(actionsEl)
			.setButtonText(t('polish.description.cancel'))
			.onClick(() => this.close());

		this.regenerateBtn = new ButtonComponent(actionsEl)
			.setButtonText(t('polish.description.regenerate'))
			.onClick(() => {
				void this.regenerate();
			});

		this.applyBtn = new ButtonComponent(actionsEl)
			.setButtonText(t('polish.description.apply'))
			.setCta()
			.onClick(() => this.apply());

		this.renderState();
	}

	onClose(): void {
		this.renderer.unload();
		this.contentEl.empty();
		this.resolve({ action: 'cancel' });
	}

	private async regenerate(): Promise<void> {
		if (this.pending) return;
		this.pending = true;
		this.updateButtons();
		try {
			this.state = await this.options.onRegenerate();
			this.renderState();
		} catch {
			new Notice(t('polish.description.errRegenerate'));
		} finally {
			this.pending = false;
			this.updateButtons();
		}
	}

	private apply(): void {
		if (!this.state.canApply) return;
		this.resolve({ action: 'apply', state: this.state });
		this.close();
	}

	private renderState(): void {
		if (this.rightEl) {
			this.rightEl.empty();
			void MarkdownRenderer.render(
				this.app,
				this.state.text,
				this.rightEl,
				'',
				this.renderer,
			);
		}

		if (this.statusEl) {
			this.statusEl.empty();
			const lines = [...this.state.statusLines];
			if (this.state.blockedReason) {
				lines.unshift(this.state.blockedReason);
			}
			for (const line of lines) {
				this.statusEl.createDiv({
					cls: 'ioto-polish-preview__status-line',
					text: line,
				});
			}
		}

		this.updateButtons();
	}

	private updateButtons(): void {
		if (this.applyBtn) {
			this.applyBtn.setDisabled(!this.state.canApply || this.pending);
		}
		if (this.regenerateBtn) {
			this.regenerateBtn.setDisabled(this.pending);
		}
	}

	private resolve(result: PolishPreviewResult): void {
		if (this.isResolved) return;
		this.isResolved = true;
		this.resolvePromise?.(result);
	}
}