import type { TaskFileEntry } from '../tasks-center/types';

export function buildVisibleTaskHierarchy(
	tasks: TaskFileEntry[],
): TaskFileEntry[] {
	const taskByPath = new Map(tasks.map((task) => [task.path, task] as const));
	const firstTaskPathByTitle = new Map<string, string>();
	for (const task of tasks) {
		if (!firstTaskPathByTitle.has(task.title)) {
			firstTaskPathByTitle.set(task.title, task.path);
		}
	}

	const parentPathByTaskPath = new Map<string, string>();
	for (const task of tasks) {
		const parentPath = resolveParentPath(task, firstTaskPathByTitle);
		if (parentPath && parentPath !== task.path && taskByPath.has(parentPath)) {
			parentPathByTaskPath.set(task.path, parentPath);
		}
	}

	const childTasksByParentPath = new Map<string, TaskFileEntry[]>();
	for (const task of tasks) {
		const parentPath = parentPathByTaskPath.get(task.path);
		if (!parentPath) {
			continue;
		}

		const childTasks = childTasksByParentPath.get(parentPath) ?? [];
		childTasks.push(task);
		childTasksByParentPath.set(parentPath, childTasks);
	}

	const visitedTaskPaths = new Set<string>();
	const orderedTasks: TaskFileEntry[] = [];

	const appendTask = (
		task: TaskFileEntry,
		indentLevel: number,
		activePathSet: Set<string>,
	): void => {
		if (visitedTaskPaths.has(task.path)) {
			return;
		}

		visitedTaskPaths.add(task.path);
		const nextPathSet = new Set(activePathSet);
		nextPathSet.add(task.path);
		orderedTasks.push({
			...task,
			indentLevel,
		});

		const childTasks = childTasksByParentPath.get(task.path) ?? [];
		for (const childTask of childTasks) {
			if (nextPathSet.has(childTask.path)) {
				continue;
			}

			appendTask(childTask, indentLevel + 1, nextPathSet);
		}
	};

	for (const task of tasks) {
		if (!parentPathByTaskPath.has(task.path)) {
			appendTask(task, 0, new Set());
		}
	}

	for (const task of tasks) {
		if (!visitedTaskPaths.has(task.path)) {
			appendTask(task, 0, new Set());
		}
	}

	return orderedTasks;
}

function resolveParentPath(
	task: TaskFileEntry,
	firstTaskPathByTitle: ReadonlyMap<string, string>,
): string | null {
	for (const upTaskTitle of task.upTaskTitles) {
		const parentPath = firstTaskPathByTitle.get(upTaskTitle);
		if (parentPath && parentPath !== task.path) {
			return parentPath;
		}
	}

	return null;
}
