/**
 * 分类管理 Modal（[[Plan-20261012-092334]] 步骤 5）。
 *
 * 与 `TaskNameModal` / `ConfirmModal` 同族；**不自持数据**，每次渲染通过
 * 回调向宿主取数，改完即重查重绘。分类集合口径为「设置列表 ∪ 各项目实际
 * category」的并集（由宿主 `getCategories()` 提供），因此幽灵分类也能被
 * 看到与操作。
 */

import { Modal, Notice, setIcon } from 'obsidian';

import { t } from '../lang/helpter';
import { ConfirmModal } from './confirmModal';
import { TaskNameModal } from './taskNameModal';

export interface ManageCategoriesModalOptions {
	/** 已排序并集（不含「未分类」）。 */
	getCategories(): string[];
	/** 传 `''` 即「未分类」计数。 */
	getProjectCount(category: string): number;
	onAdd(name: string): Promise<void>;
	onRename(oldName: string, newName: string): Promise<void>;
	onRemove(name: string): Promise<void>;
}

export class ManageCategoriesModal extends Modal {
	private query = '';
	private listEl: HTMLElement | null = null;

	constructor(
		app: Modal['app'],
		private readonly options: ManageCategoriesModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(t('modal.manageCategories.title'));
		this.modalEl.addClass('ioto-tasks-center__manage-categories-modal');

		const headerEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__manage-categories-header',
		});

		const searchInputEl = headerEl.createEl('input', {
			cls: 'ioto-tasks-center__manage-categories-search',
			type: 'search',
		});
		searchInputEl.placeholder = t(
			'modal.manageCategories.searchPlaceholder',
		);
		searchInputEl.setAttribute('autocapitalize', 'off');
		searchInputEl.setAttribute('autocomplete', 'off');
		searchInputEl.spellcheck = false;
		searchInputEl.addEventListener('input', () => {
			this.query = searchInputEl.value;
			this.renderList();
		});

		const addButtonEl = headerEl.createEl('button', {
			text: t('projectCenter.category.addNew'),
		});
		addButtonEl.type = 'button';
		addButtonEl.addEventListener('click', () => {
			void this.handleAdd();
		});

		this.listEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__manage-categories-list',
		});
		this.renderList();
	}

	onClose(): void {
		this.listEl = null;
		this.contentEl.empty();
	}

	private renderList(): void {
		const listEl = this.listEl;
		if (!listEl) {
			return;
		}

		const categories = this.options.getCategories();
		const query = this.query.trim().toLowerCase();
		const visible = query
			? categories.filter((category) =>
					category.toLowerCase().includes(query),
				)
			: categories;

		listEl.empty();

		if (categories.length === 0) {
			listEl.createDiv({
				cls: 'ioto-tasks-center__manage-categories-empty',
				text: t('modal.manageCategories.empty'),
			});
		} else if (visible.length === 0) {
			listEl.createDiv({
				cls: 'ioto-tasks-center__manage-categories-empty',
				text: t('modal.manageCategories.noMatch'),
			});
		} else {
			for (const category of visible) {
				this.renderRow(listEl, category);
			}
		}

		// 「未分类」是状态而非分类：只在未搜索时钉在列表底部（常显计数、无按钮）；
		// 一旦进入搜索（query 非空）即整体隐藏 —— 它不是分类，不参与分类名检索（Q7 修订）。
		if (!query) {
			this.renderReadonlyRow(listEl);
		}
	}

	private renderRow(listEl: HTMLElement, category: string): void {
		const rowEl = listEl.createDiv({
			cls: 'ioto-tasks-center__manage-categories-row',
		});
		rowEl.createDiv({
			cls: 'ioto-tasks-center__manage-categories-name',
			text: category,
		});
		rowEl.createDiv({
			cls: 'ioto-tasks-center__manage-categories-count',
			text: this.formatCount(category),
		});

		const actionsEl = rowEl.createDiv({
			cls: 'ioto-tasks-center__manage-categories-row-actions',
		});

		const renameButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-project-center__icon-button',
		});
		renameButtonEl.type = 'button';
		renameButtonEl.ariaLabel = t('modal.manageCategories.rename');
		renameButtonEl.title = t('modal.manageCategories.rename');
		setIcon(renameButtonEl, 'pencil');
		renameButtonEl.addEventListener('click', () => {
			void this.handleRename(category);
		});

		const deleteButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-project-center__icon-button',
		});
		deleteButtonEl.type = 'button';
		deleteButtonEl.ariaLabel = t('modal.manageCategories.delete');
		deleteButtonEl.title = t('modal.manageCategories.delete');
		setIcon(deleteButtonEl, 'trash-2');
		deleteButtonEl.addEventListener('click', () => {
			void this.handleRemove(category);
		});
	}

	private renderReadonlyRow(listEl: HTMLElement): void {
		const rowEl = listEl.createDiv({
			cls: 'ioto-tasks-center__manage-categories-row is-readonly',
		});
		rowEl.createDiv({
			cls: 'ioto-tasks-center__manage-categories-name',
			text: t('projectCenter.category.empty'),
		});
		rowEl.createDiv({
			cls: 'ioto-tasks-center__manage-categories-count',
			text: this.formatCount(''),
		});
	}

	private formatCount(category: string): string {
		return t('modal.manageCategories.projectCount', [
			String(this.options.getProjectCount(category)),
		]);
	}

	private async handleAdd(): Promise<void> {
		const result = await new TaskNameModal(
			this.app,
			t('projectCenter.category.addTitle'),
			t('projectCenter.category.addPlaceholder'),
			{
				descriptionText: t('projectCenter.category.addDesc'),
				confirmButtonText: t('modal.create'),
			},
		).openAndGetValue();
		if (!result) {
			return;
		}

		const name = result.trim();
		if (!name) {
			return;
		}

		await this.runOperation(() => this.options.onAdd(name));
	}

	private async handleRename(category: string): Promise<void> {
		const result = await new TaskNameModal(
			this.app,
			t('modal.manageCategories.renameTitle'),
			t('projectCenter.category.addPlaceholder'),
			{
				defaultValue: category,
				descriptionText: t('modal.manageCategories.renameDesc'),
				confirmButtonText: t('modal.confirm'),
			},
		).openAndGetValue();
		if (!result) {
			return;
		}

		const nextName = result.trim();
		if (!nextName || nextName === category) {
			return;
		}

		if (this.options.getCategories().includes(nextName)) {
			new Notice(t('modal.manageCategories.notice.duplicate'));
			return;
		}

		await this.runOperation(() =>
			this.options.onRename(category, nextName),
		);
	}

	private async handleRemove(category: string): Promise<void> {
		const count = this.options.getProjectCount(category);
		const confirmed = await new ConfirmModal(
			this.app,
			t('modal.manageCategories.deleteConfirmTitle'),
			{
				descriptionText: t(
					'modal.manageCategories.deleteConfirmDesc',
					[category, String(count)],
				),
				confirmButtonText: t('modal.deleteTask.confirm'),
				cancelButtonText: t('modal.cancel'),
			},
		).openAndConfirm();
		if (!confirmed) {
			return;
		}

		await this.runOperation(() => this.options.onRemove(category));
	}

	private async runOperation(operation: () => Promise<void>): Promise<void> {
		try {
			await operation();
		} catch {
			new Notice(t('modal.manageCategories.notice.failed'));
		} finally {
			this.renderList();
		}
	}
}
