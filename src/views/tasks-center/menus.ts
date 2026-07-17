import { Menu, Notice } from 'obsidian';

import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { t } from '../../lang/helpter';
import type {
	ProjectFolderEntry,
	TaskFileEntry,
} from '../../tasks-center/types';

import { TASK_PRIORITY_VALUES } from '../../tasks-center/task-priority';
import type { TaskCreationType } from '../../tasks-center/task-template-config';
import type { TaskListTimeFilter } from '../../settings';
import { TaskNameModal } from '../../ui/taskNameModal';
import { batchAssignUpTask, batchSetPriority } from './batch-edit-operations';
import {
	getProjectListGroupModeOptions,
	getProjectListSortModeOptions,
	getTaskListGroupModeOptions,
	getTaskListSortModeOptions,
} from '../../settings';
import {
	PROJECT_LIST_GROUP_MODE_ORDER,
	PROJECT_LIST_SORT_MODE_ORDER,
	TASK_LIST_GROUP_MODE_ORDER,
	TASK_LIST_SORT_MODE_ORDER,
} from './constants';
import {
	getTaskCreationOptions,
	getTaskPriorityVisibilityOptions,
	formatPriorityMenuTitle,
	formatMenuOptionTitle,
} from './helpers';

export function showProjectContextMenu(
	view: IOTOTasksCenterView,
	event: MouseEvent,
	project: ProjectFolderEntry,
): void {
	const menu = new Menu();
	const isArchived = view.getHiddenProjectNames().includes(project.name);
	const batchConfig = view.getBatchTemplateConfig();
	const canBatchCreate =
		batchConfig.enabled && batchConfig.templates.length > 0;

	menu.addItem((item) =>
		item.setTitle(t('view.projectMenu.editSpec')).onClick(() => {
			void view.openProjectSpecByProject(project);
		}),
	);

	menu.addItem((item) =>
		item
			.setTitle(
				isArchived
					? t('view.projectMenu.unarchive')
					: t('view.projectMenu.archive'),
			)
			.onClick(() => {
				void view.setProjectHidden(project.name, !isArchived);
			}),
	);

	if (canBatchCreate) {
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t('view.projectMenu.batchCreateTasks'))
				.onClick(() => {
					void view
						.selectProject(project.name)
						.then(() => view.triggerBatchCreateFromTemplate());
				}),
		);
	}

	menu.showAtMouseEvent(event);
}

export function showProjectPresentationMenu(
	view: IOTOTasksCenterView,
	event: MouseEvent,
): void {
	const projectListSortModeOptions = getProjectListSortModeOptions();
	const projectListGroupModeOptions = getProjectListGroupModeOptions();
	const menu = new Menu();
	const currentSortMode = view.getProjectListSortMode();
	const currentGroupMode = view.getProjectListGroupMode();

	for (const sortMode of PROJECT_LIST_SORT_MODE_ORDER) {
		const label = projectListSortModeOptions[sortMode];
		menu.addItem((item) =>
			item
				.setTitle(
					formatMenuOptionTitle(
						t('menu.category.sort'),
						label,
						sortMode === currentSortMode,
					),
				)
				.onClick(() => {
					void view
						.updateProjectListSortMode(sortMode)
						.catch((error: unknown) => {
							const message =
								error instanceof Error
									? error.message
									: t('view.notice.updateProjectSortFailed');
							new Notice(message);
						});
				}),
		);
	}

	menu.addSeparator();

	for (const groupMode of PROJECT_LIST_GROUP_MODE_ORDER) {
		const label = projectListGroupModeOptions[groupMode];
		menu.addItem((item) =>
			item
				.setTitle(
					formatMenuOptionTitle(
						t('menu.category.group'),
						label,
						groupMode === currentGroupMode,
					),
				)
				.onClick(() => {
					void view
						.updateProjectListGroupMode(groupMode)
						.catch((error: unknown) => {
							const message =
								error instanceof Error
									? error.message
									: t('view.notice.updateProjectGroupFailed');
							new Notice(message);
						});
				}),
		);
	}

	menu.showAtMouseEvent(event);
}

