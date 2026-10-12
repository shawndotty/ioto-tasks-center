/**
 * 项目中心视图的动作处理：创建项目、归档切换、分类变更、元数据写回、
 * 打开项目规格文件、预览面板管理。
 *
 * Phase 5 拆分后从 `iotoProjectCenterView.ts` 抽出。所有动作接收
 * `ProjectCenterViewContext`，通过接口读写视图状态，不直接依赖视图类。
 */

import { Notice, TFile, type App, type WorkspaceLeaf } from 'obsidian';

import { t } from '../lang/helpter';
import { createProjectWithCategory } from '../tasks-center/project-creation';
import {
	selectProjectsInCategory,
	type ProjectCategoryAssignment,
} from '../tasks-center/project-category';
import {
	ensureProjectMetadataFile,
	PROJECT_METADATA_FILE_NAME,
	readProjectMetadata,
	rewriteProjectCategory,
	updateProjectMetadata,
} from '../tasks-center/project-metadata';
import { ManageCategoriesModal } from '../ui/manageCategoriesModal';
import { CreateProjectModal } from '../ui/createProjectModal';
import { TaskNameModal } from '../ui/taskNameModal';
import {
	collectCategoryOptions,
	type ProjectCenterRow,
	type ProjectCenterViewContext,
} from './project-center-types';

export async function handleCreateProjectAction(
	ctx: ProjectCenterViewContext,
): Promise<void> {
	if (!ctx.canCreateProject()) {
		return;
	}

	const result = await new CreateProjectModal(
		ctx.app,
		t('modal.newProject.title'),
		{
			descriptionText: t('modal.newProject.desc'),
			confirmButtonText: t('modal.create'),
			categoryOptions: collectCategoryOptions(
				ctx.getProjectCategoryOptions(),
				ctx.rows.map((row) => row.metadata.category),
			),
		},
	).openAndGetValue();
	if (!result) {
		return;
	}

	ctx.setIsCreatingProject(true);
	ctx.render();

	try {
		const created = await createProjectWithCategory(
			ctx.app,
			ctx.getTasksRootPath(),
			result.name,
			result.category,
			(category) => ctx.addProjectCategoryOption(category),
		);
		if (!created.created) {
			new Notice(t('view.notice.projectAlreadyExists'));
		}
		await ctx.refreshFromVaultChange();
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: t('projectCenter.notice.createProjectFailed');
		new Notice(message);
	} finally {
		ctx.setIsCreatingProject(false);
		ctx.render();
	}
}

export async function handleArchivedToggleAction(
	row: ProjectCenterRow,
	archived: boolean,
	ctx: ProjectCenterViewContext,
): Promise<void> {
	try {
		await ctx.setProjectHidden(row.name, archived);
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: t('projectCenter.notice.updateArchivedFailed');
		new Notice(message);
		await ctx.refreshFromVaultChange();
	}
}

