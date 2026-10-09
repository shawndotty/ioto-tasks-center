/**
 * 卡片动作区右栏的只读徽章渲染：把条目控制项（depends / agent / model /
 * fanout / turns）画成图标 + 文案。
 *
 * 从 `render-note.ts` 拆出（Phase 2），纯 DOM 渲染，无状态。
 */

import { setIcon } from 'obsidian';

import { t } from '../../lang/helpter';
import type { ControlKind, ControlToken } from '../../tasks-center/note-structure';

/** 控制项 → 图标名（Obsidian `setIcon` 语汇）。 */
function controlIcon(kind: ControlKind): string {
	switch (kind) {
		case 'depends':
			return 'link';
		case 'agent':
			return 'bot';
		case 'model':
			return 'cpu';
		case 'fanout':
			return 'git-fork';
		case 'turns':
			return 'refresh-cw';
		default:
			return 'circle';
	}
}

/** 控制项 → 徽章文案（走 i18n，三语对齐）。 */
function controlLabel(control: ControlToken): string {
	switch (control.kind) {
		case 'depends':
			return Array.isArray(control.value)
				? t('view.iotoTaskView.badge.depends', [String(control.value.length)])
				: t('view.iotoTaskView.badge.dependsIndex', [
						String(control.value),
					]);
		case 'agent':
			return t('view.iotoTaskView.badge.agent', [String(control.value)]);
		case 'model':
			return t('view.iotoTaskView.badge.model', [String(control.value)]);
		case 'fanout':
			return control.value === true
				? t('view.iotoTaskView.badge.fanout')
				: t('view.iotoTaskView.badge.fanoutLimit', [
						String(control.value),
					]);
		case 'turns':
			return control.value === 0
				? t('view.iotoTaskView.badge.turnsUnlimited')
				: t('view.iotoTaskView.badge.turns', [String(control.value)]);
		default:
			return control.raw;
	}
}

/** 徽章 tooltip：depends 列全部笔记名，其余保留原文。 */
function controlTitle(control: ControlToken): string {
	if (control.kind === 'depends' && Array.isArray(control.value)) {
		return control.value.join('、');
	}
	return control.raw;
}

/**
 * 把控制项渲染成动作区里的只读徽章（v1）。
 * 同一行同时有 `[model:: …]` 与 `#ioto/model/…` 时只显示优先级高者，但两者都
 * 保留在 `controls` 里供写回（[[Plan-20261003-162429]] §5.2）。
 */
export function renderControlBadges(
	containerEl: HTMLElement,
	controls: ControlToken[],
): void {
	const hasInlineModel = controls.some(
		(control) =>
			control.kind === 'model' && control.raw.startsWith('[model'),
	);

	for (const control of controls) {
		if (
			control.kind === 'model' &&
			!control.raw.startsWith('[model') &&
			hasInlineModel
		) {
			continue;
		}

		const badgeEl = containerEl.createSpan({
			cls: 'ioto-task-view__badge',
			attr: {
				'data-kind': control.kind,
				title: controlTitle(control),
			},
		});
		const iconEl = badgeEl.createSpan({
			cls: 'ioto-task-view__badge-icon',
		});
		setIcon(iconEl, controlIcon(control.kind));
		badgeEl.createSpan({
			cls: 'ioto-task-view__badge-label',
			text: controlLabel(control),
		});
	}
}
