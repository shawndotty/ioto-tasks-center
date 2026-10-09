/**
 * 项目中心表格视图的单元格渲染器（宽屏布局）。
 *
 * Phase 5 拆分后从 `iotoProjectCenterView.ts` 抽出。每个单元格函数接收
 * `ProjectCenterViewContext` 以调用动作函数（归档/分类/日期/规格）。
 * 纯展示单元格（项目名、任务数）只需行数据。
 */

import { setIcon } from 'obsidian';

import { t } from '../lang/helpter';
import {
	handleArchivedToggleAction,
	handleCategoryChangeAction,
	openProjectSpecAction,
	persistMetadataPatchAction,
} from './project-center-actions';
import type { ProjectCenterSortKey } from './project-center-sort';
import {
	collectCategoryOptions,
	type ProjectCenterRow,
	type ProjectCenterViewContext,
} from './project-center-types';

export function createProjectHeaderCell(
	rowEl: HTMLElement,
	key: ProjectCenterSortKey,
	label: string,
	ctx: ProjectCenterViewContext,
): void {
	const cellEl = rowEl.createEl('button', {
		cls: `ioto-project-center__cell ioto-project-center__cell--${key} ioto-project-center__header-cell`,
	});
	cellEl.type = 'button';
	cellEl.createSpan({
		cls: 'ioto-project-center__header-label',
		text: label,
	});

	if (ctx.sortKey === key) {
		cellEl.createSpan({
			cls: 'ioto-project-center__sort-indicator',
			text: ctx.sortDirection === 'asc' ? '▲' : '▼',
		});
	}

	cellEl.addEventListener('click', () => {
		ctx.handleSortClick(key);
	});
}

export function renderProjectNameCell(
	rowEl: HTMLElement,
	row: ProjectCenterRow,
): void {
	rowEl.createDiv({
		cls: 'ioto-project-center__cell ioto-project-center__cell--projectName',
		text: row.name,
	});
}

export function renderTaskCountCell(
	rowEl: HTMLElement,
	row: ProjectCenterRow,
): void {
	rowEl.createDiv({
		cls: 'ioto-project-center__cell ioto-project-center__cell--taskCount',
		text: `${row.taskCount}`,
	});
}

export function renderArchivedCell(
	rowEl: HTMLElement,
	row: ProjectCenterRow,
	ctx: ProjectCenterViewContext,
): void {
	const cellEl = rowEl.createDiv({
		cls: 'ioto-project-center__cell ioto-project-center__cell--archived',
	});
	const toggleEl = cellEl.createEl('input', {
		cls: 'ioto-project-center__toggle',
		type: 'checkbox',
	});
	toggleEl.checked = row.archived;
	toggleEl.addEventListener('change', () => {
		void handleArchivedToggleAction(row, toggleEl.checked, ctx);
	});
}

export function renderEditSpecCell(
	rowEl: HTMLElement,
	row: ProjectCenterRow,
	ctx: ProjectCenterViewContext,
): void {
	const cellEl = rowEl.createDiv({
		cls: 'ioto-project-center__cell ioto-project-center__cell--editSpec',
	});
	const buttonEl = cellEl.createEl('button', {
		cls: 'ioto-project-center__icon-button',
		attr: {
			'aria-label': t('projectCenter.columns.editSpec'),
			title: t('projectCenter.columns.editSpec'),
		},
	});
	setIcon(buttonEl, 'file-edit');
	buttonEl.addEventListener('click', () => {
		void openProjectSpecAction(row, ctx);
	});
}

export function renderCategoryCell(
	rowEl: HTMLElement,
	row: ProjectCenterRow,
	ctx: ProjectCenterViewContext,
): void {
	const cellEl = rowEl.createDiv({
		cls: 'ioto-project-center__cell ioto-project-center__cell--category',
	});

	const selectEl = cellEl.createEl('select', {
		cls: 'ioto-project-center__select',
	});

	const currentCategory =
		typeof row.metadata.category === 'string'
			? row.metadata.category
			: '';

	const options = [
		'',
		...collectCategoryOptions(
			ctx.getProjectCategoryOptions(),
			ctx.rows.map((item) => item.metadata.category),
		),
	];

	for (const option of options) {
		const optionEl = selectEl.createEl('option', {
			value: option,
			text:
				option.length > 0
					? option
					: t('projectCenter.category.empty'),
		});
		if (option === currentCategory) {
			optionEl.selected = true;
		}
	}

	selectEl.createEl('option', {
		value: '__ioto_add__',
		text: t('projectCenter.category.addNew'),
	});

	selectEl.addEventListener('change', () => {
		void handleCategoryChangeAction(row, selectEl, currentCategory, ctx);
	});
}

export function renderDateCell(
	rowEl: HTMLElement,
	row: ProjectCenterRow,
	key: 'startDate' | 'dueDate',
	ctx: ProjectCenterViewContext,
): void {
	const cellEl = rowEl.createDiv({
		cls: `ioto-project-center__cell ioto-project-center__cell--${key}`,
	});
	const inputEl = cellEl.createEl('input', {
		cls: 'ioto-project-center__date',
		type: 'date',
	});
	const currentValue =
		typeof row.metadata[key] === 'string' ? row.metadata[key] : '';
	inputEl.value = currentValue;
	inputEl.addEventListener('change', () => {
		void persistMetadataPatchAction(row, {
			[key]: inputEl.value || null,
		}, ctx);
	});
}
