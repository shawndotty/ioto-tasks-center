import type { App, TFile } from 'obsidian';

import { removeListProperty, upsertListProperty } from './task-creation';

export function buildUpTaskWikilink(taskTitle: string): string {
	const normalizedTitle = taskTitle.trim();
	if (!normalizedTitle) {
		throw new Error('父任务标题不能为空。');
	}

	return `[[${normalizedTitle}]]`;
}

export function buildContentWithAssignedUpTask(
	content: string,
	parentTaskTitle: string,
): string {
	return upsertListProperty(content, 'UpTask', buildUpTaskWikilink(parentTaskTitle));
}

export async function assignUpTaskToFile(
	app: App,
	file: TFile,
	parentTaskTitle: string,
): Promise<boolean> {
	const currentContent = await app.vault.cachedRead(file);
	const nextContent = buildContentWithAssignedUpTask(
		currentContent,
		parentTaskTitle,
	);
	if (nextContent === currentContent) {
		return false;
	}

	await app.vault.modify(file, nextContent);
	return true;
}

export function buildContentWithRemovedUpTask(content: string): string {
	return removeListProperty(content, 'UpTask');
}

export async function removeUpTaskFromFile(
	app: App,
	file: TFile,
): Promise<boolean> {
	const currentContent = await app.vault.cachedRead(file);
	const nextContent = buildContentWithRemovedUpTask(currentContent);
	if (nextContent === currentContent) {
		return false;
	}

	await app.vault.modify(file, nextContent);
	return true;
}
