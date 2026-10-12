import { Menu, Platform, setIcon } from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { collectVisibleCategoryOptions } from '../project-list-group';
import { t } from '../../lang/helpter';
import {
	COMPACT_LAYOUT_BREAKPOINT,
	NARROW_LAYOUT_BREAKPOINT,
	HEADER_TOGGLE_BUTTON_SELECTOR,
	TASK_LIST_DESC_SELECTOR,
	TASK_SEARCH_ROW_SELECTOR,
} from './constants';

/**
 * 移动端判定：手机端宽度必然 ≤ 720，与既有 `isCompactLayout` 一致；
 * 桌面把面板拖窄时同样缺空间，一起生效更符合"省空间"的初衷。
 */
export function isMobileTaskListLayout(view: IOTOTasksCenterView): boolean {
	return Platform.isMobile || view.isCompactLayout;
}

export function toggleTaskListHeaderExpanded(view: IOTOTasksCenterView): void {
	view.isTaskListHeaderExpanded = !view.isTaskListHeaderExpanded;
	view.applyTaskListHeaderCollapsed();
	view.app.workspace.requestSaveLayout();
}

/**
 * 只切换现有 DOM 的 class 与图标，不触发 `render()`，
 * 避免滚动位置跳动与搜索框失焦。
 */
export function applyTaskListHeaderCollapsed(view: IOTOTasksCenterView): void {
	// `modal` 搜索模式下没有搜索行，也不渲染开关，此时描述保持可见。
	const collapsed =
		view.isMobileTaskListLayout()
		&& view.isTaskSearchInline()
		&& !view.isTaskListHeaderExpanded;
	view.contentEl
		.querySelector<HTMLElement>(TASK_LIST_DESC_SELECTOR)
		?.toggleClass('is-hidden', collapsed);
	view.contentEl
		.querySelector<HTMLElement>(TASK_SEARCH_ROW_SELECTOR)
		?.toggleClass('is-hidden', collapsed);

	const toggleEl = view.contentEl.querySelector<HTMLElement>(
		HEADER_TOGGLE_BUTTON_SELECTOR,
	);
	if (!toggleEl) {
		return;
	}

	setIcon(toggleEl, collapsed ? 'eye-off' : 'eye');
	const label = collapsed
		? t('view.tasksPane.showHeaderExtras')
		: t('view.tasksPane.hideHeaderExtras');
	toggleEl.ariaLabel = label;
	toggleEl.title = label;
}

export function canSwitchProjects(view: IOTOTasksCenterView): boolean {
	return (
		!view.isProjectsLoading &&
		!view.isTasksLoading &&
		view.getVisibleProjects().length > 0
	);
}

export function renderCompactProjectSwitcher(
	view: IOTOTasksCenterView,
	container: HTMLElement,
): void {
	const toolbarEl = container.createDiv({
		cls: 'ioto-tasks-center__compact-toolbar',
	});

	renderCompactCategoryFilterButton(view, toolbarEl);

	const buttonLabel = getProjectSwitcherLabel(view);
	const projectSwitcherEl = toolbarEl.createEl('button', {
		cls: 'ioto-tasks-center__project-switcher',
		text: buttonLabel,
	});
	projectSwitcherEl.type = 'button';
	projectSwitcherEl.disabled = !view.canSwitchProjects();
	projectSwitcherEl.ariaLabel = buttonLabel;
	projectSwitcherEl.title = buttonLabel;
	projectSwitcherEl.addEventListener('click', (event: MouseEvent) => {
		void showProjectSwitcherMenu(view, event);
	});
}

/**
 * 窄屏分类筛选入口：图标按钮 + `Menu`（当前项打勾），在「项目切换」按钮左侧。
 *
 * 与项目切换不同，它的可用性只看「项目集是否非空 / 是否在加载」——若复用
 * `canSwitchProjects()`（依赖可见集合），一旦筛到空分类就再也点不开、无法切回。
 */
