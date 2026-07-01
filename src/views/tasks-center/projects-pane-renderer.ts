import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { buildProjectListSections } from '../project-list-group';
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
	const sections = buildProjectListSections(
		view.projects,
		view.projectIncompleteCounts,
		view.projectCategoryByName,
		sortMode,
		groupMode,
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
						if (view.activeTaskFilterTab !== 'incomplete') {
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
