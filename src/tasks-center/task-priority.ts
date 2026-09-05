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

export async function setTaskFilePriority(
	app: App,
	file: TFile,
	priority: TaskPriorityValue,
): Promise<void> {
	await updateTaskFilePriority(app, file, priority);
}

export async function clearTaskFilePriority(
	app: App,
	file: TFile,
): Promise<void> {
	await updateTaskFilePriority(app, file);
}

async function updateTaskFilePriority(
	app: App,
	file: TFile,
	priority?: TaskPriorityValue,
): Promise<void> {
	await rewriteTaskFrontmatter(app, file, (content) =>
		priority === undefined
			? removeScalarProperty(content, 'Priority')
			: upsertScalarProperty(content, 'Priority', `${priority}`),
	);
}
