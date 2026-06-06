import type { ProjectListGroupMode, ProjectListSortMode } from '../settings';
import { sortProjectEntries } from '../tasks-center/project-sort';
import type { ProjectFolderEntry } from '../tasks-center/types';

export interface ProjectListSection {
	groupKey: string;
	projects: ProjectFolderEntry[];
}

const CATEGORY_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

export function buildProjectListSections(
	projects: ProjectFolderEntry[],
	incompleteCounts: ReadonlyMap<string, number>,
	categoryByProjectName: ReadonlyMap<string, string>,
	sortMode: ProjectListSortMode,
	groupMode: ProjectListGroupMode,
): ProjectListSection[] {
	if (groupMode === 'none') {
		return [
			{
				groupKey: '',
				projects: sortProjectEntries(
					projects,
					incompleteCounts,
					sortMode,
				),
			},
		];
	}

	const groups = new Map<string, ProjectFolderEntry[]>();
	for (const project of projects) {
		const groupKey = (categoryByProjectName.get(project.name) ?? '').trim();
		const list = groups.get(groupKey);
		if (list) {
			list.push(project);
		} else {
			groups.set(groupKey, [project]);
		}
	}

	const groupEntries = [...groups.entries()].map(
		([groupKey, groupProjects]) => {
			const totalIncomplete = groupProjects.reduce(
				(sum, project) =>
					sum + (incompleteCounts.get(project.name) ?? 0),
				0,
			);
			return {
				groupKey,
				totalIncomplete,
				projects: sortProjectEntries(
					groupProjects,
					incompleteCounts,
					sortMode,
				),
			};
		},
	);

	groupEntries.sort((left, right) => {
		const leftEmpty = left.groupKey.length === 0;
		const rightEmpty = right.groupKey.length === 0;
		if (leftEmpty !== rightEmpty) {
			return leftEmpty ? 1 : -1;
		}

		const diff = right.totalIncomplete - left.totalIncomplete;
		if (diff !== 0) {
			return diff;
		}

		return CATEGORY_COLLATOR.compare(left.groupKey, right.groupKey);
	});

	return groupEntries.map(({ groupKey, projects: sectionProjects }) => ({
		groupKey,
		projects: sectionProjects,
	}));
}
