import { ItemView, Notice, setIcon, WorkspaceLeaf } from 'obsidian';

import { t } from '../lang/helpter';
import { listProjectFolders } from '../tasks-center/data';
import {
	countProjectTaskNotes,
	ensureProjectMetadataFile,
	getProjectMetadataFile,
	readProjectMetadata,
	updateProjectMetadata,
	type ProjectMetadata,
} from '../tasks-center/project-metadata';
import { createProjectFolder } from '../tasks-center/project-creation';
import { TaskNameModal } from '../ui/taskNameModal';
import {
	sortProjectCenterRows,
	type ProjectCenterSortDirection,
	type ProjectCenterSortKey,
} from './project-center-sort';

export const IOTO_PROJECT_CENTER_VIEW_TYPE = 'IOTOProjectCenter';

interface ProjectCenterRow {
	name: string;
	path: string;
	taskCount: number;
	archived: boolean;
	metadata: ProjectMetadata;
}

interface IOTOProjectCenterViewState {
	sortKey?: ProjectCenterSortKey;
	sortDirection?: ProjectCenterSortDirection;
}

export class IOTOProjectCenterView extends ItemView {
	private rows: ProjectCenterRow[] = [];
	private status: 'idle' | 'loading' | 'root-missing' = 'idle';
	private isCreatingProject = false;
	private sortKey: ProjectCenterSortKey = 'projectName';
	private sortDirection: ProjectCenterSortDirection = 'asc';
	private readonly getTasksRootPath: () => string;
	private readonly getHiddenProjectNames: () => string[];
	private readonly setProjectHidden: (
		projectName: string,
		hidden: boolean,
	) => Promise<void>;
	private readonly getProjectCategoryOptions: () => string[];
	private readonly addProjectCategoryOption: (
		category: string,
	) => Promise<void>;
	private readonly refreshTokenParent: { token: number } = { token: 0 };

	constructor(
		leaf: WorkspaceLeaf,
		getTasksRootPath: () => string,
		getHiddenProjectNames: () => string[],
		setProjectHidden: (
			projectName: string,
			hidden: boolean,
		) => Promise<void>,
		getProjectCategoryOptions: () => string[],
		addProjectCategoryOption: (category: string) => Promise<void>,
	) {
		super(leaf);
		this.navigation = true;
		this.getTasksRootPath = getTasksRootPath;
		this.getHiddenProjectNames = getHiddenProjectNames;
		this.setProjectHidden = setProjectHidden;
		this.getProjectCategoryOptions = getProjectCategoryOptions;
		this.addProjectCategoryOption = addProjectCategoryOption;
	}

	getViewType(): string {
		return IOTO_PROJECT_CENTER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t('projectCenter.title');
	}

