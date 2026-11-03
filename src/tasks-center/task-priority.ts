import type { App, TFile } from 'obsidian';
import {
	removeScalarProperty,
	rewriteTaskFrontmatter,
	upsertScalarProperty,
} from './frontmatter-properties';

export const TASK_PRIORITY_VALUES = [0, 1, 2, 3] as const;

export type TaskPriorityValue = (typeof TASK_PRIORITY_VALUES)[number];

export function isTaskPriorityValue(value: number): value is TaskPriorityValue {
	return TASK_PRIORITY_VALUES.includes(value as TaskPriorityValue);
}

/**
 * 设置任务笔记的优先级属性，返回写盘后的完整内容
 * （调用方据此算 frontmatter 行数 Δ，见 [[Plan-20261103-103716]] §四.C4）。
 */
export async function setTaskFilePriority(
	app: App,
	file: TFile,
	priority: TaskPriorityValue,
): Promise<string> {
	return updateTaskFilePriority(app, file, priority);
}

/** 删除优先级属性，返回写盘后的完整内容。 */
export async function clearTaskFilePriority(
	app: App,
	file: TFile,
): Promise<string> {
	return updateTaskFilePriority(app, file);
}

async function updateTaskFilePriority(
	app: App,
	file: TFile,
	priority?: TaskPriorityValue,
): Promise<string> {
	return rewriteTaskFrontmatter(app, file, (content) =>
		priority === undefined
			? removeScalarProperty(content, 'Priority')
			: upsertScalarProperty(content, 'Priority', `${priority}`),
	);
}
