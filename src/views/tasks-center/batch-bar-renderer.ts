import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { t } from '../../lang/helpter';
import {
	showBatchActionsMenu,
	showBatchPriorityMenu,
	showBatchStarredMenu,
	showBatchUpTaskMenu,
} from './batch-bar-menus';
import { confirmAndBatchDeleteTasks } from './batch-edit-operations';
import { areAllVisibleTasksSelected } from './task-list-queries';

/**
 * 批量编辑栏。
 *
 * 形态由 `isMobileTaskListLayout()`（手机 / 面板 ≤720px）决定分支，而不是 media query：
 *  - 常规：`[已选 N 项 + 提示] │ [全选] │ [优先级 ▾][核心 ▾][上级 ▾] │ [删除]`
 *  - 窄栏：`[已选 N 项 + 提示]` 换行 + `[全选][操作 ▾]`
 *
 * 所有「设置 / 清除」都收进同一个下拉，按钮数从 9 降到 5（窄栏 2），
 * 退出批量模式不在本栏 —— 唯一出口是 tabs 栏右上角的常驻切换按钮（原地变 ×）。
 */

interface BatchBarButtonOptions {
	label: string;
	onClick: (event: MouseEvent) => void;
	/** 下拉触发器：文字右侧追加 `▾` 并标 `aria-haspopup`。 */
	hasMenu?: boolean;
	danger?: boolean;
	disabled?: boolean;
}

function createBatchBarButton(
	parent: HTMLElement,
	options: BatchBarButtonOptions,
): HTMLButtonElement {
	const cls = options.danger
		? 'ioto-tasks-center__batch-bar-button ioto-tasks-center__batch-bar-button--danger'
		: 'ioto-tasks-center__batch-bar-button';
	const buttonEl = parent.createEl('button', { cls });
	buttonEl.type = 'button';
	buttonEl.disabled = options.disabled ?? false;
	buttonEl.createSpan({
		cls: 'ioto-tasks-center__batch-bar-button-label',
		text: options.label,
	});
	if (options.hasMenu) {
		buttonEl.createSpan({
			cls: 'ioto-tasks-center__batch-bar-caret',
			text: '▾',
		});
		buttonEl.setAttribute('aria-haspopup', 'menu');
	}
	// 移动端：先掐断 pointerdown，避免宿主把这次点按当成行选中 / 拖拽的开始
	//（与 `compact-layout.ts` 的「⋯」按钮、行尾「⋯」同款做法）。
	buttonEl.addEventListener('pointerdown', (event: PointerEvent) => {
		event.stopPropagation();
	});
	buttonEl.addEventListener('click', (event: MouseEvent) => {
		if (buttonEl.disabled) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		options.onClick(event);
	});
	return buttonEl;
}

function renderLead(
	batchBarEl: HTMLElement,
	selectedCount: number,
): void {
	const leadEl = batchBarEl.createDiv({
		cls: 'ioto-tasks-center__batch-bar-lead',
	});
	const countEl = leadEl.createSpan({
		cls: 'ioto-tasks-center__batch-bar-count',
		// 显示值恒等于批量操作的实际作用域（`getSelectedTasks()` 只保留当前项目里
		// 仍存在的路径），不再用可能虚高的 `selectedTaskPaths.size`。
		text:
			selectedCount > 0
				? t('view.batchBar.count', [String(selectedCount)])
				: t('view.batchBar.emptyHint'),
	});
	countEl.setAttribute('aria-live', 'polite');
	countEl.toggleClass('is-empty', selectedCount === 0);
	leadEl.createSpan({
		cls: 'ioto-tasks-center__batch-bar-hint',
		text: t('view.batchBar.selectHint'),
	});
}

export function renderBatchBar(
	view: IOTOTasksCenterView,
	container: HTMLElement,
): void {
	const compact = view.isMobileTaskListLayout();
	const selectedCount = view.getSelectedTasks().length;
	const disabled = selectedCount === 0;

	const batchBarEl = container.createDiv({
		cls: compact
			? 'ioto-tasks-center__batch-bar is-compact'
			: 'ioto-tasks-center__batch-bar',
	});
	renderLead(batchBarEl, selectedCount);

	const groupsEl = batchBarEl.createDiv({
		cls: 'ioto-tasks-center__batch-bar-groups',
	});
	const selectAllLabel = areAllVisibleTasksSelected(view)
		? t('view.batchBar.selectAllActive')
		: t('view.batchBar.selectAll');

	if (compact) {
		// 窄栏两个控件：全选 + 操作（属性区 + 删除全收进菜单，避免横向滚动）。
		const selectGroupEl = groupsEl.createDiv({
			cls: 'ioto-tasks-center__batch-bar-group',
		});
		createBatchBarButton(selectGroupEl, {
			label: selectAllLabel,
			onClick: () => view.selectAllVisibleTasks(),
		});

		const actionsGroupEl = groupsEl.createDiv({
			cls: 'ioto-tasks-center__batch-bar-group',
		});
		createBatchBarButton(actionsGroupEl, {
			label: t('view.batchBar.actions'),
			hasMenu: true,
			disabled,
			onClick: (event) => showBatchActionsMenu(view, event),
		});
		return;
	}

	const selectGroupEl = groupsEl.createDiv({
		cls: 'ioto-tasks-center__batch-bar-group',
	});
	createBatchBarButton(selectGroupEl, {
		label: selectAllLabel,
		onClick: () => view.selectAllVisibleTasks(),
	});

	const propertyGroupEl = groupsEl.createDiv({
		cls: 'ioto-tasks-center__batch-bar-group',
	});
	createBatchBarButton(propertyGroupEl, {
		label: t('view.batchBar.menuPriority'),
		hasMenu: true,
		disabled,
		onClick: (event) => showBatchPriorityMenu(view, event),
	});
	createBatchBarButton(propertyGroupEl, {
		label: t('view.batchBar.menuStarred'),
		hasMenu: true,
		disabled,
		onClick: (event) => showBatchStarredMenu(view, event),
	});
	createBatchBarButton(propertyGroupEl, {
		label: t('view.batchBar.menuUpTask'),
		hasMenu: true,
		disabled,
		onClick: (event) => showBatchUpTaskMenu(view, event),
	});

	const dangerGroupEl = groupsEl.createDiv({
		cls: 'ioto-tasks-center__batch-bar-group',
	});
	createBatchBarButton(dangerGroupEl, {
		label: t('view.batchBar.menuDelete'),
		danger: true,
		disabled,
		onClick: () => {
			void confirmAndBatchDeleteTasks(view);
		},
	});
}
