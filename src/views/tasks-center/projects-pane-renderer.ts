import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import {
	buildProjectListSections,
	collectVisibleCategoryOptions,
	PROJECT_CATEGORY_FILTER_ALL_VALUE,
	PROJECT_CATEGORY_FILTER_UNCATEGORIZED_VALUE,
	toCategoryFilterToken,
	toCategoryFilterValue,
} from '../project-list-group';
import { restoreProjectListScrollTop } from '../project-list-scroll';
import { buildProjectGroupBodyId } from './helpers';
import { t } from '../../lang/helpter';
import { setIcon } from 'obsidian';

export function renderProjectsPane(
	view: IOTOTasksCenterView,
	container: HTMLElement,
): void {
	const tasksRootPath = view.getTasksRootPath();
	const headerEl = container.createDiv({
		cls: 'ioto-tasks-center__section-header',
	});
	headerEl.createDiv({
		cls: 'ioto-tasks-center__section-title',
		text: t('view.projectsPaneTitle'),
	});
	const actionsEl = headerEl.createDiv({
		cls: 'ioto-tasks-center__section-actions',
	});
	const projectSettingsButtonEl = actionsEl.createEl('button', {
		cls: 'ioto-tasks-center__icon-button',
	});
	projectSettingsButtonEl.type = 'button';
	projectSettingsButtonEl.disabled = view.isProjectsLoading;
	projectSettingsButtonEl.ariaLabel = t('view.projectListSettings');
	projectSettingsButtonEl.title = t('view.projectListSettings');
	setIcon(projectSettingsButtonEl, 'sliders-horizontal');
	projectSettingsButtonEl.addEventListener('click', (event) => {
		view.showProjectPresentationMenu(event);
	});
	const addProjectButtonEl = actionsEl.createEl('button', {
		cls: 'ioto-tasks-center__icon-button',
		text: '+',
	});
	addProjectButtonEl.type = 'button';
	addProjectButtonEl.disabled = !view.canCreateProject();
	addProjectButtonEl.ariaLabel = view.getAddProjectButtonLabel();
	addProjectButtonEl.title = view.getAddProjectButtonLabel();
	addProjectButtonEl.addEventListener('click', () => {
		void view.handleCreateProject();
	});

	const helperText = view.isProjectsLoading
		? `正在扫描 ${tasksRootPath} 根目录...`
		: t('view.projectsPaneDesc');
	container.createDiv({
		cls: 'ioto-tasks-center__section-desc',
		text: helperText,
	});

	if (view.projects.length > 0) {
		renderProjectCategoryFilter(view, container);
	}

	const listEl = container.createDiv({
		cls: 'ioto-tasks-center__project-list',
	});
	listEl.addEventListener('scroll', () => {
		view.projectListScrollTop = listEl.scrollTop;
	});

	if (view.isProjectsLoading) {
		view.renderState(
			listEl,
			t('view.state.loadingProjectsTitle'),
			t('view.state.loadingProjectsDesc', [tasksRootPath]),
			'is-loading',
		);
		restoreProjectListScrollTop(listEl, view.projectListScrollTop);
		return;
	}

	if (view.projectResult.status === 'root-missing') {
		view.renderState(
			listEl,
			t('view.state.rootMissingTitle'),
			t('view.state.rootMissingDesc', [tasksRootPath]),
			'is-empty',
		);
		restoreProjectListScrollTop(listEl, view.projectListScrollTop);
		return;
	}

	if (view.projects.length > 0 && view.getVisibleProjects().length === 0) {
		view.renderState(
			listEl,
			t('view.projectCategoryFilter.emptyTitle'),
			t('view.projectCategoryFilter.emptyDesc'),
			'is-empty',
		);
		restoreProjectListScrollTop(listEl, view.projectListScrollTop);
		return;
	}

	if (view.projects.length === 0) {
		const isFilteredByHiddenProjects =
			view.projectResult.projects.length > 0;
		view.renderState(
			listEl,
			isFilteredByHiddenProjects
				? t('view.state.noVisibleProjectsTitle')
				: t('view.state.noProjectsTitle'),
			isFilteredByHiddenProjects
				? t('view.state.noVisibleProjectsDesc')
				: t('view.state.noProjectsDesc', [tasksRootPath]),
			'is-empty',
		);
		restoreProjectListScrollTop(listEl, view.projectListScrollTop);
		return;
	}

	const groupMode = view.getProjectListGroupMode();
	const sortMode = view.getProjectListSortMode();
	// view.projects 在 loadProjects / 定向刷新时已按 sortMode 排好，过滤保持相对顺序。
	const sections = buildProjectListSections(
		view.getVisibleProjects(),
		view.projectIncompleteCounts,
		view.projectCategoryByName,
		sortMode,
		groupMode,
		{ preSorted: true },
	);
	view.syncCollapsedProjectGroups(sections);

	for (const section of sections) {
		const groupKey = section.groupKey;
		const groupLabel =
			groupKey.length > 0
				? groupKey
				: t('project.group.uncategorized');
		const groupEl = listEl.createDiv({
			cls: 'ioto-tasks-center__project-group',
		});

		const collapsed =
			groupMode === 'category' &&
			view.isProjectGroupCollapsed(groupKey);
		groupEl.toggleClass('is-collapsed', collapsed);
		groupEl.toggleClass('is-expanded', !collapsed);

		const groupBodyId = buildProjectGroupBodyId(groupKey);
		let groupBodyEl: HTMLElement;
		if (groupMode === 'category') {
			const groupHeaderEl = groupEl.createEl('button', {
				cls: 'ioto-tasks-center__project-group-header',
			});
			groupHeaderEl.type = 'button';
			groupHeaderEl.ariaLabel = collapsed
				? t('view.group.expand', [groupLabel])
				: t('view.group.collapse', [groupLabel]);
			groupHeaderEl.title = groupHeaderEl.ariaLabel;
			groupHeaderEl.setAttribute(
				'aria-expanded',
				collapsed ? 'false' : 'true',
			);
			groupHeaderEl.setAttribute('aria-controls', groupBodyId);

			const iconEl = groupHeaderEl.createSpan({
				cls: 'ioto-tasks-center__project-group-header-icon',
			});
			setIcon(iconEl, 'chevron-right');
			groupHeaderEl.createSpan({
				cls: 'ioto-tasks-center__project-group-header-label',
				text: groupLabel,
			});
			groupHeaderEl.createSpan({
				cls: 'ioto-tasks-center__project-group-header-count',
				text: `${section.projects.length}`,
			});
			groupHeaderEl.addEventListener('click', () => {
				view.toggleProjectGroupCollapsed(groupKey);
			});

			groupBodyEl = groupEl.createDiv({
				cls: 'ioto-tasks-center__project-group-body',
			});
			groupBodyEl.id = groupBodyId;
			groupBodyEl.toggleClass('is-hidden', collapsed);
			if (collapsed) {
				continue;
			}
		} else {
			groupBodyEl = groupEl.createDiv({
				cls: 'ioto-tasks-center__project-group-body',
			});
		}

		for (const project of section.projects) {
			const incompleteCount =
				view.projectIncompleteCounts.get(project.name) ?? 0;
			const itemEl = groupBodyEl.createEl('button', {
				cls: 'ioto-tasks-center__project-item',
			});
			itemEl.type = 'button';
			itemEl.createSpan({
				cls: 'ioto-tasks-center__project-name',
				text: project.name,
			});
			if (incompleteCount > 0) {
				const countEl = itemEl.createEl('button', {
					cls: 'ioto-tasks-center__project-count',
				});
				countEl.type = 'button';
				countEl.textContent = `${incompleteCount}`;
				countEl.ariaLabel = t('view.incompleteCount');
				countEl.addEventListener('click', (event: MouseEvent) => {
					event.preventDefault();
					event.stopPropagation();

					const switchToIncompleteTab = (): void => {
						const canSwitchTab = view
							.getVisibleTaskFilterTabs()
							.some((tab) => tab.key === 'incomplete');
						if (
							canSwitchTab &&
							view.activeTaskFilterTab !== 'incomplete'
						) {
							view.activeTaskFilterTab = 'incomplete';
							view.render();
						}
					};

					if (
						project.name === view.selectedProject ||
						view.isTasksLoading
					) {
						switchToIncompleteTab();
						return;
					}

					void view.selectProject(project.name).then(
						switchToIncompleteTab,
					);
				});
			}

			if (project.name === view.selectedProject) {
				itemEl.addClass('is-selected');
			}

			itemEl.addEventListener('click', () => {
				if (
					project.name === view.selectedProject ||
					view.isTasksLoading
				) {
					return;
				}

				void view.selectProject(project.name);
			});
			itemEl.addEventListener('contextmenu', (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				view.showProjectContextMenu(event, project);
			});
		}
	}

	restoreProjectListScrollTop(listEl, view.projectListScrollTop);
}

