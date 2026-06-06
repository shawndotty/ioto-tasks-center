import type { ProjectListSortMode } from '../settings';
import type { ProjectFolderEntry } from './types';

const PROJECT_NAME_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

export function sortProjectEntries(
	projects: ProjectFolderEntry[],
	incompleteCounts: ReadonlyMap<string, number>,
	sortMode: ProjectListSortMode,
): ProjectFolderEntry[] {
	return [...projects].sort((left, right) => {
		if (
			sortMode === 'incomplete-count' ||
			sortMode === 'incomplete-count-asc'
		) {
			const difference =
				(incompleteCounts.get(right.name) ?? 0) -
				(incompleteCounts.get(left.name) ?? 0);
			const countDifference =
				sortMode === 'incomplete-count' ? difference : -difference;
			if (countDifference !== 0) {
				return countDifference;
			}
		}

		const nameDifference = PROJECT_NAME_COLLATOR.compare(
			left.name,
			right.name,
		);
		return sortMode === 'name-desc' ? -nameDifference : nameDifference;
	});
}

export function filterHiddenProjectEntries(
	projects: ProjectFolderEntry[],
	hiddenProjectNames: Iterable<string>,
): ProjectFolderEntry[] {
	const hiddenProjectNameSet = new Set(hiddenProjectNames);
	return projects.filter(
		(project) => !hiddenProjectNameSet.has(project.name),
	);
}
