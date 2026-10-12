/**
 * 分类集合的纯函数变换（[[Plan-20261012-092334]] 步骤 1）。
 *
 * 放在中立层 `tasks-center/` 而非 `views/`，让 settings 层与 views 层都能引用，
 * 不产生 `settings → views` 的反向依赖。排序谓词与
 * `addProjectCategoryOption`（settings-updaters-extended.ts）、
 * `collectCategoryOptions`（project-center-types.ts）逐字一致，保证三处排序不打架。
 */

export interface ProjectCategoryAssignment {
	name: string;
	category?: string;
}

/** 改名后的设置列表：删旧名、加新名、去重排序；无效或 no-op 返回 null。 */
export function planCategoryRename(
	configured: string[],
	oldName: string,
	newName: string,
): string[] | null {
	const oldValue = oldName.trim();
	const nextValue = newName.trim();
	if (!nextValue || nextValue === oldValue) {
		return null; // 空名 / 同名 → 调用方 no-op
	}
	const set = new Set(configured.map((v) => v.trim()).filter(Boolean));
	set.delete(oldValue);
	set.add(nextValue);
	return [...set].sort((l, r) => l.localeCompare(r, undefined, { numeric: true }));
}

/** 删除某分类后的设置列表（不存在的名字 → 原样返回）。 */
export function planCategoryRemoval(
	configured: string[],
	name: string,
): string[] {
	const target = name.trim();
	const set = new Set(configured.map((v) => v.trim()).filter(Boolean));
	set.delete(target);
	return [...set].sort((l, r) => l.localeCompare(r, undefined, { numeric: true }));
}

/** 命中判定：`category === trim(category)` 的项目名；传 `''` 即「未分类」计数。 */
export function selectProjectsInCategory(
	rows: readonly ProjectCategoryAssignment[],
	category: string,
): string[] {
	const target = category.trim();
	return rows
		.filter((row) => (row.category ?? '').trim() === target)
		.map((row) => row.name);
}
