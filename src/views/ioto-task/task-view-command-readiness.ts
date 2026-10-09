import type { App } from 'obsidian';
import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import type { IOTOTaskView } from '../iotoTaskView';
import { collectCardLines } from './card-navigation';
import {
	EDIT_ITEM_CONTROLS_COMMAND_ID,
	INSERT_OUTGOING_LINK_COMMAND_ID,
	COMMAND_READINESS_POLL_MS,
	COMMAND_READINESS_TIMEOUT_MS,
	type CommandRegistryLike,
} from './task-view-constants';

/**
 * 目标命令当前是否可派发：`app.commands` 已注册该 id 且具备 `executeCommandById`。
 * 照 `runTask()` 的判据抽成方法，供编辑控制器按可用性隐藏按钮
 * （[[Plan-20261005-111411]] §三 步骤 4）。
 */
export function canDispatch(view: IOTOTaskView, commandId: string): boolean {
	const registry = (view.app as App & { commands?: CommandRegistryLike })
		.commands;
	return Boolean(
		registry?.commands &&
			commandId in registry.commands &&
			registry.executeCommandById,
	);
}

/**
 * 派发 ioto-settings 命令（照 `runTask()` 口径）。正常情况下按钮已按可用性
 * 隐藏，走到这里说明存在竞态（命令刚被注销），给 `Notice` 兜底不静默。
 */
export function dispatchCommand(view: IOTOTaskView, commandId: string): void {
	const registry = (view.app as App & { commands?: CommandRegistryLike })
		.commands;
	if (!canDispatch(view, commandId)) {
		new Notice(t('notice.iotoTaskView.runTaskUnavailable'));
		return;
	}
	void Promise.resolve(registry?.executeCommandById?.(commandId));
}

/**
 * 卡片动作区两条 ioto-settings 命令是否均已注册（补偿判据）。
 * 与 `buildEditingController` 里决定是否注入两个回调的口径完全一致。
 */
export function areCardActionCommandsReady(view: IOTOTaskView): boolean {
	return (
		canDispatch(view, INSERT_OUTGOING_LINK_COMMAND_ID) &&
		canDispatch(view, EDIT_ITEM_CONTROLS_COMMAND_ID)
	);
}

/** 取消在途的命令就绪补偿轮询（幂等；命令已齐 / 视图卸载时收口）。 */
export function clearCommandReadinessTimer(view: IOTOTaskView): void {
	if (view.commandReadinessTimer !== null) {
		window.clearTimeout(view.commandReadinessTimer);
		view.commandReadinessTimer = null;
	}
}

/**
 * 命令就绪补偿：渲染后若目标命令缺位，挂一趟轻量短轮询，命令一旦出现即对
 * **全部卡就地重建动作区**并自停；超时则保持隐藏。
 *
 * 前两个按钮（出链 / 条目控制）是「渲染那一刻」按 `app.commands.commands` 里
 * 命令是否已注册来**有条件创建**的，而 ioto-settings 延迟 1s 才注册命令 →
 * 视图落在窗口内渲染就会漏建。这里把「一次性判定」改成「等到就绪或超时」。
 *
 * 幂等：命令已齐或已有在途轮询时直接返回，连续重绘共用一趟，避免叠加轮询。
 * 补建走 `refreshCardActions`（只重建动作区），**不整树重绘**、不打断内联编辑。
 */
export function awaitCommandReadiness(view: IOTOTaskView): void {
	if (areCardActionCommandsReady(view)) {
		clearCommandReadinessTimer(view);
		return;
	}
	if (view.commandReadinessTimer !== null) {
		return;
	}
	const deadline = Date.now() + COMMAND_READINESS_TIMEOUT_MS;
	const tick = (): void => {
		view.commandReadinessTimer = null;
		if (areCardActionCommandsReady(view)) {
			for (const line of collectCardLines(view.contentEl)) {
				view.refreshCardActions(line);
			}
			return;
		}
		if (Date.now() < deadline) {
			view.commandReadinessTimer = window.setTimeout(
				tick,
				COMMAND_READINESS_POLL_MS,
			);
		}
	};
	view.commandReadinessTimer = window.setTimeout(
		tick,
		COMMAND_READINESS_POLL_MS,
	);
}
