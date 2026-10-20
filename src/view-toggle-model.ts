/**
 * 视图切换悬浮按钮的纯模型层（[[Plan-20261019-190001]] §3.2）。
 *
 * 只含字面量与分支、**不 import 任何模块**（连 `obsidian` 都不引），
 * 便于按本插件「纯函数进 node --test」的约定直接单测。
 * 路由层 (`task-view-routing.ts`) 值导入了 IOTOTaskView 等重量级模块，
 * 映射表必须独立在这里才不会把测试环境拖进 Obsidian 运行时。
 */

export type ToggleDirection = 'to-markdown' | 'to-task-view';

/** 叶子容器（.workspace-leaf-content）低于该高度即收起悬浮按钮（[[Research-20261020-111403]] §4.1）。 */
export const TOGGLE_MIN_VIEW_HEIGHT = 600;

/** 从「收起」恢复为「显示」的延迟：键盘动画期核心会临时放开 max-height，不延迟会闪一下。 */
export const TOGGLE_SHOW_DELAY_MS = 150;

/** 高度闸门判据：过矮（含未布局的 0）即视为需要收起。 */
export function isViewTooShortForToggle(height: number): boolean {
	return height < TOGGLE_MIN_VIEW_HEIGHT;
}

export interface ToggleDescriptor {
	direction: ToggleDirection;
	icon: 'file-text' | 'list-todo';
	labelKey:
		| 'view.iotoTaskView.toggleToTaskView'
		| 'view.iotoTaskView.toggleToMarkdown';
}

/** 方向 → 图标 / 文案。null 入 null 出，便于路由层直接透传。 */
export function describeToggle(
	direction: ToggleDirection | null,
): ToggleDescriptor | null {
	if (direction === null) return null;
	return direction === 'to-markdown'
		? {
				direction,
				icon: 'file-text',
				labelKey: 'view.iotoTaskView.toggleToMarkdown',
			}
		: {
				direction,
				icon: 'list-todo',
				labelKey: 'view.iotoTaskView.toggleToTaskView',
			};
}
