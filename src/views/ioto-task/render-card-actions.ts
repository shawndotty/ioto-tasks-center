/**
 * 卡片动作区渲染：**左栏图标按钮 + 右栏只读徽章**。
 *
 * 首次渲染（`renderChecklistGroup`）与条目控制面板写回后的就地刷新
 * （`IOTOTaskView.refreshCardActions`）共用同一份逻辑，避免两处写法漂移：
 * 只重建 `.ioto-task-view__card-actions` 子树，**不碰**正文区与内联编辑器；
 * 容器不存在时按卡片结构新建，保证编辑器存活、正文不丢、滚动位置不动。
 *
 * 从 `render-note.ts` 拆出（Phase 2）。
 */

import { setIcon } from 'obsidian';

import { t } from '../../lang/helpter';
import type { ControlToken } from '../../tasks-center/note-structure';
import type { TaskNoteEditing } from './render-note';
import { renderControlBadges } from './render-control-badges';

/**
 * 构建 / 就地重建一张卡片的动作区：**左栏图标按钮 + 右栏只读徽章**。
 *
 * 首次渲染（`renderChecklistGroup`）与条目控制面板写回后的就地刷新
 * （`IOTOTaskView.refreshCardActions`）共用同一份逻辑，避免两处写法漂移：
 * 只重建 `.ioto-task-view__card-actions` 子树，**不碰**正文区与内联编辑器；
 * 容器不存在时按卡片结构新建，保证编辑器存活、正文不丢、滚动位置不动。
 *
 * 左右分栏见 [[Plan-20261005-111411]] §三 步骤 2：`options.editing` 上是否挂
 * `insertOutgoingLink` / `editItemControls` 决定左栏按钮是否出现（缺省=隐藏）。
 */
export function renderCardActions(
	cardEl: HTMLElement,
	controls: ControlToken[],
	options: { line: number; editing: TaskNoteEditing },
): void {
	let actionsEl = cardEl.querySelector<HTMLElement>(
		'.ioto-task-view__card-actions',
	);
	if (!actionsEl) {
		actionsEl = cardEl.createDiv({ cls: 'ioto-task-view__card-actions' });
	}
	actionsEl.empty();

	const buttonsEl = actionsEl.createDiv({
		cls: 'ioto-task-view__card-actions-buttons',
	});
	renderCardActionButtons(buttonsEl, options);

	const badgesEl = actionsEl.createDiv({
		cls: 'ioto-task-view__card-actions-badges',
	});
	renderControlBadges(badgesEl, controls);
}

/**
 * 渲染左栏图标按钮：出链、条目控制、放大（顺序固定，[[Plan-20261005-111411]] Q6），
 * 末尾追加删除（放大右侧，[[Plan-20261009-072524]] §三 步骤 1）。
 * 只在编辑控制器提供了对应回调时才渲染——即 `supportsInlineEdit()` 为真且
 * 目标命令已注册（Q5：只读 / ioto-settings 未启用时隐藏按钮）。
 */
function renderCardActionButtons(
	containerEl: HTMLElement,
	options: { line: number; editing: TaskNoteEditing },
): void {
	const { line, editing } = options;

	if (editing.insertOutgoingLink) {
		createCardActionButton(containerEl, {
			icon: 'arrow-up-right',
			label: t('view.iotoTaskView.cardActions.insertOutgoingLink'),
			action: 'insert-outgoing-link',
			// 闭包内 `?.` 兜底：方法存在性在渲染时已判定，此处只为满足窄化
			onClick: () => editing.insertOutgoingLink?.(line),
		});
	}

	if (editing.editItemControls) {
		createCardActionButton(containerEl, {
			icon: 'sliders-horizontal',
			label: t('view.iotoTaskView.cardActions.editItemControls'),
			action: 'edit-item-controls',
			onClick: () => editing.editItemControls?.(line),
		});
	}

	if (editing.toggleZoom) {
		// 图标随实时放大态自洽：`renderCardActions` 会被条目控制写回后
		// 的 `refreshCardActions` 就地重建，若写死 'maximize-2' 会把已放大的卡画回「放大」。
		const zoomed = editing.zoomLine === line;
		createCardActionButton(containerEl, {
			icon: zoomed ? 'minimize-2' : 'maximize-2',
			label: t(
				zoomed
					? 'view.iotoTaskView.cardActions.zoomOut'
					: 'view.iotoTaskView.cardActions.zoomIn',
			),
			action: 'toggle-zoom',
			onClick: () => editing.toggleZoom?.(line),
		});
	}

	if (editing.enabled) {
		// 卡片删除入口：复用既有二次确认链 editing.delete(line)（[[Discuss-20261009-072024]] §三.1）。
		// 位置 = 放大按钮右侧；独立 data-action 与 toolbar 的 delete-task 隔离（坑 3）。
		createCardActionButton(containerEl, {
			icon: 'trash-2',
			label: t('view.iotoTaskView.cardActions.deleteTask'),
			action: 'card-delete-task',
			onClick: () => editing.delete(line),
		});
	}
}

/**
 * 单个卡片动作按钮：`<button>` + `setIcon`，仅图标（可见内容为图标，
 * `label` 只进 `aria-label` / `title`）。点击 `stopPropagation`，避免冒泡到
 * 卡片点击 → 误触发选择 / 进入编辑（[[Plan-20261005-111411]] §三 步骤 3）。
 */
function createCardActionButton(
	containerEl: HTMLElement,
	options: {
		icon: string;
		label: string;
		action: string;
		onClick: () => void;
	},
): HTMLButtonElement {
	const btn = containerEl.createEl('button', {
		cls: 'ioto-task-view__card-action-btn',
		attr: {
			type: 'button',
			'aria-label': options.label,
			title: options.label,
			'data-action': options.action,
		},
	});
	setIcon(btn, options.icon);
	btn.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		options.onClick();
	});
	return btn;
}
