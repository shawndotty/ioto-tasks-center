import type { App, TFile } from 'obsidian';

import { t } from '../lang/helpter';
import {
	removeListProperty,
	upsertListProperty,
} from './task-creation';
import {
	removeTaskListProperty,
	rewriteTaskListProperty,
} from './frontmatter-properties';

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

export function buildContentWithRemovedUpTask(content: string): string {
	return removeListProperty(content, 'UpTask');
}

export async function assignUpTaskToFile(
	app: App,
	file: TFile,
	parentTaskTitle: string,
): Promise<boolean> {
	return rewriteTaskListProperty(
		app,
		file,
		'UpTask',
		buildUpTaskWikilink(parentTaskTitle),
	);
}

export async function removeUpTaskFromFile(
	app: App,
	file: TFile,
): Promise<boolean> {
	return removeTaskListProperty(app, file, 'UpTask');
}