	getIcon(): string {
		return 'table';
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass('ioto-project-center-view');
		await this.refreshFromVaultChange();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	getState(): Record<string, unknown> {
		return {
			sortKey: this.sortKey,
			sortDirection: this.sortDirection,
		};
	}

	async setState(state: unknown): Promise<void> {
		const viewState = parseViewState(state);
		this.sortKey = viewState.sortKey ?? 'projectName';
		this.sortDirection = viewState.sortDirection ?? 'asc';
		await this.refreshFromVaultChange();
	}

	async handleSettingsChange(): Promise<void> {
		await this.refreshFromVaultChange();
	}

	async refreshFromVaultChange(): Promise<void> {
		const token = ++this.refreshTokenParent.token;
		this.status = 'loading';
		this.render();

		const tasksRootPath = this.getTasksRootPath();
		const result = listProjectFolders(this.app, tasksRootPath);
		if (token !== this.refreshTokenParent.token) {
			return;
		}

		if (result.status === 'root-missing') {
			this.rows = [];
			this.status = 'root-missing';
			this.render();
			return;
		}

		this.status = 'loading';
		const hiddenProjectNames = new Set(this.getHiddenProjectNames());
		const rows = await Promise.all(
			result.projects.map(async (project) => {
				const archived = hiddenProjectNames.has(project.name);
				const taskCount = countProjectTaskNotes(
					this.app,
					tasksRootPath,
					project.name,
				);
				const metadataFile = getProjectMetadataFile(
					this.app,
					tasksRootPath,
					project.name,
				);
				const metadata = metadataFile
					? await readProjectMetadata(this.app, metadataFile)
					: {};
				return {
					name: project.name,
					path: project.path,
					taskCount,
					archived,
					metadata,
				} satisfies ProjectCenterRow;
			}),
		);
		if (token !== this.refreshTokenParent.token) {
			return;
		}

		this.rows = rows;
		this.status = 'idle';
		this.render();
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();

		const headerEl = root.createDiv({ cls: 'ioto-project-center__header' });
		const titleEl = headerEl.createDiv({
			cls: 'ioto-project-center__title',
			text: t('projectCenter.title'),
		});
		titleEl.setAttribute('role', 'heading');

		const actionsEl = headerEl.createDiv({
			cls: 'ioto-project-center__actions',
		});
		const refreshButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-project-center__icon-button',
		});
		refreshButtonEl.type = 'button';
		refreshButtonEl.ariaLabel = t('projectCenter.action.refresh');
		refreshButtonEl.title = t('projectCenter.action.refresh');
		setIcon(refreshButtonEl, 'refresh-cw');
		refreshButtonEl.addEventListener('click', () => {
			void this.refreshFromVaultChange();
		});

		const createProjectButtonEl = actionsEl.createEl('button', {
			cls: 'ioto-project-center__icon-button',
		});
		createProjectButtonEl.type = 'button';
		createProjectButtonEl.disabled = !this.canCreateProject();
		createProjectButtonEl.ariaLabel = t(
			'projectCenter.action.createProject',
		);
		createProjectButtonEl.title = t('projectCenter.action.createProject');
		setIcon(createProjectButtonEl, 'plus');
		createProjectButtonEl.addEventListener('click', () => {
			void this.handleCreateProject();
		});

		const contentEl = root.createDiv({
			cls: 'ioto-project-center__content',
		});
		if (this.status === 'loading') {
			this.renderState(
				contentEl,
				t('projectCenter.state.loadingTitle'),
				t('projectCenter.state.loadingDesc', [this.getTasksRootPath()]),
				'is-loading',
			);
			return;
		}

		if (this.status === 'root-missing') {
			this.renderState(
				contentEl,
				t('projectCenter.state.rootMissingTitle'),
				t('projectCenter.state.rootMissingDesc', [
					this.getTasksRootPath(),
				]),
				'is-empty',
			);
			return;
		}

		if (this.rows.length === 0) {
			this.renderState(
				contentEl,
				t('projectCenter.state.emptyTitle'),
				t('projectCenter.state.emptyDesc', [this.getTasksRootPath()]),
				'is-empty',
			);
			return;
		}

