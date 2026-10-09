/**
 * 项目中心视图的类型与纯函数。
 *
 * Phase 5 拆分后从 `iotoProjectCenterView.ts` 抽出：
 * - 行/状态/视图状态类型
 * - `ProjectCenterViewContext`：渲染层与动作层需要的视图上下文契约
 *   （`IOTOProjectCenterView` 结构性实现该接口，渲染/动作模块只依赖此接口）
 * - `parseViewState` / `isProjectCenterSortKey` / `isProjectCenterSortDirection`：视图状态解析
 * - `collectCategoryOptions`：合并配置项与已有分类，去重排序
 */

import type { App, WorkspaceLeaf } from 'obsidian';

import type { ProjectMetadata } from '../tasks-center/project-metadata';
import type {
	ProjectCenterSortDirection,
	ProjectCenterSortKey,
} from './project-center-sort';

export interface ProjectCenterRow {
	name: string;
	path: string;
	taskCount: number;
	archived: boolean;
	metadata: ProjectMetadata;
}

export interface IOTOProjectCenterViewState {
	sortKey?: ProjectCenterSortKey;
	sortDirection?: ProjectCenterSortDirection;
}

/**
 * 渲染层与动作层访问视图的契约。
 *
 * 读字段为 `readonly`：闭包里需要实时值的通过方法读取（如 `consumeShouldFocusProjectSearch`）。
 * `IOTOProjectCenterView` 结构性实现该接口，对外暴露 `this` 即可。
 */
export interface ProjectCenterViewContext {
	readonly app: App;
	readonly rows: ProjectCenterRow[];
	readonly status: 'idle' | 'loading' | 'root-missing';
	readonly isCompactLayout: boolean;
	readonly isProjectSearchVisible: boolean;
	readonly projectSearchInputValue: string;
	readonly projectSearchQuery: string;
	readonly sortKey: ProjectCenterSortKey;
	readonly sortDirection: ProjectCenterSortDirection;
	readonly isCreatingProject: boolean;
	readonly previewLeaf: WorkspaceLeaf | null;

	getTasksRootPath(): string;
	getProjectCategoryOptions(): string[];
	setProjectHidden(name: string, hidden: boolean): Promise<void>;
	addProjectCategoryOption(category: string): Promise<void>;

	render(): void;
	refreshFromVaultChange(): Promise<void>;

	canCreateProject(): boolean;

	handleSortClick(key: ProjectCenterSortKey): void;
	applyProjectSearchQuery(): void;
	clearProjectSearch(): void;
	toggleProjectSearch(): void;
	setProjectSearchInputValue(value: string): void;
	consumeShouldFocusProjectSearch(): boolean;

	setIsCreatingProject(value: boolean): void;
	setPreviewLeaf(leaf: WorkspaceLeaf | null): void;
}

export function parseViewState(
	state: unknown,
): IOTOProjectCenterViewState {
	if (!state || typeof state !== 'object') {
		return {};
	}

	const candidate = state as Record<string, unknown>;
	const sortKey = isProjectCenterSortKey(candidate.sortKey)
		? candidate.sortKey
		: undefined;
	const sortDirection = isProjectCenterSortDirection(
		candidate.sortDirection,
	)
		? candidate.sortDirection
		: undefined;
	return {
		sortKey,
		sortDirection,
	};
}

export function isProjectCenterSortKey(
	value: unknown,
): value is ProjectCenterSortKey {
	return (
		value === 'projectName' ||
		value === 'category' ||
		value === 'startDate' ||
		value === 'dueDate' ||
		value === 'taskCount' ||
		value === 'archived'
	);
}

export function isProjectCenterSortDirection(
	value: unknown,
): value is ProjectCenterSortDirection {
	return value === 'asc' || value === 'desc';
}

export function collectCategoryOptions(
	configured: string[],
	seenCategories: Array<string | undefined>,
): string[] {
	const set = new Set<string>();
	for (const value of configured) {
		const normalized = value.trim();
		if (normalized) {
			set.add(normalized);
		}
	}
	for (const value of seenCategories) {
		if (typeof value !== 'string') {
			continue;
		}
		const normalized = value.trim();
		if (normalized) {
			set.add(normalized);
		}
	}

	return [...set].sort((left, right) =>
		left.localeCompare(right, undefined, { numeric: true }),
	);
}