export function showTaskPresentationMenu(
	view: IOTOTasksCenterView,
	event: MouseEvent,
): void {
	const taskListSortModeOptions = getTaskListSortModeOptions();
	const taskListGroupModeOptions = getTaskListGroupModeOptions();
	const menu = new Menu();
	const currentSortMode = view.getTaskListSortMode();
	const currentGroupMode = view.getTaskListGroupMode();
	const currentShowTaskPriority = view.getShowTaskPriority();

	for (const sortMode of TASK_LIST_SORT_MODE_ORDER) {
		const label = taskListSortModeOptions[sortMode];
		menu.addItem((item) =>
			item
				.setTitle(
					formatMenuOptionTitle(
						t('menu.category.sort'),
						label,
						sortMode === currentSortMode,
					),
				)
				.onClick(() => {
					void view
						.updateTaskListSortMode(sortMode)
						.catch((error: unknown) => {
							const message =
								error instanceof Error
									? error.message
									: t('view.notice.updateTaskSortFailed');
							new Notice(message);
						});
				}),
		);
	}

	menu.addSeparator();

	for (const groupMode of TASK_LIST_GROUP_MODE_ORDER) {
		const label = taskListGroupModeOptions[groupMode];
		menu.addItem((item) =>
			item
				.setTitle(
					formatMenuOptionTitle(
						t('menu.category.group'),
						label,
						groupMode === currentGroupMode,
					),
				)
				.onClick(() => {
					void view
						.updateTaskListGroupMode(groupMode)
						.catch((error: unknown) => {
							const message =
								error instanceof Error
									? error.message
									: t('view.notice.updateTaskGroupFailed');
							new Notice(message);
						});
				}),
		);
	}

	menu.addSeparator();
	for (const visibilityOption of getTaskPriorityVisibilityOptions()) {
		menu.addItem((item) =>
			item
				.setTitle(
					formatMenuOptionTitle(
						t('menu.category.priority'),
						visibilityOption.label,
						visibilityOption.show === currentShowTaskPriority,
					),
				)
				.onClick(() => {
					void view
						.updateShowTaskPriority(visibilityOption.show)
						.catch((error: unknown) => {
							const message =
								error instanceof Error
									? error.message
									: t(
											'view.notice.updateTaskPriorityDisplayFailed',
										);
							new Notice(message);
						});
				}),
		);
	}

	menu.addSeparator();

	const currentTimeFilter = view.getTaskListTimeFilter();
	const filterOptions: Array<{
		key: TaskListTimeFilter;
		label: string;
	}> = [
		{ key: 'none', label: t('menu.filter.none') },
		{ key: 'created-week', label: t('menu.filter.createdWeek') },
		{ key: 'created-two-weeks', label: t('menu.filter.createdTwoWeeks') },
		{ key: 'created-month', label: t('menu.filter.createdMonth') },
		{
			key: 'created-calendar-week',
			label: t('menu.filter.createdCalendarWeek'),
		},
		{
			key: 'created-calendar-month',
			label: t('menu.filter.createdCalendarMonth'),
		},
		{ key: 'updated-week', label: t('menu.filter.updatedWeek') },
		{ key: 'updated-two-weeks', label: t('menu.filter.updatedTwoWeeks') },
		{ key: 'updated-month', label: t('menu.filter.updatedMonth') },
		{
			key: 'updated-calendar-week',
			label: t('menu.filter.updatedCalendarWeek'),
		},
		{
			key: 'updated-calendar-month',
			label: t('menu.filter.updatedCalendarMonth'),
		},
	];

	for (const option of filterOptions) {
		menu.addItem((item) =>
			item
				.setTitle(
					formatMenuOptionTitle(
						t('menu.category.filter'),
						option.label,
						option.key === currentTimeFilter,
					),
				)
				.onClick(() => {
					void view
						.updateTaskListTimeFilter(option.key)
						.catch((error: unknown) => {
							const message =
								error instanceof Error
									? error.message
									: t('view.notice.updateTimeFilterFailed');
							new Notice(message);
						});
				}),
		);
	}

	menu.showAtMouseEvent(event);
}

