import type { App, TFile } from 'obsidian';

import { t } from '../lang/helpter';
import { removeListProperty, upsertListProperty } from './task-creation';

export function buildUpTaskWikilink(taskTitle: string): string {
	const normalizedTitle = taskTitle.trim();
	if (!normalizedTitle) {
		throw new Error(t('error.parentTaskTitleEmpty'));
	}

	return `[[${normalizedTitle}]]`;
}

export function buildContentWithAssignedUpTask(
	content: string,
	parentTaskTitle: string,
): string {
	return upsertListProperty(
		content,
		'UpTask',
		buildUpTaskWikilink(parentTaskTitle),
	);
}

export async function assignUpTaskToFile(
	app: App,
	file: TFile,
	parentTaskTitle: string,
): Promise<boolean> {
	const currentContent = await app.vault.read(file);
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
	const currentContent = await app.vault.read(file);
	const nextContent = buildContentWithRemovedUpTask(currentContent);
	if (nextContent === currentContent) {
		return false;
	}

	await app.vault.modify(file, nextContent);
	return true;
}
