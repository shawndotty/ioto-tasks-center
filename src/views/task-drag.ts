import type { TaskFileEntry } from '../tasks-center/types';

export type TaskDropValidationResult =
	| { valid: true }
	| { valid: false; reason: 'self' | 'descendant' | 'missing' };

export function validateTaskParentDrop(
	tasks: TaskFileEntry[],
	draggedTaskPath: string,
	targetTaskPath: string,
): TaskDropValidationResult {
	if (draggedTaskPath === targetTaskPath) {
		return { valid: false, reason: 'self' };
	}

	const taskByPath = new Map(tasks.map((task) => [task.path, task] as const));
	const draggedTask = taskByPath.get(draggedTaskPath);
	const targetTask = taskByPath.get(targetTaskPath);
	if (!draggedTask || !targetTask) {
		return { valid: false, reason: 'missing' };
	}

	const parentPathByTaskPath = buildParentPathByTaskPath(tasks);
	let currentParentPath = parentPathByTaskPath.get(targetTaskPath) ?? null;
	while (currentParentPath) {
		if (currentParentPath === draggedTaskPath) {
			return { valid: false, reason: 'descendant' };
		}

		currentParentPath = parentPathByTaskPath.get(currentParentPath) ?? null;
	}

	return { valid: true };
}

function buildParentPathByTaskPath(
	tasks: TaskFileEntry[],
): Map<string, string> {
	const taskByPath = new Map(tasks.map((task) => [task.path, task] as const));
	const firstTaskPathByTitle = new Map<string, string>();
	for (const task of tasks) {
		if (!firstTaskPathByTitle.has(task.title)) {
			firstTaskPathByTitle.set(task.title, task.path);
		}
	}

	const parentPathByTaskPath = new Map<string, string>();
	for (const task of tasks) {
		for (const upTaskTitle of task.upTaskTitles) {
			const parentPath = firstTaskPathByTitle.get(upTaskTitle);
			if (
				parentPath &&
				parentPath !== task.path &&
				taskByPath.has(parentPath)
			) {
				parentPathByTaskPath.set(task.path, parentPath);
				break;
			}
		}
	}

	return parentPathByTaskPath;
}