/**
 * 宽屏分类下拉：首项「全部分类」→ 各可见分类 → 末尾「未分类」。
 * 候选项从全量 `view.projects`（已排除隐藏项目）派生，避免「选了却空白」的死选项。
 */
function renderProjectCategoryFilter(
	view: IOTOTasksCenterView,
	container: HTMLElement,
): void {
	const label = t('view.projectCategoryFilter.label');

	const rowEl = container.createDiv({
		cls: 'ioto-tasks-center__project-category-filter-row',
	});
	const iconEl = rowEl.createSpan({
		cls: 'ioto-tasks-center__project-category-filter-icon',
	});
	setIcon(iconEl, 'filter');
	rowEl.createSpan({
		cls: 'ioto-tasks-center__project-category-filter-label',
		text: t('view.projectCategoryFilter.labelShort'),
	});

	const selectEl = rowEl.createEl('select', {
		cls: 'ioto-tasks-center__project-category-filter',
	});
	selectEl.ariaLabel = label;
	selectEl.title = label;

	const addOption = (value: string, optionLabel: string): void => {
		const optionEl = selectEl.createEl('option', { text: optionLabel });
		optionEl.value = value;
	};

	addOption(
		PROJECT_CATEGORY_FILTER_ALL_VALUE,
		t('view.projectCategoryFilter.all'),
	);
	for (const category of collectVisibleCategoryOptions(
		view.projects,
		view.projectCategoryByName,
	)) {
		addOption(category, category);
	}
	addOption(
		PROJECT_CATEGORY_FILTER_UNCATEGORIZED_VALUE,
		t('project.group.uncategorized'),
	);

	selectEl.value = toCategoryFilterToken(view.projectCategoryFilter);
	selectEl.addEventListener('change', () => {
		void view.setProjectCategoryFilter(
			toCategoryFilterValue(selectEl.value),
		);
	});
}
