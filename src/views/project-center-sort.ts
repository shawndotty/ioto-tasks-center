export type ProjectCenterSortKey =
	| 'projectName'
	| 'category'
	| 'startDate'
	| 'dueDate'
	| 'taskCount'
	| 'archived';

export type ProjectCenterSortDirection = 'asc' | 'desc';

export interface ProjectCenterSortableRow {
	name: string;
	taskCount: number;
	archived: boolean;
	metadata: {
		category?: string;
		startDate?: string;
		dueDate?: string;
		[key: string]: unknown;
	};
}

const PROJECT_NAME_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

export function sortProjectCenterRows<T extends ProjectCenterSortableRow>(
	rows: readonly T[],
	sortKey: ProjectCenterSortKey,
	sortDirection: ProjectCenterSortDirection,
): T[] {
	const multiplier = sortDirection === 'asc' ? 1 : -1;

	return [...rows].sort((left, right) => {
		const primary = compareBySortKey(left, right, sortKey) * multiplier;
		if (primary !== 0) {
			return primary;
		}

		return PROJECT_NAME_COLLATOR.compare(left.name, right.name);
	});
}

function compareBySortKey(
	left: ProjectCenterSortableRow,
	right: ProjectCenterSortableRow,
	sortKey: ProjectCenterSortKey,
): number {
	switch (sortKey) {
		case 'projectName':
			return PROJECT_NAME_COLLATOR.compare(left.name, right.name);
		case 'category':
			return PROJECT_NAME_COLLATOR.compare(
				getNormalizedString(left.metadata.category),
				getNormalizedString(right.metadata.category),
			);
		case 'startDate':
			return PROJECT_NAME_COLLATOR.compare(
				getNormalizedString(left.metadata.startDate),
				getNormalizedString(right.metadata.startDate),
			);
		case 'dueDate':
			return PROJECT_NAME_COLLATOR.compare(
				getNormalizedString(left.metadata.dueDate),
				getNormalizedString(right.metadata.dueDate),
			);
		case 'taskCount':
			return left.taskCount - right.taskCount;
		case 'archived':
			return Number(left.archived) - Number(right.archived);
	}
}

function getNormalizedString(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}
