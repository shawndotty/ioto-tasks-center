import {
	TASK_TEMPLATE_TASK_TYPES,
	type TaskCreationType,
} from './task-template-config';

export const ENABLED_TASK_CREATION_TYPE_ORDER: TaskCreationType[] = [
	'normal',
	'date',
	'topic',
	'plan',
];

export function normalizeEnabledTaskCreationTypes(
	value: unknown,
): TaskCreationType[] {
	const enabledSet = new Set<TaskCreationType>();
	if (Array.isArray(value)) {
		for (const item of value) {
			if (
				typeof item === 'string' &&
				(TASK_TEMPLATE_TASK_TYPES as readonly string[]).includes(item)
			) {
				enabledSet.add(item as TaskCreationType);
			}
		}
	}

	const normalized =
		enabledSet.size > 0
			? [...enabledSet]
			: [...ENABLED_TASK_CREATION_TYPE_ORDER];
	normalized.sort(
		(left, right) =>
			ENABLED_TASK_CREATION_TYPE_ORDER.indexOf(left) -
			ENABLED_TASK_CREATION_TYPE_ORDER.indexOf(right),
	);
	return normalized;
}
