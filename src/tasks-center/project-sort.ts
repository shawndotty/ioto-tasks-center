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
		if (sortMode === 'incomplete-count') {
			const countDifference =
				(incompleteCounts.get(right.name) ?? 0) -
				(incompleteCounts.get(left.name) ?? 0);
			if (countDifference !== 0) {
				return countDifference;
			}
		}

		return PROJECT_NAME_COLLATOR.compare(left.name, right.name);
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
