import { FileView, WorkspaceLeaf } from 'obsidian';
import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { resolveActiveTaskPath } from '../task-preview-state';
import { getWorkspaceLeafId } from './constants';

export function getActiveTaskPath(view: IOTOTasksCenterView): string | null {
	return resolveActiveTaskPath({
		openedTaskPath: view.openedTaskPath,
		previewLeafAvailable: Boolean(
			view.previewLeaf && view.isLeafAvailable(view.previewLeaf),
		),
		previewedFilePath: view.getPreviewLeafFilePath(),
	});
}

export function getPreviewLeafFilePath(view: IOTOTasksCenterView): string | null {
	if (!view.previewLeaf || !view.isLeafAvailable(view.previewLeaf)) {
		return null;
	}

	const leafView = view.previewLeaf.view;
	return leafView instanceof FileView && leafView.file ? leafView.file.path : null;
}

export function activatePreviewLeaf(view: IOTOTasksCenterView): void {
	if (!view.previewLeaf || !view.isLeafAvailable(view.previewLeaf)) {
		return;
	}

	view.app.workspace.setActiveLeaf(view.previewLeaf, {
		focus: true,
	});
}

export function ensurePreviewLeaf(view: IOTOTasksCenterView): WorkspaceLeaf {
	if (view.previewLeaf && view.isLeafAvailable(view.previewLeaf)) {
		return view.previewLeaf;
	}

	const recoveredLeaf = view.findReusablePreviewLeaf();
	if (recoveredLeaf) {
		view.previewLeaf = recoveredLeaf;
		return recoveredLeaf;
	}

	const previewLeaf = view.app.workspace.createLeafBySplit(
		view.leaf,
		'vertical',
	);
	view.previewLeaf = previewLeaf;
	return previewLeaf;
}

export function isLeafAvailable(view: IOTOTasksCenterView, targetLeaf: WorkspaceLeaf): boolean {
	let exists = false;
	view.app.workspace.iterateAllLeaves((leaf) => {
		if (leaf === targetLeaf) {
			exists = true;
		}
	});
	return exists;
}

export function findReusablePreviewLeaf(view: IOTOTasksCenterView): WorkspaceLeaf | null {
	if (view.openedTaskPath) {
		const openedFileLeaf = view.findLeafByFilePath(view.openedTaskPath);
		if (openedFileLeaf && openedFileLeaf !== view.leaf) {
			return openedFileLeaf;
		}
	}

	return null;
}

export function findLeafByFilePath(view: IOTOTasksCenterView, filePath: string): WorkspaceLeaf | null {
	let matchedLeaf: WorkspaceLeaf | null = null;

	view.app.workspace.iterateAllLeaves((leaf) => {
		if (matchedLeaf || leaf === view.leaf) {
			return;
		}

		const leafView = leaf.view;
		if (leafView instanceof FileView && leafView.file?.path === filePath) {
			matchedLeaf = leaf;
		}
	});

	return matchedLeaf;
}

export function findLeafById(view: IOTOTasksCenterView, leafId: string): WorkspaceLeaf | null {
	let matchedLeaf: WorkspaceLeaf | null = null;

	view.app.workspace.iterateAllLeaves((leaf) => {
		if (matchedLeaf) {
			return;
		}

		if (getWorkspaceLeafId(leaf) === leafId) {
			matchedLeaf = leaf;
		}
	});

	return matchedLeaf;
}