function renderCompactCategoryFilterButton(
	view: IOTOTasksCenterView,
	toolbarEl: HTMLElement,
): void {
	const label = t('view.projectCategoryFilter.label');
	const filterButtonEl = toolbarEl.createEl('button', {
		cls: 'ioto-tasks-center__icon-button',
	});
	filterButtonEl.type = 'button';
	filterButtonEl.disabled =
		view.isProjectsLoading || view.projects.length === 0;
	filterButtonEl.ariaLabel = label;
	filterButtonEl.title = label;
	setIcon(filterButtonEl, 'filter');
	filterButtonEl.addEventListener('click', (event: MouseEvent) => {
		void showProjectCategoryFilterMenu(view, event);
	});
}

export function startResizeObserver(view: IOTOTasksCenterView): void {
	if (view.resizeObserver || typeof ResizeObserver === 'undefined') {
		syncCompactLayout(view, view.contentEl.clientWidth);
		return;
	}

	view.resizeObserver = new ResizeObserver((entries) => {
		const entry = entries[0];
		syncCompactLayout(
			view,
			entry?.contentRect.width ?? view.contentEl.clientWidth,
		);
	});
	view.resizeObserver.observe(view.contentEl);
	syncCompactLayout(view, view.contentEl.clientWidth);
}

export function stopResizeObserver(view: IOTOTasksCenterView): void {
	view.resizeObserver?.disconnect();
	view.resizeObserver = null;
}

function getProjectSwitcherLabel(view: IOTOTasksCenterView): string {
	if (view.isProjectsLoading) {
		return t('view.projectSwitcher.loadingProjects');
	}

	if (view.isTasksLoading) {
		return t('view.projectSwitcher.loadingTasks');
	}

	if (!view.selectedProject) {
		return t('view.projectSwitcher.default');
	}

	return t('view.projectSwitcher.current', [view.selectedProject]);
}

async function showProjectSwitcherMenu(
	view: IOTOTasksCenterView,
	event: MouseEvent,
): Promise<void> {
	if (!view.canSwitchProjects()) {
		return;
	}

	const menu = new Menu();
	for (const project of view.getVisibleProjects()) {
		const isCurrentProject = project.name === view.selectedProject;
		menu.addItem((item) =>
			item
				.setTitle(
					isCurrentProject
						? t('view.projectSwitcher.currentSuffix', [
								project.name,
							])
						: project.name,
				)
				.onClick(() => {
					if (isCurrentProject) {
						return;
					}

					void view.selectProject(project.name);
				}),
		);
	}

	menu.showAtMouseEvent(event);
}

async function showProjectCategoryFilterMenu(
	view: IOTOTasksCenterView,
	event: MouseEvent,
): Promise<void> {
	const menu = new Menu();
	const addItem = (title: string, value: string | null): void => {
		menu.addItem((item) =>
			item
				.setTitle(title)
				.setChecked(view.projectCategoryFilter === value)
				.onClick(() => {
					void view.setProjectCategoryFilter(value);
				}),
		);
	};

	addItem(t('view.projectCategoryFilter.all'), null);
	for (const category of collectVisibleCategoryOptions(
		view.projects,
		view.projectCategoryByName,
	)) {
		addItem(category, category);
	}
	addItem(t('project.group.uncategorized'), '');

	menu.showAtMouseEvent(event);
}

function syncCompactLayout(view: IOTOTasksCenterView, width: number): void {
	if (width <= 0) {
		return;
	}

	const nextCompactLayout = width <= COMPACT_LAYOUT_BREAKPOINT;
	const nextNarrowLayout = width < NARROW_LAYOUT_BREAKPOINT;
	if (
		view.isCompactLayout === nextCompactLayout &&
		view.isNarrowLayout === nextNarrowLayout
	) {
		return;
	}

	view.isCompactLayout = nextCompactLayout;
	view.isNarrowLayout = nextNarrowLayout;
	if (view.contentEl.isConnected) {
		view.render();
	}
}
