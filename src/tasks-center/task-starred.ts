import type { App, TFile } from 'obsidian';
import {
	removeScalarProperty,
	rewriteTaskFrontmatter,
	upsertScalarProperty,
} from './frontmatter-properties';

export async function setTaskFileStarred(
	app: App,
	file: TFile,
): Promise<void> {
	await updateTaskFileStarred(app, file, true);
}

export async function clearTaskFileStarred(
	app: App,
	file: TFile,
): Promise<void> {
	await updateTaskFileStarred(app, file);
}

async function updateTaskFileStarred(
	app: App,
	file: TFile,
	starred?: true,
): Promise<void> {
	await rewriteTaskFrontmatter(app, file, (content) =>
		starred === true
			? upsertScalarProperty(content, 'Starred', 'true')
			: removeScalarProperty(content, 'Starred'),
	);
}
