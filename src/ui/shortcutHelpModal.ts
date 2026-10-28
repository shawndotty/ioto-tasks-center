/**
 * 任务视图键位帮助面板（[[Plan-20261028-110920]]）。
 *
 * 只做渲染：清单与文案全部来自 `task-view-shortcut-spec.ts` 与 locale，
 * 平台判定由调用方传入（`main.ts` 用 `Platform` 取值），本文件不 import `Platform`，
 * 便于真机自检时手工构造 options。
 */

import { Modal } from 'obsidian';

import { t } from '../lang/helpter';
import {
	SHORTCUT_GROUPS,
	formatShortcut,
	type ShortcutEntry,
} from '../views/ioto-task/task-view-shortcut-spec';

export interface ShortcutHelpModalOptions {
	isMac: boolean;
	isMobile: boolean;
}

export class ShortcutHelpModal extends Modal {
	private readonly options: ShortcutHelpModalOptions;

	constructor(app: Modal['app'], options: ShortcutHelpModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.modalEl.addClass('ioto-tasks-center__shortcut-help-modal');
		this.setTitle(t('shortcutHelp.title'));

		const introEl = this.contentEl.createEl('p', {
			text: t('shortcutHelp.intro'),
		});
		introEl.addClass('ioto-tasks-center__modal-desc');

		const bodyEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__shortcut-help-body',
		});
		for (const group of SHORTCUT_GROUPS) {
			const groupEl = bodyEl.createEl('section', {
				cls: 'ioto-tasks-center__shortcut-help-group',
			});
			groupEl.createEl('h3', { text: t(group.titleKey) });
			groupEl.createEl('p', {
				cls: 'ioto-tasks-center__shortcut-help-when',
				text: t(group.whenKey),
			});
			for (const entry of group.entries) {
				this.renderEntry(groupEl, entry);
			}
		}

		if (this.options.isMobile) {
			this.contentEl.createEl('p', {
				cls: 'ioto-tasks-center__shortcut-help-footnote',
				text: t('shortcutHelp.footnoteMobile'),
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	/** 一行 = 键帽列 + 描述列（描述下可再挂补充说明）。 */
	private renderEntry(containerEl: HTMLElement, entry: ShortcutEntry): void {
		const rowEl = containerEl.createDiv({
			cls: 'ioto-tasks-center__shortcut-help-row',
		});
		const keysEl = rowEl.createDiv({
			cls: 'ioto-tasks-center__shortcut-help-keys',
		});
		this.renderKeys(keysEl, entry);

		const descEl = rowEl.createDiv({
			cls: 'ioto-tasks-center__shortcut-help-desc',
		});
		descEl.createDiv({ text: t(entry.labelKey) });
		for (const noteKey of entry.noteKeys ?? []) {
			descEl.createDiv({
				cls: 'ioto-tasks-center__shortcut-help-note',
				text: t(noteKey),
			});
		}
	}

	private renderKeys(keysEl: HTMLElement, entry: ShortcutEntry): void {
		if (entry.keyTextKey) {
			keysEl.createSpan({
				cls: 'ioto-tasks-center__shortcut-help-keytext',
				text: t(entry.keyTextKey),
			});
			return;
		}

		entry.chords.forEach((chord, chordIndex) => {
			if (chordIndex > 0) {
				keysEl.createSpan({
					cls: 'ioto-tasks-center__shortcut-help-plus',
					text: '/',
				});
			}
			const labels = formatShortcut(chord, { isMac: this.options.isMac });
			labels.forEach((label, labelIndex) => {
				if (labelIndex > 0) {
					keysEl.createSpan({
						cls: 'ioto-tasks-center__shortcut-help-plus',
						text: '+',
					});
				}
				keysEl.createEl('kbd', {
					cls: 'ioto-tasks-center__shortcut-help-key',
					text: label,
				});
			});
		});
	}
}
