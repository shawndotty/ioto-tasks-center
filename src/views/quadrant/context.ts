/**
 * 四象限渲染模块所需的视图上下文（[[Plan-20261115-201917]] §3.5 / §五 #3）。
 *
 * 本文件是叶子类型模块：只允许 `import type`，不产生值级边。
 */

import type { App } from 'obsidian';

import type {
	QuadrantModel,
	QuadrantProjectScope,
	QuadrantStatusKey,
} from '../../tasks-center/quadrant-data';
import type { TaskPriorityValue } from '../../tasks-center/task-priority';
import type { TaskFileEntry } from '../../tasks-center/types';
import type { QuadrantProjectOption } from './data-loader';

export interface QuadrantViewContext {
	readonly app: App;
	getModel(): QuadrantModel | null;
	getProjectOptions(): QuadrantProjectOption[];
	getStatusKeys(): ReadonlySet<QuadrantStatusKey>;
	getProjectScope(): QuadrantProjectScope;
	isSidebarOpen(): boolean;
	getShowTaskPriority(): boolean;
	getColorTaskTitleByPriority(): boolean;
	getShowProjectNameInTaskList(): boolean;
	toggleStatusKey(key: QuadrantStatusKey): void;
	setProjectScope(scope: QuadrantProjectScope): void;
	toggleSidebar(): void;
	setPriority(path: string, priority: TaskPriorityValue | undefined): void;
	openTask(path: string, mods: MouseEvent | null): void;
	openPriorityMenu(
		task: TaskFileEntry,
		event: MouseEvent,
		anchor: HTMLElement,
	): void;
	isCardBusy(path: string): boolean;
}