		this.renderTable(contentEl);
	}

	private canCreateProject(): boolean {
		return (
			this.status === 'idle' &&
			!this.isCreatingProject &&
			this.getTasksRootPath().trim().length > 0
		);
	}

	private async handleCreateProject(): Promise<void> {
		if (!this.canCreateProject()) {
			return;
		}

		const projectNameResult = await new TaskNameModal(
			this.app,
			t('modal.newProject.title'),
			t('modal.newProject.placeholder'),
			{
				descriptionText: t('modal.newProject.desc'),
				confirmButtonText: t('modal.create'),
			},
		).openAndGetValue();
		if (!projectNameResult) {
			return;
		}

		this.isCreatingProject = true;
		this.render();

		try {
			const result = await createProjectFolder(
				this.app,
				this.getTasksRootPath(),
				projectNameResult,
			);
			if (!result.created) {
				new Notice(t('view.notice.projectAlreadyExists'));
			}
			await this.refreshFromVaultChange();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('projectCenter.notice.createProjectFailed');
			new Notice(message);
		} finally {
			this.isCreatingProject = false;
			this.render();
		}
	}

	private renderTable(container: HTMLElement): void {
		const tableEl = container.createDiv({
			cls: 'ioto-project-center__table',
		});
		const headerRowEl = tableEl.createDiv({
			cls: 'ioto-project-center__row ioto-project-center__row--header',
		});
		this.createHeaderCell(
			headerRowEl,
			'projectName',
			t('projectCenter.columns.projectName'),
		);
		this.createHeaderCell(
			headerRowEl,
			'category',
			t('projectCenter.columns.category'),
		);
		this.createHeaderCell(
			headerRowEl,
			'startDate',
			t('projectCenter.columns.startDate'),
		);
		this.createHeaderCell(
			headerRowEl,
			'dueDate',
			t('projectCenter.columns.dueDate'),
		);
		this.createHeaderCell(
			headerRowEl,
			'taskCount',
			t('projectCenter.columns.taskCount'),
		);
		this.createHeaderCell(
			headerRowEl,
			'archived',
			t('projectCenter.columns.archived'),
		);

		for (const row of sortProjectCenterRows(
			this.rows,
			this.sortKey,
			this.sortDirection,
		)) {
			const rowEl = tableEl.createDiv({
				cls: 'ioto-project-center__row ioto-project-center__row--data',
			});
			this.renderProjectNameCell(rowEl, row);
			this.renderCategoryCell(rowEl, row);
			this.renderDateCell(rowEl, row, 'startDate');
			this.renderDateCell(rowEl, row, 'dueDate');
			this.renderTaskCountCell(rowEl, row);
			this.renderArchivedCell(rowEl, row);
		}
	}

	private createHeaderCell(
		rowEl: HTMLElement,
		key: ProjectCenterSortKey,
		label: string,
	): void {
		const cellEl = rowEl.createEl('button', {
			cls: `ioto-project-center__cell ioto-project-center__cell--${key} ioto-project-center__header-cell`,
		});
		cellEl.type = 'button';
		cellEl.createSpan({
			cls: 'ioto-project-center__header-label',
			text: label,
		});

		if (this.sortKey === key) {
			cellEl.createSpan({
				cls: 'ioto-project-center__sort-indicator',
				text: this.sortDirection === 'asc' ? '▲' : '▼',
			});
		}

		cellEl.addEventListener('click', () => {
			this.handleSortClick(key);
		});
	}

	private handleSortClick(key: ProjectCenterSortKey): void {
		if (this.sortKey !== key) {
			this.sortKey = key;
			this.sortDirection = 'asc';
			this.render();
			return;
		}

		this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
		this.render();
	}

	private renderProjectNameCell(rowEl: HTMLElement, row: ProjectCenterRow) {
		rowEl.createDiv({
			cls: 'ioto-project-center__cell ioto-project-center__cell--projectName',
			text: row.name,
		});
	}

	private renderTaskCountCell(rowEl: HTMLElement, row: ProjectCenterRow) {
		rowEl.createDiv({
			cls: 'ioto-project-center__cell ioto-project-center__cell--taskCount',
			text: `${row.taskCount}`,
		});
	}

	private renderArchivedCell(rowEl: HTMLElement, row: ProjectCenterRow) {
		const cellEl = rowEl.createDiv({
			cls: 'ioto-project-center__cell ioto-project-center__cell--archived',
		});
		const toggleEl = cellEl.createEl('input', {
			cls: 'ioto-project-center__toggle',
			type: 'checkbox',
		});
		toggleEl.checked = row.archived;
		toggleEl.addEventListener('change', () => {
			void this.handleArchivedToggle(row, toggleEl.checked);
		});
	}

	private async handleArchivedToggle(
		row: ProjectCenterRow,
		archived: boolean,
	): Promise<void> {
		try {
			await this.setProjectHidden(row.name, archived);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('projectCenter.notice.updateArchivedFailed');
			new Notice(message);
			await this.refreshFromVaultChange();
		}
	}

	private renderCategoryCell(rowEl: HTMLElement, row: ProjectCenterRow) {
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
				this.getProjectCategoryOptions(),
				this.rows.map((item) => item.metadata.category),
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
			void this.handleCategoryChange(row, selectEl, currentCategory);
		});
	}

	private async handleCategoryChange(
		row: ProjectCenterRow,
		selectEl: HTMLSelectElement,
		previousCategory: string,
	): Promise<void> {
		const value = selectEl.value;
		if (value === '__ioto_add__') {
			selectEl.value = previousCategory;
			const nameResult = await new TaskNameModal(
				this.app,
				t('projectCenter.category.addTitle'),
				t('projectCenter.category.addPlaceholder'),
				{
					descriptionText: t('projectCenter.category.addDesc'),
					confirmButtonText: t('modal.create'),
				},
			).openAndGetValue();
			if (!nameResult) {
				return;
			}

			const normalized = nameResult.trim();
			if (!normalized) {
				return;
			}

			await this.addProjectCategoryOption(normalized);
			await this.persistMetadataPatch(row, { category: normalized });
			return;
		}

		await this.persistMetadataPatch(row, { category: value || null });
	}

	private renderDateCell(
		rowEl: HTMLElement,
		row: ProjectCenterRow,
		key: 'startDate' | 'dueDate',
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
			void this.persistMetadataPatch(row, {
				[key]: inputEl.value || null,
			});
		});
	}

	private async persistMetadataPatch(
		row: ProjectCenterRow,
		patch: Record<string, string | null | undefined>,
	): Promise<void> {
		const tasksRootPath = this.getTasksRootPath();
		try {
			const file = await ensureProjectMetadataFile(
				this.app,
				tasksRootPath,
				row.name,
			);
			await updateProjectMetadata(this.app, file, patch);
			const nextMetadata = await readProjectMetadata(this.app, file);
			row.metadata = nextMetadata;
			this.render();
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: t('projectCenter.notice.updateMetadataFailed');
			new Notice(message);
			await this.refreshFromVaultChange();
		}
	}

	private renderState(
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
}

