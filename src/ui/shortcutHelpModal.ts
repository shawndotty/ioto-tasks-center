/**
 * 任务视图键位帮助面板（[[Plan-20261028-110920]]）。
 *
 * 只做渲染：清单与文案全部来自 `task-view-shortcut-spec.ts` 与 locale。
 * 渲染类本身仍不判定平台（options 由调用方传入），平台取值收敛在
 * `openShortcutHelpModal()` 一处，避免命令与悬浮按钮各拼一份。
 */

import { Modal, Platform, type App } from 'obsidian';

import { t } from '../lang/helpter';
import {
	captureShortcutState,
	resolveCurrentShortcutGroupId,
	type ShortcutStateSource,
} from '../views/ioto-task/task-view-shortcut-state';
import {
	SHORTCUT_GROUPS,
	formatShortcut,
	type ShortcutEntry,
	type ShortcutGroupId,
} from '../views/ioto-task/task-view-shortcut-spec';

export interface ShortcutHelpModalOptions {
	isMac: boolean;
	isMobile: boolean;
	/** 打开瞬间命中的分组；`null` = 无视图上下文，不标任何组。 */
	currentGroupId: ShortcutGroupId | null;
}

/**
 * 唯一的打开入口：命令面板与悬浮帮助按钮共用，平台参数只在这里拼一次
 * （[[Research-20261028-133749]] §2.2）。
 *
 * 🔴 状态快照必须在这里同步取（`open()` 之前）：核心 `Modal` 一打开就夺焦，
 *    编辑态/搜索态随即消失，进 `onOpen` 再读永远读不到
 *    （[[Plan-20261028-142008]] §2.3）。`source` 省略 = 无视图上下文。
 */
export function openShortcutHelpModal(
	app: App,
	source?: ShortcutStateSource,
): void {
	const currentGroupId = source
		? resolveCurrentShortcutGroupId(
				captureShortcutState(source, activeDocument),
			)
		: null;
	new ShortcutHelpModal(app, {
		isMac: Platform.isMacOS,
		isMobile: Platform.isMobile,
		currentGroupId,
	}).open();
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

		// 有快照时把语义写在用户眼前：高亮的是「打开面板时」的状态，不是实时的
		// （面板打开后编辑态/搜索态已结束，见 `openShortcutHelpModal` 头注）。
		if (this.options.currentGroupId !== null) {
			const stateEl = this.contentEl.createEl('p', {
				text: t('shortcutHelp.introState'),
			});
			stateEl.addClass('ioto-tasks-center__modal-desc');
		}

		const bodyEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__shortcut-help-body',
		});
		let currentEl: HTMLElement | null = null;
		for (const group of SHORTCUT_GROUPS) {
			const isCurrent = group.id === this.options.currentGroupId;
			const groupEl = bodyEl.createEl('section', {
				cls: 'ioto-tasks-center__shortcut-help-group',
			});
			if (isCurrent) {
				groupEl.addClass('is-current');
				currentEl = groupEl;
			}
			const titleEl = groupEl.createEl('h3');
			titleEl.createSpan({ text: t(group.titleKey) });
			if (isCurrent) {
				titleEl.createSpan({
					cls: 'ioto-tasks-center__shortcut-help-current',
					text: t('shortcutHelp.current'),
				});
			}
			groupEl.createEl('p', {
				cls: 'ioto-tasks-center__shortcut-help-when',
				text: t(group.whenKey),
			});
			for (const entry of group.entries) {
				this.renderEntry(groupEl, entry);
			}
		}

		// 高亮组可能在折叠线以下（`section` 是最后一组）：滚进视野。
		// 不能同步滚：onOpen 时未必已完成布局，故等一帧。
		if (currentEl) {
			const targetEl: HTMLElement = currentEl;
			window.requestAnimationFrame(() => {
				if (targetEl.isConnected) {
					targetEl.scrollIntoView({ block: 'nearest' });
				}
			});
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
