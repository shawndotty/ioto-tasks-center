/**
 * 项目中心视图的动作处理：创建项目、归档切换、分类变更、元数据写回、
 * 打开项目规格文件、预览面板管理。
 *
 * Phase 5 拆分后从 `iotoProjectCenterView.ts` 抽出。所有动作接收
 * `ProjectCenterViewContext`，通过接口读写视图状态，不直接依赖视图类。
 */

import { Notice, TFile, type App, type WorkspaceLeaf } from 'obsidian';

import { t } from '../lang/helpter';
import { createProjectFolder } from '../tasks-center/project-creation';
import {
	ensureProjectMetadataFile,
	PROJECT_METADATA_FILE_NAME,
	readProjectMetadata,
	updateProjectMetadata,
} from '../tasks-center/project-metadata';
import { TaskNameModal } from '../ui/taskNameModal';
import type {
	ProjectCenterRow,
	ProjectCenterViewContext,
} from './project-center-types';

export async function handleCreateProjectAction(
	ctx: ProjectCenterViewContext,
): Promise<void> {
	if (!ctx.canCreateProject()) {
		return;
	}

	const projectNameResult = await new TaskNameModal(
		ctx.app,
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

	ctx.setIsCreatingProject(true);
	ctx.render();

	try {
		const result = await createProjectFolder(
			ctx.app,
			ctx.getTasksRootPath(),
			projectNameResult,
		);
		if (!result.created) {
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
