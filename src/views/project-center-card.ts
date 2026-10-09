/**
 * 项目中心卡片视图渲染（紧凑布局）。
 *
 * Phase 5 拆分后从 `iotoProjectCenterView.ts` 抽出。卡片内联了分类/日期/归档/规格
 * 控件（与表格布局的单元格结构不同），通过动作函数委托交互。
 */

import { setIcon } from 'obsidian';

import { t } from '../lang/helpter';
import {
	handleArchivedToggleAction,
	handleCategoryChangeAction,
	openProjectSpecAction,
	persistMetadataPatchAction,
} from './project-center-actions';
import {
	collectCategoryOptions,
	type ProjectCenterRow,
	type ProjectCenterViewContext,
} from './project-center-types';

export function renderProjectCard(
	container: HTMLElement,
	row: ProjectCenterRow,
	ctx: ProjectCenterViewContext,
): void {
	const cardEl = container.createDiv({
		cls: 'ioto-project-center__card',
	});

	const topEl = cardEl.createDiv({
		cls: 'ioto-project-center__card-top',
	});
	topEl.createDiv({
		cls: 'ioto-project-center__card-title',
		text: row.name,
	});
	const editButtonEl = topEl.createEl('button', {
		cls: 'ioto-project-center__icon-button',
	});
	editButtonEl.type = 'button';
	editButtonEl.ariaLabel = t('projectCenter.columns.editSpec');
	editButtonEl.title = t('projectCenter.columns.editSpec');
	setIcon(editButtonEl, 'file-edit');
	editButtonEl.addEventListener('click', () => {
		void openProjectSpecAction(row, ctx);
	});

	const metaEl = cardEl.createDiv({
		cls: 'ioto-project-center__card-meta',
	});
	const category =
		typeof row.metadata.category === 'string' &&
		row.metadata.category.length > 0
			? row.metadata.category
			: t('projectCenter.category.empty');
	metaEl.createSpan({
		cls: 'ioto-project-center__card-badge',
		text: category,
	});
	metaEl.createSpan({
		text: `${t('projectCenter.columns.taskCount')}: ${row.taskCount}`,
	});
	const startDate =
		typeof row.metadata.startDate === 'string'
			? row.metadata.startDate
			: '';
	const dueDate =
		typeof row.metadata.dueDate === 'string'
			? row.metadata.dueDate
			: '';
	if (startDate || dueDate) {
		metaEl.createSpan({
			text: `${startDate}${startDate && dueDate ? ' – ' : ''}${dueDate}`,
		});
	}

	const archiveButtonEl = cardEl.createEl('button', {
		cls: 'ioto-project-center__card-archive',
	});
	archiveButtonEl.type = 'button';
	setIcon(
		archiveButtonEl,
		row.archived ? 'archive-restore' : 'archive',
	);
	archiveButtonEl.createSpan({
		text: row.archived
			? t('projectCenter.action.unarchive')
			: t('projectCenter.action.archive'),
	});
	archiveButtonEl.addEventListener('click', () => {
		void handleArchivedToggleAction(row, !row.archived, ctx);
	});

	const currentCategory =
		typeof row.metadata.category === 'string'
			? row.metadata.category
			: '';
	const categoryFieldEl = cardEl.createDiv({
		cls: 'ioto-project-center__card-field',
	});
	categoryFieldEl.createDiv({
		cls: 'ioto-project-center__card-field-label',
		text: t('projectCenter.columns.category'),
	});
	const selectEl = categoryFieldEl.createEl('select', {
		cls: 'ioto-project-center__select',
	});
	const categoryOptions = [
		'',
		...collectCategoryOptions(
			ctx.getProjectCategoryOptions(),
			ctx.rows.map((item) => item.metadata.category),
		),
	];
	for (const option of categoryOptions) {
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

	const datesEl = cardEl.createDiv({
		cls: 'ioto-project-center__card-dates',
	});
	const startDateFieldEl = datesEl.createDiv({
		cls: 'ioto-project-center__card-field',
	});
	startDateFieldEl.createDiv({
		cls: 'ioto-project-center__card-field-label',
		text: t('projectCenter.columns.startDate'),
	});
	const startDateInputEl = startDateFieldEl.createEl('input', {
		cls: 'ioto-project-center__date',
		type: 'date',
	});
	startDateInputEl.value = startDate;
	startDateInputEl.addEventListener('change', () => {
		void persistMetadataPatchAction(
			row,
			{ startDate: startDateInputEl.value || null },
			ctx,
		);
	});

	const dueDateFieldEl = datesEl.createDiv({
		cls: 'ioto-project-center__card-field',
	});
	dueDateFieldEl.createDiv({
		cls: 'ioto-project-center__card-field-label',
		text: t('projectCenter.columns.dueDate'),
	});
	const dueDateInputEl = dueDateFieldEl.createEl('input', {
		cls: 'ioto-project-center__date',
		type: 'date',
	});
	dueDateInputEl.value = dueDate;
	dueDateInputEl.addEventListener('change', () => {
		void persistMetadataPatchAction(
			row,
			{ dueDate: dueDateInputEl.value || null },
			ctx,
		);
	});
}