export function showTaskPriorityMenu(
	view: IOTOTasksCenterView,
	event: MouseEvent,
	task: TaskFileEntry,
): void {
	const menu = new Menu();
	const enabledTypes = view.getEnabledTaskCreationTypes();
	const normalizedEnabledTypes =
		enabledTypes.length > 0
			? enabledTypes
			: getTaskCreationOptions().map((option) => option.key);

	menu.addItem((item) =>
		item
			.setTitle(
				task.starred
					? t('view.taskCoreMenu.clear')
					: t('view.taskCoreMenu.set'),
			)
			.onClick(() => {
				if (task.starred) {
					void view.clearTaskStarred(task);
					return;
				}

				void view.updateTaskStarred(task);
			}),
	);
	menu.addSeparator();

	menu.addItem((item) => {
		item.setTitle(t('view.taskMenu.addSubtask'));

		if (normalizedEnabledTypes.length === 1) {
			const onlyType = normalizedEnabledTypes[0];
			if (!onlyType) {
				return;
			}
			item.onClick(() => {
				void view.handleCreateSubtask(task, onlyType);
			});
			return;
		}

		if (typeof item.setSubmenu !== 'function') {
			item.onClick(() => {
				view.showTaskSubtaskTypeMenu(
					event,
					task,
					normalizedEnabledTypes,
				);
			});
			return;
		}

		try {
			const subMenu = item.setSubmenu();
			const menuOptions = getTaskCreationOptions().filter((option) =>
				normalizedEnabledTypes.includes(option.key),
			);
			const resolvedMenuOptions =
				menuOptions.length > 0 ? menuOptions : getTaskCreationOptions();
			for (const option of resolvedMenuOptions) {
				subMenu.addItem((subItem) =>
					subItem.setTitle(option.label).onClick(() => {
						void view.handleCreateSubtask(task, option.key);
					}),
				);
			}
		} catch {
			item.onClick(() => {
				view.showTaskSubtaskTypeMenu(
					event,
					task,
					normalizedEnabledTypes,
				);
			});
		}
	});
	menu.addSeparator();

	if (typeof task.priority === 'number') {
		menu.addItem((item) =>
			item.setTitle(t('view.taskPriorityMenu.clear')).onClick(() => {
				void view.clearTaskPriority(task);
			}),
		);
		menu.addSeparator();
	}

	for (const priority of TASK_PRIORITY_VALUES) {
		menu.addItem((item) =>
			item
				.setTitle(
					formatPriorityMenuTitle(
						priority,
						task.priority === priority,
					),
				)
				.onClick(() => {
					void view.updateTaskPriority(task, priority);
				}),
		);
	}

	menu.addSeparator();
	menu.addItem((item) =>
		item.setTitle(t('view.taskMenu.delete')).onClick(() => {
			void view.confirmAndDeleteTask(task);
		}),
	);

	menu.showAtMouseEvent(event);
}

export function showTaskSubtaskTypeMenu(
	view: IOTOTasksCenterView,
	event: MouseEvent,
	parentTask: TaskFileEntry,
	enabledTypes: TaskCreationType[],
): void {
	const menu = new Menu();
	const menuOptions = getTaskCreationOptions().filter((option) =>
		enabledTypes.includes(option.key),
	);
	const resolvedMenuOptions =
		menuOptions.length > 0 ? menuOptions : getTaskCreationOptions();
	for (const option of resolvedMenuOptions) {
		menu.addItem((item) =>
			item.setTitle(option.label).onClick(() => {
				void view.handleCreateSubtask(parentTask, option.key);
			}),
		);
	}

	menu.showAtPosition({
		x: event.clientX + 12,
		y: event.clientY,
	});
}

export function showBatchPriorityMenu(
	view: IOTOTasksCenterView,
	event?: MouseEvent,
): void {
	const menu = new Menu();
	for (const priority of TASK_PRIORITY_VALUES) {
		menu.addItem((item) =>
			item.setTitle(formatPriorityMenuTitle(priority, false)).onClick(() => {
				void batchSetPriority(view, priority);
			}),
		);
	}
	if (event) {
		menu.showAtMouseEvent(event);
	} else {
		const rect = view.containerEl.getBoundingClientRect();
		menu.showAtPosition({
			x: rect.left + rect.width / 2,
			y: rect.top + 40,
		});
	}
}

export async function showBatchAssignUpTaskModal(
	view: IOTOTasksCenterView,
): Promise<void> {
	const selectedPaths = view.selectedTaskPaths;
	const seen = new Set<string>();
	const suggestions = view.tasks
		.filter(
			(task) =>
				!selectedPaths.has(task.path) &&
				task.title.length > 0 &&
				!seen.has(task.title) &&
				seen.add(task.title),
		)
		.map((task) => task.title);

	const parentTitle = await new TaskNameModal(
		view.app,
		t('modal.batchAssignUpTask.title'),
		t('modal.batchAssignUpTask.placeholder'),
		{
			descriptionText: t('modal.batchAssignUpTask.desc'),
			confirmButtonText: t('modal.batchAssignUpTask.confirm'),
			suggestions,
		},
	).openAndGetValue();
	if (!parentTitle) {
		return;
	}
	await batchAssignUpTask(view, parentTitle);
}