export async function handleCategoryChangeAction(
	row: ProjectCenterRow,
	selectEl: HTMLSelectElement,
	previousCategory: string,
	ctx: ProjectCenterViewContext,
): Promise<void> {
	const value = selectEl.value;
	if (value === '__ioto_add__') {
		selectEl.value = previousCategory;
		const nameResult = await new TaskNameModal(
			ctx.app,
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

		await ctx.addProjectCategoryOption(normalized);
		await persistMetadataPatchAction(row, { category: normalized }, ctx);
		return;
	}

	await persistMetadataPatchAction(row, { category: value || null }, ctx);
}

export async function openManageCategoriesAction(
	ctx: ProjectCenterViewContext,
): Promise<void> {
	const modal = new ManageCategoriesModal(ctx.app, {
		getCategories: () =>
			collectCategoryOptions(
				ctx.getProjectCategoryOptions(),
				ctx.rows.map((row) => row.metadata.category),
			),
		getProjectCount: (category) =>
			selectProjectsInCategory(toAssignments(ctx.rows), category).length,
		onAdd: (name) => ctx.addProjectCategoryOption(name),
		onRename: (oldName, newName) =>
			renameCategoryEverywhere(ctx, oldName, newName),
		onRemove: (name) => removeCategoryEverywhere(ctx, name),
	});
	modal.open();
}

function toAssignments(rows: ProjectCenterRow[]): ProjectCategoryAssignment[] {
	return rows.map((row) => ({
		name: row.name,
		category:
			typeof row.metadata.category === 'string'
				? row.metadata.category
				: '',
	}));
}

/**
 * 改名：先写元数据（含幽灵分类命中的项目），再动设置。
 * 顺序刻意为「先元数据、后设置」：updater 内 `applySettingsToOpenViews()`
 * 触发刷新时元数据已是终值，避免先刷到旧分类再被二次刷新而闪烁。
 */
async function renameCategoryEverywhere(
	ctx: ProjectCenterViewContext,
	oldName: string,
	newName: string,
): Promise<void> {
	const names = selectProjectsInCategory(toAssignments(ctx.rows), oldName);
	const result = await rewriteProjectCategory(
		ctx.app,
		ctx.getTasksRootPath(),
		names,
		newName,
	);
	await ctx.renameProjectCategoryOption(oldName, newName);
	// 应用设置会异步触发本视图 refreshFromVaultChange；这里 await 一次，
	// 保证 Modal 的 renderList（操作返回后立即重绘）读到的是刷新后的 rows，
	// 而不是「设置已是新值、rows 仍是旧分类」的中间态。
	await ctx.refreshFromVaultChange();
	if (result.failed.length > 0) {
		new Notice(
			t('modal.manageCategories.notice.partialFail', [
				String(result.failed.length),
			]),
		);
	}
}

async function removeCategoryEverywhere(
	ctx: ProjectCenterViewContext,
	name: string,
): Promise<void> {
	const names = selectProjectsInCategory(toAssignments(ctx.rows), name);
	const result = await rewriteProjectCategory(
		ctx.app,
		ctx.getTasksRootPath(),
		names,
		null,
	);
	await ctx.removeProjectCategoryOption(name);
	// 同 renameCategoryEverywhere：await 一次刷新，避免 Modal 重绘时 rows 仍含旧分类。
	await ctx.refreshFromVaultChange();
	if (result.failed.length > 0) {
		new Notice(
			t('modal.manageCategories.notice.partialFail', [
				String(result.failed.length),
			]),
		);
	}
}

export async function persistMetadataPatchAction(
	row: ProjectCenterRow,
	patch: Record<string, string | null | undefined>,
	ctx: ProjectCenterViewContext,
): Promise<void> {
	const tasksRootPath = ctx.getTasksRootPath();
	try {
		const file = await ensureProjectMetadataFile(
			ctx.app,
			tasksRootPath,
			row.name,
		);
		await updateProjectMetadata(ctx.app, file, patch);
		row.metadata = await readProjectMetadata(ctx.app, file);
		ctx.render();
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: t('projectCenter.notice.updateMetadataFailed');
		new Notice(message);
		await ctx.refreshFromVaultChange();
	}
}

export async function openProjectSpecAction(
	row: ProjectCenterRow,
	ctx: ProjectCenterViewContext,
): Promise<void> {
	const filePath = `${row.path}/${PROJECT_METADATA_FILE_NAME}`;
	const abstractFile = ctx.app.vault.getAbstractFileByPath(filePath);
	const file =
		abstractFile instanceof TFile
			? abstractFile
			: await ctx.app.vault.create(
					filePath,
					'---\nIOTOProject:\n---\n',
				);
	const leaf = ensurePreviewLeafAction(ctx);
	await leaf.openFile(file, { active: true });
}

export function ensurePreviewLeafAction(
	ctx: ProjectCenterViewContext,
): WorkspaceLeaf {
	if (ctx.previewLeaf && isLeafAvailable(ctx.app, ctx.previewLeaf)) {
		return ctx.previewLeaf;
	}
	const leaf = ctx.app.workspace.getLeaf('split', 'vertical');
	ctx.setPreviewLeaf(leaf);
	return leaf;
}

export function isLeafAvailable(
	app: App,
	leaf: WorkspaceLeaf,
): boolean {
	let exists = false;
	app.workspace.iterateAllLeaves((l) => {
		if (l === leaf) {
			exists = true;
		}
	});
	return exists;
}