function parseViewState(state: unknown): IOTOProjectCenterViewState {
	if (!state || typeof state !== 'object') {
		return {};
	}

	const candidate = state as Record<string, unknown>;
	const sortKey = isProjectCenterSortKey(candidate.sortKey)
		? candidate.sortKey
		: undefined;
	const sortDirection = isProjectCenterSortDirection(candidate.sortDirection)
		? candidate.sortDirection
		: undefined;
	return {
		sortKey,
		sortDirection,
	};
}

function isProjectCenterSortKey(value: unknown): value is ProjectCenterSortKey {
	return (
		value === 'projectName' ||
		value === 'category' ||
		value === 'startDate' ||
		value === 'dueDate' ||
		value === 'taskCount' ||
		value === 'archived'
	);
}

function isProjectCenterSortDirection(
	value: unknown,
): value is ProjectCenterSortDirection {
	return value === 'asc' || value === 'desc';
}

function collectCategoryOptions(
	configured: string[],
	seenCategories: Array<string | undefined>,
): string[] {
	const set = new Set<string>();
	for (const value of configured) {
		const normalized = value.trim();
		if (normalized) {
			set.add(normalized);
		}
	}
	for (const value of seenCategories) {
		if (typeof value !== 'string') {
			continue;
		}
		const normalized = value.trim();
		if (normalized) {
			set.add(normalized);
		}
	}

	return [...set].sort((left, right) =>
		left.localeCompare(right, undefined, { numeric: true }),
	);
}
