/**
 * 视图切换悬浮按钮的纯模型层（[[Plan-20261019-190001]] §3.2）。
 *
 * 只含字面量与分支、**不 import 任何模块**（连 `obsidian` 都不引），
 * 便于按本插件「纯函数进 node --test」的约定直接单测。
 * 路由层 (`task-view-routing.ts`) 值导入了 IOTOTaskView 等重量级模块，
 * 映射表必须独立在这里才不会把测试环境拖进 Obsidian 运行时。
 */

export type ToggleDirection = 'to-markdown' | 'to-task-view';

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
