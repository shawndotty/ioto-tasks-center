import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import type { TaskFileEntry } from '../../tasks-center/types';
import {
	type TaskOutlinkCategory,
} from '../../ui/task-outlink-popover';
import { countTaskOutlinksByRootPaths } from '../../tasks-center/task-outlink-counts';
import { getTaskPriorityClassName } from './helpers';
import { t } from '../../lang/helpter';
import { setIcon } from 'obsidian';

export function renderTaskRows(
	view: IOTOTasksCenterView,
	container: HTMLElement,
	tasks: TaskFileEntry[],
	activeTaskPath: string | null,
	directChildTasksByParentPath: ReadonlyMap<
		string,
		TaskFileEntry[]
	> | null,
): void {
	const collapsedIndentStack: number[] = [];
	for (let i = 0; i < tasks.length; i++) {
		const task = tasks[i];
		if (!task) {
			continue;
		}
		const indentLevel = task.indentLevel ?? 0;
		while (collapsedIndentStack.length > 0) {
			const topIndent =
				collapsedIndentStack[collapsedIndentStack.length - 1];
			if (topIndent === undefined || indentLevel > topIndent) {
				break;
			}
			collapsedIndentStack.pop();
		}

		if (collapsedIndentStack.length > 0) {
			continue;
		}

		const nextIndentLevel = tasks[i + 1]?.indentLevel ?? 0;
		const hasChildren = nextIndentLevel > indentLevel;
		const subtasksCollapsed = hasChildren
			? view.isSubtasksCollapsed(task.path)
			: false;

		const rowEl = container.createEl('button', {
			cls: 'ioto-tasks-center__task-row',
		});
		rowEl.type = 'button';
		rowEl.draggable = !view.isUpdatingUpTask;
		rowEl.dataset.taskPath = task.path;
		rowEl.style.setProperty(
			'--ioto-task-indent-level',
			`${indentLevel}`,
		);
		if (indentLevel > 0) {
			rowEl.addClass('is-subtask');
		}

		if (task.path === activeTaskPath) {
			rowEl.addClass('is-active');
		}

		if (task.path === view.openingTaskPath) {
			rowEl.addClass('is-opening');
		}

		if (task.path === view.draggingTaskPath) {
			rowEl.addClass('is-dragging');
		}

		if (task.path === view.dropTargetTaskPath) {
			rowEl.addClass('is-drop-target');
		}

		if (task.path === view.invalidDropTargetTaskPath) {
			rowEl.addClass('is-drop-invalid');
		}

		const titleEl = rowEl.createDiv({
			cls: 'ioto-tasks-center__task-title',
		});
		if (hasChildren) {
			const toggleEl = titleEl.createSpan({
				cls: 'ioto-tasks-center__subtask-toggle-icon',
			});
			toggleEl.toggleClass('is-expanded', !subtasksCollapsed);
			toggleEl.ariaLabel = subtasksCollapsed
				? t('view.subtasks.expand')
				: t('view.subtasks.collapse');
			setIcon(toggleEl, 'chevron-right');
			toggleEl.addEventListener('click', (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				view.toggleSubtasksCollapsed(task.path);
			});
		}
		titleEl.createSpan({
			cls: 'ioto-tasks-center__task-title-text',
			text: task.title,
		});
		if (view.getShowTaskSubtaskCount()) {
			const childTasks =
				directChildTasksByParentPath?.get(task.path) ?? [];
			if (childTasks.length > 0) {
				const badgeEl = titleEl.createSpan({
					cls: 'ioto-tasks-center__task-outlink-count ioto-tasks-center__task-subtask-count',
					text: String(childTasks.length),
				});
				badgeEl.ariaLabel = t('task.subtasks.badge', [
					String(childTasks.length),
				]);
				view.bindTaskSubtaskPopover(badgeEl, childTasks);
			}
		}
		if (view.getShowTaskOutlinkCounts()) {
			const showInput = view.getShowTaskInputOutlinkCount();
			const showOutput = view.getShowTaskOutputOutlinkCount();
			const showOutcome = view.getShowTaskOutcomeOutlinkCount();
			if (showInput || showOutput || showOutcome) {
				const resolvedLinks =
					view.app.metadataCache.resolvedLinks?.[task.path];
				const counts = countTaskOutlinksByRootPaths(resolvedLinks, {
					inputRootPath: view.getInputRootPath(),
					outputRootPath: view.getOutputRootPath(),
					outcomeRootPath: view.getOutcomeRootPath(),
				});
				const badgeEntries: Array<{
					category: TaskOutlinkCategory;
					value: number;
					label: string;
				}> = [];
				if (showInput && counts.input > 0) {
					badgeEntries.push({
						category: 'input',
						value: counts.input,
						label: t('task.outlinks.input', [
							String(counts.input),
						]),
					});
				}
				if (showOutput && counts.output > 0) {
					badgeEntries.push({
						category: 'output',
						value: counts.output,
						label: t('task.outlinks.output', [
							String(counts.output),
						]),
					});
				}
				if (showOutcome && counts.outcome > 0) {
					badgeEntries.push({
						category: 'outcome',
						value: counts.outcome,
						label: t('task.outlinks.outcome', [
							String(counts.outcome),
						]),
					});
				}

				if (badgeEntries.length > 0) {
					const countersEl = titleEl.createSpan({
						cls: 'ioto-tasks-center__task-outlink-counts',
					});
					for (const entry of badgeEntries) {
						const badgeEl = countersEl.createSpan({
							cls: 'ioto-tasks-center__task-outlink-count',
							text: String(entry.value),
						});
						badgeEl.dataset.outlinkCategory = entry.category;
						badgeEl.ariaLabel = entry.label;
						view.bindTaskOutlinkPopover(
							badgeEl,
							task.path,
							entry.category,
						);
					}
				}
			}
		}
		if (
			view.getShowTaskPriority() &&
			typeof task.priority === 'number'
		) {
			const priorityEl = rowEl.createSpan({
				cls: `ioto-tasks-center__task-priority ${getTaskPriorityClassName(task.priority)}`,
				text: `P${task.priority}`,
			});
			priorityEl.ariaLabel = `优先级：P${task.priority}`;
		}
		if (task.starred) {
			const coreBadgeEl = rowEl.createSpan({
				cls: 'ioto-tasks-center__task-core-badge',
				text: '⭐',
			});
			coreBadgeEl.ariaLabel = t('view.taskCoreBadge.label');
			coreBadgeEl.title = t('view.taskCoreBadge.label');
		}
		const statusEl = rowEl.createSpan({
			cls: `ioto-tasks-center__task-status ioto-tasks-center__task-status--${task.status.key}`,
			text: task.status.label,
		});
		statusEl.ariaLabel = `任务状态：${task.status.label}`;
		if (
			task.status.key === 'todo' ||
			task.status.key === 'in-progress'
		) {
			view.bindTaskStatusChecklistPopover(statusEl, task);
		}

		rowEl.addEventListener('click', () => {
			void view.openTaskFile(task);
		});
		rowEl.addEventListener('mouseover', (event: MouseEvent) => {
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.closest('.ioto-tasks-center__task-outlink-count') ||
					target.closest('.ioto-tasks-center__task-status'))
			) {
				return;
			}

			view.triggerTaskHoverPreview(event, task, rowEl);
		});
		rowEl.addEventListener('contextmenu', (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			view.showTaskPriorityMenu(event, task);
		});
		rowEl.addEventListener('dragstart', (event: DragEvent) => {
			view.handleTaskDragStart(event, task, rowEl);
		});
		rowEl.addEventListener('dragover', (event: DragEvent) => {
			view.handleTaskDragOver(event, task, rowEl);
		});
		rowEl.addEventListener('dragleave', (event: DragEvent) => {
			view.handleTaskDragLeave(event, task, rowEl);
		});
		rowEl.addEventListener('drop', (event: DragEvent) => {
			void view.handleTaskDrop(event, task, rowEl);
		});
		rowEl.addEventListener('dragend', () => {
			view.clearTaskDragState();
		});

		if (hasChildren && subtasksCollapsed) {
			collapsedIndentStack.push(indentLevel);
		}
	}
}
