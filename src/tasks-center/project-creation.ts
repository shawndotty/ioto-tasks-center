import { App, TFolder } from 'obsidian';
import { t } from '../lang/helpter';
import {
	ensureProjectMetadataFile,
	updateProjectMetadata,
} from './project-metadata';

export interface CreateProjectFolderResult {
	name: string;
	path: string;
	created: boolean;
}

export function normalizeProjectName(input: string): string | null {
	const normalized = input
		.trim()
		.replace(/[\\/:*?"<>|#[\]^]+/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^-+|-+$/g, '');

	return normalized.length > 0 ? normalized : null;
}

export function resolveProjectTargetPath(
	tasksRootPath: string,
	projectName: string,
): string {
	return normalizeVaultPath(`${tasksRootPath}/${projectName}`);
}

export async function createProjectFolder(
	app: App,
	tasksRootPath: string,
	projectName: string,
): Promise<CreateProjectFolderResult> {
	const normalizedName = normalizeProjectName(projectName);
	if (!normalizedName) {
		throw new Error(t('error.projectNameEmpty'));
	}

	const rootFolder = app.vault.getAbstractFileByPath(tasksRootPath);
	if (!(rootFolder instanceof TFolder)) {
		throw new Error(t('error.createProjectRootMissing', [tasksRootPath]));
	}

	const targetPath = resolveProjectTargetPath(tasksRootPath, normalizedName);
	const existingFile = app.vault.getAbstractFileByPath(targetPath);
	if (existingFile instanceof TFolder) {
		return {
			name: existingFile.name,
			path: existingFile.path,
			created: false,
		};
	}

	if (existingFile) {
		throw new Error(t('error.targetPathUnavailable', [targetPath]));
	}

	await app.vault.adapter.mkdir(targetPath);
	return {
		name: normalizedName,
		path: targetPath,
		created: true,
	};
}

function normalizeVaultPath(path: string): string {
	return path
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\.\//, '')
		.replace(/\/+$/g, '');
}

/**
 * 纯函数：决定「建项目后是否写分类、写什么」。
 *
 * - 重名（`created === false`）：返回 `null` → 不覆盖其分类。
 * - 留空 / `null`：返回 `null` → 视为未分类，不写。
 * - 否则返回 `trim()` 后的分类名（分类名不是路径，不套用 `normalizeProjectName`）。
 */
export function planProjectCategoryWrite(
	created: boolean,
	category: string | null,
): string | null {
	if (!created) {
		return null;
	}
	const normalized = (category ?? '').trim();
	return normalized.length > 0 ? normalized : null;
}

/**
 * 建项目 + 落分类的共用编排：两个「添加项目」入口统一走这里，保证顺序与语义一致。
 *
 * 顺序严格为「先建目录成功 → 再入设置字典 → 再建档 → 再写 `category`」，
 * 杜绝「先入字典后建目录失败」留下孤儿分类。`createProjectFolder` 保持无副作用。
 */
export async function createProjectWithCategory(
	app: App,
	tasksRootPath: string,
	name: string,
	category: string | null,
	addCategoryOption: (category: string) => Promise<void>,
): Promise<CreateProjectFolderResult> {
	const result = await createProjectFolder(app, tasksRootPath, name);
	const toWrite = planProjectCategoryWrite(result.created, category);
	if (!toWrite) {
		return result;
	}

	await addCategoryOption(toWrite);
	const file = await ensureProjectMetadataFile(app, tasksRootPath, result.name);
	await updateProjectMetadata(app, file, { category: toWrite });
	return result;
}
