import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { type TaskOutlinkCategory } from '../../ui/task-outlink-popover';
import { countTaskOutlinksByRootPaths } from '../../tasks-center/task-outlink-counts';
import { t } from '../../lang/helpter';

export function queueOutlinkBadgeUpdate(
	view: IOTOTasksCenterView,
	taskPath: string,
): void {
	view.pendingOutlinkBadgeUpdates.add(taskPath);
	if (view.outlinkBadgeUpdateTimer !== null) {
		return;
	}

	view.outlinkBadgeUpdateTimer = window.setTimeout(() => {
		view.outlinkBadgeUpdateTimer = null;
		const paths = [...view.pendingOutlinkBadgeUpdates];
		view.pendingOutlinkBadgeUpdates.clear();
		for (const path of paths) {
			updateTaskOutlinkBadges(view, path);
		}
	}, 250);
}

export function updateTaskOutlinkBadges(
	view: IOTOTasksCenterView,
	taskPath: string,
): void {
	if (!view.getShowTaskOutlinkCounts()) {
		return;
	}

	const rowEl = findTaskRowEl(view, taskPath);
	if (!rowEl) {
		return;
	}

	const titleEl = rowEl.querySelector<HTMLElement>(
		'.ioto-tasks-center__task-title',
	);
	if (!titleEl) {
		return;
	}

	const showInput = view.getShowTaskInputOutlinkCount();
	const showOutput = view.getShowTaskOutputOutlinkCount();
	const showOutcome = view.getShowTaskOutcomeOutlinkCount();

	const resolvedLinks = view.app.metadataCache.resolvedLinks?.[taskPath];
	const counts = countTaskOutlinksByRootPaths(resolvedLinks, {
		inputRootPath: view.getInputRootPath(),
		outputRootPath: view.getOutputRootPath(),
		outcomeRootPath: view.getOutcomeRootPath(),
	});
	syncTaskOutlinkBadge(
		view,
		titleEl,
		taskPath,
		'input',
		showInput,
		counts.input,
	);
	syncTaskOutlinkBadge(
		view,
		titleEl,
		taskPath,
		'output',
		showOutput,
		counts.output,
	);
	syncTaskOutlinkBadge(
		view,
		titleEl,
		taskPath,
		'outcome',
		showOutcome,
		counts.outcome,
	);

	cleanupTaskOutlinkCountsContainer(titleEl);
}

function syncTaskOutlinkBadge(
	view: IOTOTasksCenterView,
	titleEl: HTMLElement,
	taskPath: string,
	category: TaskOutlinkCategory,
	enabled: boolean,
	value: number,
): void {
	const badgeEl = titleEl.querySelector<HTMLElement>(
		`.ioto-tasks-center__task-outlink-count[data-outlink-category="${category}"]`,
	);

	if (!enabled || value <= 0) {
		badgeEl?.remove();
		return;
	}

	const label = getTaskOutlinkBadgeLabel(category, value);
	if (badgeEl) {
		badgeEl.textContent = String(value);
		badgeEl.ariaLabel = label;
		badgeEl.removeAttribute('title');
		return;
	}

	const countersEl =
		titleEl.querySelector<HTMLElement>(
			'.ioto-tasks-center__task-outlink-counts',
		) ??
		titleEl.createSpan({
			cls: 'ioto-tasks-center__task-outlink-counts',
		});
	const newBadgeEl = countersEl.createSpan({
		cls: 'ioto-tasks-center__task-outlink-count',
		text: String(value),
	});
	newBadgeEl.dataset.outlinkCategory = category;
	newBadgeEl.ariaLabel = label;
	view.bindTaskOutlinkPopover(newBadgeEl, taskPath, category);
}

function cleanupTaskOutlinkCountsContainer(titleEl: HTMLElement): void {
	const countersEl = titleEl.querySelector<HTMLElement>(
		'.ioto-tasks-center__task-outlink-counts',
	);
	if (!countersEl) {
		return;
	}

	if (
		countersEl.querySelector(
			'.ioto-tasks-center__task-outlink-count[data-outlink-category]',
		)
	) {
		return;
	}

	countersEl.remove();
}

function getTaskOutlinkBadgeLabel(
	category: TaskOutlinkCategory,
	value: number,
): string {
	switch (category) {
		case 'input':
			return t('task.outlinks.input', [String(value)]);
		case 'output':
			return t('task.outlinks.output', [String(value)]);
		case 'outcome':
			return t('task.outlinks.outcome', [String(value)]);
	}
}

function findTaskRowEl(
	view: IOTOTasksCenterView,
	taskPath: string,
): HTMLButtonElement | null {
	const escaped = escapeCssSelector(taskPath);
	const rowEl = view.contentEl.querySelector(
		`button.ioto-tasks-center__task-row[data-task-path="${escaped}"]`,
	);
	return rowEl instanceof HTMLButtonElement ? rowEl : null;
}

function escapeCssSelector(value: string): string {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
		return CSS.escape(value);
	}

	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
