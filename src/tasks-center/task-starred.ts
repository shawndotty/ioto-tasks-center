import type { App, TFile } from 'obsidian';
import {
	removeScalarProperty,
	rewriteTaskFrontmatter,
	upsertScalarProperty,
} from './frontmatter-properties';

/** 设置核心任务标记，返回写盘后的完整内容（[[Plan-20261103-103716]] §四.C4）。 */
export async function setTaskFileStarred(
	app: App,
	file: TFile,
): Promise<string> {
	return updateTaskFileStarred(app, file, true);
}

/** 取消核心任务标记，返回写盘后的完整内容。 */
export async function clearTaskFileStarred(
	app: App,
	file: TFile,
): Promise<string> {
	return updateTaskFileStarred(app, file);
}

async function updateTaskFileStarred(
	app: App,
	file: TFile,
	starred?: true,
): Promise<string> {
	return rewriteTaskFrontmatter(app, file, (content) =>
		starred === true
			? upsertScalarProperty(content, 'Starred', 'true')
			: removeScalarProperty(content, 'Starred'),
	);
}
