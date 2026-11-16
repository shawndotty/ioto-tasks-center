/**
 * 四象限「创建任务」的类型选项（[[Plan-20261116-154231]] §5.1）。
 *
 * 纯函数：归一化用户启用的类型，按固定顺序映射为菜单/直进所需的
 * `{ key, label }` 列表，便于单测而不依赖视图与 DOM。
 */

import { normalizeEnabledTaskCreationTypes } from '../../tasks-center/enabled-task-creation-types';
import type { TaskCreationType } from '../../tasks-center/task-template-config';
import { getTaskCreationOptions } from '../tasks-center/helpers';

export interface QuadrantTaskTypeOption {
	key: TaskCreationType;
	label: string;
}

export function resolveQuadrantTaskTypeOptions(
	enabledTypes: readonly TaskCreationType[],
): QuadrantTaskTypeOption[] {
	const enabled = new Set(normalizeEnabledTaskCreationTypes(enabledTypes));
	return getTaskCreationOptions().filter((option) => enabled.has(option.key));
}
