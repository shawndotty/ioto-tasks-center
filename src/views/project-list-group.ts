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

/**
 * `<select>` 的 DOM 无法表达 `null`（全部分类）且 `''` 会和「未分类」冲突，
 * 故给「全部分类」「未分类」各留一个哨兵 value；真实分类名直接作 value。
 */
export const PROJECT_CATEGORY_FILTER_ALL_VALUE = '__ioto_all__';
export const PROJECT_CATEGORY_FILTER_UNCATEGORIZED_VALUE =
	'__ioto_uncategorized__';

/** `<select>` value（token）→ 过滤值：`null` = 全部分类，`''` = 未分类。 */
export function toCategoryFilterValue(token: string): string | null {
	if (token === PROJECT_CATEGORY_FILTER_ALL_VALUE) {
		return null;
	}

	if (token === PROJECT_CATEGORY_FILTER_UNCATEGORIZED_VALUE) {
		return '';
	}

	return token;
}

/** 过滤值 → `<select>` value（token）；与 `toCategoryFilterValue` 互逆。 */
export function toCategoryFilterToken(filter: string | null): string {
	if (filter === null) {
		return PROJECT_CATEGORY_FILTER_ALL_VALUE;
	}

	if (filter === '') {
		return PROJECT_CATEGORY_FILTER_UNCATEGORIZED_VALUE;
	}

	return filter;
}

/**
 * 按分类过滤项目。
 *
 * `selected === null` → 全部分类（原样返回同一批）；`''` → 未分类。
 * 判定口径与 `buildProjectListSections` 完全一致（同一 `.trim()`），
 * 保证「分组 = 按分类」与「筛选」对同一项目的分类归属不会打架。
 */
export function filterProjectsByCategory(
	projects: ProjectFolderEntry[],
	categoryByProjectName: ReadonlyMap<string, string>,
	selected: string | null,
): ProjectFolderEntry[] {
	if (selected === null) {
		return projects;
	}

	return projects.filter(
		(p) => (categoryByProjectName.get(p.name) ?? '').trim() === selected,
	);
}

/**
 * 从可见项目派生候选分类：去空、去重、按 `CATEGORY_COLLATOR` 排序。
 *
 * 只列「实际有项目的分类」，避免出现「选了却空白」的死选项。
 */
export function collectVisibleCategoryOptions(
	projects: ProjectFolderEntry[],
	categoryByProjectName: ReadonlyMap<string, string>,
): string[] {
	const seen = new Set<string>();
	for (const project of projects) {
		const category = (categoryByProjectName.get(project.name) ?? '').trim();
		if (category.length > 0) {
			seen.add(category);
		}
	}

	return [...seen].sort((left, right) =>
		CATEGORY_COLLATOR.compare(left, right),
	);
}

export interface BuildProjectListSectionsOptions {
	/**
	 * 传入的 `projects` 是否已按 `sortMode` 排好序。
	 * `loadProjects` 里已经排过一次，渲染时传 true 可以省掉一次重复排序。
	 */
	preSorted?: boolean;
}

export function buildProjectListSections(
	projects: ProjectFolderEntry[],
	incompleteCounts: ReadonlyMap<string, number>,
	activityMtimes: ReadonlyMap<string, number>,
	categoryByProjectName: ReadonlyMap<string, string>,
	sortMode: ProjectListSortMode,
	groupMode: ProjectListGroupMode,
	options: BuildProjectListSectionsOptions = {},
): ProjectListSection[] {
	if (groupMode === 'none') {
		return [
			{
				groupKey: '',
				projects:
					options.preSorted === true
						? projects
						: sortProjectEntries(
								projects,
								incompleteCounts,
								activityMtimes,
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
					activityMtimes,
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
