/**
 * 四象限「创建任务」的入口编排（[[Plan-20261116-154231]] §5.5、
 * [[Plan-20261116-155634]] §5.6）。
 *
 * 链路：类型（视图层菜单选定）→ 解析项目 → 名称弹窗（非 date）
 * → 预览叶 → `createTaskFile()` → 写 Priority / Starred → `reload()`
 * → 在预览叶打开并落 `%%Cursor%%` → 可见性提示。
 * 挂载、扫描与写盘能力全部由调用方注入，本模块不直接持有视图实例。
 */

import { Notice } from 'obsidian';
import type { App, TFile, WorkspaceLeaf } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	resolveQuadrantCreateProject,
	type QuadrantCreateProjectResolution,
} from '../../tasks-center/quadrant-create-target';
import { priorityForQuadrantDrop } from '../../tasks-center/quadrant-drag';
import type {
	QuadrantKey,
	QuadrantProjectScope,
} from '../../tasks-center/quadrant-data';
import { createTaskFile } from '../../tasks-center/task-creation';
import type {
	TaskCreationType,
	TaskTemplateConfig,
} from '../../tasks-center/task-template-config';
import { QuadrantProjectPickerModal } from '../../ui/quadrantProjectPickerModal';
import { TaskCreationModal } from '../../ui/taskCreationModal';
import { applyCreatedTaskFileSettings } from '../tasks-center/created-task-settings';
import type { QuadrantProjectOption } from './data-loader';

export interface QuadrantCreateDeps {
	app: App;
	getTasksRootPath(): string;
	getProjectScope(): QuadrantProjectScope;
	getProjectOptions(): readonly QuadrantProjectOption[];
	getTaskTemplateConfig(type: TaskCreationType): TaskTemplateConfig;
	getDateTaskDateFormat(): string;
	/** 预览叶（含放置策略）；必须在名称弹窗之后调用，取消路径不留空分栏。 */
	ensurePreviewLeaf(): WorkspaceLeaf;
	/** 打开刚创建（或已存在）的任务并落到 %%Cursor%% 位置。 */
	openCreatedTask(file: TFile, cursorOffset: number | null): Promise<void>;
	sourceLeaf: WorkspaceLeaf;
	isTaskVisible(path: string): boolean;
	beginCreating(key: QuadrantKey): void;
	endCreating(key: QuadrantKey): void;
	reload(): Promise<void>;
}

export async function createTaskInQuadrant(
	key: QuadrantKey,
	type: TaskCreationType,
	deps: QuadrantCreateDeps,
): Promise<void> {
	deps.beginCreating(key);
	try {
		const projectName = await resolveProjectName(deps);
		if (!projectName) return;

		const priority = priorityForQuadrantDrop(key);
		if (priority === undefined) return;

		let customName: string | undefined;
		let starred = false;
		if (type !== 'date') {
			const texts = resolveTaskTypeModalTexts(type);
			const modalResult = await new TaskCreationModal(
				deps.app,
				texts.title,
				texts.label,
				{
					descriptionText: t('modal.newTask.desc'),
					confirmButtonText: t('modal.create'),
					lockedPriority: priority,
				},
			).openAndGetValue();
			if (!modalResult) return;
			customName = modalResult.name ?? undefined;
			starred = modalResult.starred;
		}

		const previewLeaf = deps.ensurePreviewLeaf();
		const result = await createTaskFile({
			app: deps.app,
			tasksRootPath: deps.getTasksRootPath(),
			projectName,
			type,
			customName,
			templateConfig: deps.getTaskTemplateConfig(type),
			dateTaskDateFormat: deps.getDateTaskDateFormat(),
			targetLeaf: previewLeaf,
			sourceLeaf: deps.sourceLeaf,
		});

		// 同名文件已存在：`createTaskFile()` 已提示，打开旧文件但不覆盖
		// 旧任务的优先级与星标（[[Plan-20261116-155634]] §2 #6）。
		if (!result.created) {
			await deps.reload();
			await deps.openCreatedTask(result.file, null);
			return;
		}

		await applyCreatedTaskFileSettings(deps.app, result.file, {
			priority,
			starred,
		});
		await deps.reload();
		await deps.openCreatedTask(result.file, result.cursorOffset);

		if (!deps.isTaskVisible(result.file.path)) {
			new Notice(
				t('priorityQuadrant.create.hiddenByFilter', [result.file.path]),
			);
		}
		new Notice(t('priorityQuadrant.create.created', [result.file.path]));
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: t('view.notice.createTaskFailed');
		new Notice(message);
	} finally {
		deps.endCreating(key);
	}
}

async function resolveProjectName(
	deps: QuadrantCreateDeps,
): Promise<string | null> {
	const resolution = resolveQuadrantCreateProject(
		deps.getProjectScope(),
		deps.getProjectOptions(),
	);
	return pickProject(resolution, deps.app);
}

async function pickProject(
	resolution: QuadrantCreateProjectResolution,
	app: App,
): Promise<string | null> {
	switch (resolution.kind) {
		case 'project':
			return resolution.projectName;
		case 'pick': {
			const picked = await new QuadrantProjectPickerModal(
				app,
				resolution.candidates,
			).pick();
			return picked?.name ?? null;
		}
		case 'none':
			new Notice(t('priorityQuadrant.create.noProjects'));
			return null;
	}
}

function resolveTaskTypeModalTexts(type: TaskCreationType): {
	title: string;
	label: string;
} {
	if (type === 'plan') {
		return {
			title: t('modal.newPlanTask.title'),
			label: t('modal.newPlanTask.placeholder'),
		};
	}
	if (type === 'topic') {
		return {
			title: t('modal.newTopicTask.title'),
			label: t('modal.newTopicTask.placeholder'),
		};
	}
	return {
		title: t('modal.newNormalTask.title'),
		label: t('modal.newNormalTask.placeholder'),
	};
}