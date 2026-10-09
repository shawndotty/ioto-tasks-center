/**
 * 项目中心视图的列表渲染：状态占位、表格布局、卡片布局、排序控件。
 *
 * Phase 5 拆分后从 `iotoProjectCenterView.ts` 抽出。宽屏走表格（单元格在
 * `project-center-cells`），窄屏走卡片（在 `project-center-card`）。
 */

import { t } from '../lang/helpter';
import { renderProjectCard } from './project-center-card';
import {
	createProjectHeaderCell,
	renderArchivedCell,
	renderCategoryCell,
	renderDateCell,
	renderEditSpecCell,
	renderProjectNameCell,
	renderTaskCountCell,
} from './project-center-cells';
import { filterProjectCenterRowsByQuery } from './project-center-search';
import {
	sortProjectCenterRows,
	type ProjectCenterSortKey,
} from './project-center-sort';
import type {
	ProjectCenterRow,
	ProjectCenterViewContext,
} from './project-center-types';

export function renderProjectCenterList(
	container: HTMLElement,
	ctx: ProjectCenterViewContext,
): void {
	container.empty();

	if (ctx.status === 'loading') {
		renderProjectCenterState(
			container,
			t('projectCenter.state.loadingTitle'),
			t('projectCenter.state.loadingDesc', [ctx.getTasksRootPath()]),
			'is-loading',
		);
		return;
	}

	if (ctx.status === 'root-missing') {
		renderProjectCenterState(
			container,
			t('projectCenter.state.rootMissingTitle'),
			t('projectCenter.state.rootMissingDesc', [
				ctx.getTasksRootPath(),
			]),
			'is-empty',
		);
		return;
	}

	const filteredRows = filterProjectCenterRowsByQuery(
		ctx.rows,
		ctx.projectSearchQuery,
	);
	if (filteredRows.length === 0) {
		const keyword = ctx.projectSearchQuery.trim();
		if (keyword) {
			renderProjectCenterState(
				container,
				t('projectCenter.search.emptyTitle'),
				t('projectCenter.search.emptyDesc', [keyword]),
				'is-empty',
			);
			return;
		}

		renderProjectCenterState(
			container,
			t('projectCenter.state.emptyTitle'),
			t('projectCenter.state.emptyDesc', [ctx.getTasksRootPath()]),
			'is-empty',
		);
		return;
	}

	if (ctx.isCompactLayout) {
		renderProjectCenterCards(container, filteredRows, ctx);
	} else {
		renderProjectCenterTable(container, filteredRows, ctx);
	}
}

export function renderProjectCenterTable(
	container: HTMLElement,
	rows: ProjectCenterRow[],
	ctx: ProjectCenterViewContext,
): void {
	const tableEl = container.createDiv({
		cls: 'ioto-project-center__table',
	});
	const headerRowEl = tableEl.createDiv({
		cls: 'ioto-project-center__row ioto-project-center__row--header',
	});

	headerRowEl.createDiv({
		cls: 'ioto-project-center__cell ioto-project-center__cell--editSpec',
		text: t('projectCenter.columns.editSpec'),
	});

	createProjectHeaderCell(
		headerRowEl,
		'projectName',
		t('projectCenter.columns.projectName'),
		ctx,
	);
	createProjectHeaderCell(
		headerRowEl,
		'category',
		t('projectCenter.columns.category'),
		ctx,
	);

	createProjectHeaderCell(
		headerRowEl,
		'taskCount',
		t('projectCenter.columns.taskCount'),
		ctx,
	);
	createProjectHeaderCell(
		headerRowEl,
		'archived',
		t('projectCenter.columns.archived'),
		ctx,
	);
	createProjectHeaderCell(
		headerRowEl,
		'startDate',
		t('projectCenter.columns.startDate'),
		ctx,
	);
	createProjectHeaderCell(
		headerRowEl,
		'dueDate',
		t('projectCenter.columns.dueDate'),
		ctx,
	);

	for (const row of sortProjectCenterRows(
		rows,
		ctx.sortKey,
		ctx.sortDirection,
	)) {
		const rowEl = tableEl.createDiv({
			cls: 'ioto-project-center__row ioto-project-center__row--data',
		});
		renderEditSpecCell(rowEl, row, ctx);
		renderProjectNameCell(rowEl, row);
		renderCategoryCell(rowEl, row, ctx);

		renderTaskCountCell(rowEl, row);
		renderArchivedCell(rowEl, row, ctx);
		renderDateCell(rowEl, row, 'startDate', ctx);
		renderDateCell(rowEl, row, 'dueDate', ctx);
	}
}

export function renderProjectCenterCards(
	container: HTMLElement,
	rows: ProjectCenterRow[],
	ctx: ProjectCenterViewContext,
): void {
	const listEl = container.createDiv({
		cls: 'ioto-project-center__cards',
	});
	renderCardSortControl(listEl, ctx);
	for (const row of sortProjectCenterRows(
		rows,
		ctx.sortKey,
		ctx.sortDirection,
	)) {
		renderProjectCard(listEl, row, ctx);
	}
}

export function renderCardSortControl(
	container: HTMLElement,
	ctx: ProjectCenterViewContext,
): void {
	const barEl = container.createDiv({
		cls: 'ioto-project-center__card-sort',
	});
	const sortKeys: ProjectCenterSortKey[] = [
		'projectName',
		'category',
		'taskCount',
		'archived',
		'startDate',
		'dueDate',
	];
	const labels: Record<ProjectCenterSortKey, string> = {
		projectName: t('projectCenter.columns.projectName'),
		category: t('projectCenter.columns.category'),
		taskCount: t('projectCenter.columns.taskCount'),
		archived: t('projectCenter.columns.archived'),
		startDate: t('projectCenter.columns.startDate'),
		dueDate: t('projectCenter.columns.dueDate'),
	};
	for (const key of sortKeys) {
		const chipEl = barEl.createEl('button', {
			cls: 'ioto-project-center__sort-chip',
		});
		chipEl.type = 'button';
		chipEl.createSpan({ text: labels[key] });
		if (ctx.sortKey === key) {
			chipEl.addClass('is-active');
			chipEl.createSpan({
				cls: 'ioto-project-center__sort-indicator',
				text: ctx.sortDirection === 'asc' ? '▲' : '▼',
			});
		}
		chipEl.addEventListener('click', () => {
			ctx.handleSortClick(key);
		});
	}
}

export function renderProjectCenterState(
	container: HTMLElement,
	title: string,
	description: string,
	stateClass: 'is-empty' | 'is-loading',
): void {
	const stateEl = container.createDiv({
		cls: `ioto-project-center__state ${stateClass}`,
	});
	stateEl.createDiv({
		cls: 'ioto-project-center__state-title',
		text: title,
	});
	stateEl.createDiv({
		cls: 'ioto-project-center__state-desc',
		text: description,
	});
}
