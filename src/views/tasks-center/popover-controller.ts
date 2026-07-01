import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type { TaskFileEntry } from '../../tasks-center/types';
import {
	type TaskOutlinkCategory,
	type TaskOutlinkPopoverItem,
} from '../../ui/task-outlink-popover';
import {
	type TaskStatusChecklistPopover,
	type TaskStatusChecklistPopoverItem,
	truncateChecklistPreview,
} from '../../ui/task-status-checklist-popover';
import { getIncompleteChecklistItems } from '../../tasks-center/data';
import { groupTaskOutlinksByRootPaths } from '../../tasks-center/task-outlink-counts';
import { t } from '../../lang/helpter';
import { TFile } from 'obsidian';

export function bindTaskSubtaskPopover(
	view: IOTOTasksCenterView,
	badgeEl: HTMLElement,
	childTasks: TaskFileEntry[],
): void {
	const popover = view.outlinkPopover;
	if (!popover) {
		return;
	}

	badgeEl.addEventListener('mouseenter', (event) => {
		event.stopPropagation();
		const items = getTaskSubtaskPopoverItems(view, childTasks);
		popover.open({
			anchorEl: badgeEl,
			categoryTitle: t('task.subtasks.popover.title'),
			emptyText: t('task.subtasks.popover.empty'),
			items,
			onItemClick: (file) => {
				void view.openFileInPreview(file);
			},
		});
	});
	badgeEl.addEventListener('mouseleave', (event) => {
		event.stopPropagation();
		popover.scheduleClose();
	});
}

function getTaskSubtaskPopoverItems(
	view: IOTOTasksCenterView,
	childTasks: TaskFileEntry[],
): TaskOutlinkPopoverItem[] {
	const items: TaskOutlinkPopoverItem[] = [];
	for (const task of childTasks) {
		const file = view.app.vault.getAbstractFileByPath(task.path);
		if (!(file instanceof TFile)) {
			continue;
		}

		items.push({
			path: task.path,
			title: task.title,
			file,
		});
	}

	return items;
}

export function bindTaskOutlinkPopover(
	view: IOTOTasksCenterView,
	badgeEl: HTMLElement,
	taskPath: string,
	category: TaskOutlinkCategory,
): void {
	const popover = view.outlinkPopover;
	if (!popover) {
		return;
	}

	badgeEl.addEventListener('mouseenter', (event) => {
		event.stopPropagation();
		const items = getTaskOutlinkPopoverItems(view, taskPath, category);
		popover.open({
			anchorEl: badgeEl,
			categoryTitle: getTaskOutlinkPopoverTitle(category),
			emptyText: t('task.outlinks.popover.empty'),
			items,
			onItemClick: (file) => {
				void view.openOutlinkFileInPreview(file);
			},
		});
	});
	badgeEl.addEventListener('mouseleave', (event) => {
		event.stopPropagation();
		popover.scheduleClose();
	});
}

export function bindTaskStatusChecklistPopover(
	view: IOTOTasksCenterView,
	badgeEl: HTMLElement,
	task: TaskFileEntry,
): void {
	const popover = view.taskStatusChecklistPopover;
	if (!popover) {
		return;
	}

	badgeEl.addEventListener('mouseenter', (event) => {
		event.stopPropagation();
		void openTaskStatusChecklistPopover(view, badgeEl, task, popover);
	});
	badgeEl.addEventListener('mouseleave', (event) => {
		event.stopPropagation();
		popover.scheduleClose();
	});
}

async function openTaskStatusChecklistPopover(
	view: IOTOTasksCenterView,
	badgeEl: HTMLElement,
	task: TaskFileEntry,
	popover: TaskStatusChecklistPopover,
): Promise<void> {
	const file = view.app.vault.getAbstractFileByPath(task.path);
	if (!(file instanceof TFile)) {
		return;
	}

	const items = (await getIncompleteChecklistItems(view.app, file)).map(
		(item): TaskStatusChecklistPopoverItem => ({
			...item,
			displayText: truncateChecklistPreview(item.text),
		}),
	);
	popover.open({
		anchorEl: badgeEl,
		title: getTaskStatusChecklistPopoverTitle(task.status.key),
		emptyText: t('task.status.popover.empty'),
		items,
		onItemClick: (item) => {
			void view.openTaskFileAtChecklist(task.path, item);
		},
	});
}

function getTaskStatusChecklistPopoverTitle(
	statusKey: TaskFileEntry['status']['key'],
): string {
	switch (statusKey) {
		case 'todo':
			return t('task.status.popover.todoTitle');
		case 'in-progress':
			return t('task.status.popover.inProgressTitle');
		default:
			return t('task.status.popover.empty');
	}
}

function getTaskOutlinkPopoverTitle(category: TaskOutlinkCategory): string {
	switch (category) {
		case 'input':
			return t('task.outlinks.popover.title.input');
		case 'output':
			return t('task.outlinks.popover.title.output');
		case 'outcome':
			return t('task.outlinks.popover.title.outcome');
	}
}

function getTaskOutlinkPopoverItems(
	view: IOTOTasksCenterView,
	taskPath: string,
	category: TaskOutlinkCategory,
): TaskOutlinkPopoverItem[] {
	const resolvedLinks = view.app.metadataCache.resolvedLinks?.[taskPath];
	const targets = groupTaskOutlinksByRootPaths(resolvedLinks, {
		inputRootPath: view.getInputRootPath(),
		outputRootPath: view.getOutputRootPath(),
		outcomeRootPath: view.getOutcomeRootPath(),
	});
	const paths = targets[category];

	const items: TaskOutlinkPopoverItem[] = [];
	for (const path of paths) {
		const file = view.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			continue;
		}

		items.push({
			path,
			title: file.basename,
			file,
		});
	}

	return items.sort((left, right) =>
		left.title.localeCompare(right.title, undefined, { numeric: true }),
	);
}
