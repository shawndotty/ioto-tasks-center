import type { ProjectListSortMode } from '../settings';
import type { ProjectFolderEntry } from './types';

const PROJECT_NAME_COLLATOR = new Intl.Collator(undefined, {
	numeric: true,
	sensitivity: 'base',
});

export function sortProjectEntries(
	projects: ProjectFolderEntry[],
	incompleteCounts: ReadonlyMap<string, number>,
	activityMtimes: ReadonlyMap<string, number>,
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

		if (sortMode === 'activity' || sortMode === 'activity-asc') {
			// 活跃度 = 项目下任务文件的 max(mtime)；无任务文件（Map 无条目）视为 0，
			// 在 `activity` 下降序排最后、`activity-asc` 下排最前。
			const difference =
				(activityMtimes.get(right.name) ?? 0) -
				(activityMtimes.get(left.name) ?? 0);
			const mtimeDifference =
				sortMode === 'activity' ? difference : -difference;
			if (mtimeDifference !== 0) {
				return mtimeDifference;
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
