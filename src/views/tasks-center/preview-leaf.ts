import { FileView, type Workspace, WorkspaceLeaf } from 'obsidian';
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

/** 任务中心叶是否位于左/右侧栏（身份比较，覆盖移动端抽屉）。 */
export function isLeafInSidebar(ws: Workspace, leaf: WorkspaceLeaf): boolean {
	const root = leaf.getRoot();
	return root === ws.leftSplit || root === ws.rightSplit;
}

export type PreviewLeafPlacement =
	| { kind: 'reuse'; leaf: WorkspaceLeaf }
	| { kind: 'split'; anchor: WorkspaceLeaf }
	| { kind: 'tab' };

/** 纯判定：预览叶该落在哪。不做任何创建，便于单测。 */
export function resolvePreviewLeafPlacement(
	ws: Workspace,
	viewLeaf: WorkspaceLeaf,
): PreviewLeafPlacement {
	// 主区：保持原行为 —— 紧邻任务中心右侧分栏
	if (!isLeafInSidebar(ws, viewLeaf)) {
		return { kind: 'split', anchor: viewLeaf };
	}
	// 侧栏：锚到主区最近叶，绝不能把侧栏自己拆成两列。
	// 显式传 rootSplit：不带参会连浮动窗口一起扫，可能去拆弹出窗口。
	const anchor = ws.getMostRecentLeaf(ws.rootSplit);
	if (!anchor) {
		return { kind: 'tab' };
	}
	// 延迟加载的叶也报 'empty'，必须排除，否则会覆写后台已打开的笔记。
	// 1.7.2 之前没有延迟视图，isDeferred 为 undefined 时判据恰好成立。
	// eslint-disable-next-line obsidianmd/no-unsupported-api -- 见上：旧版无延迟视图，undefined 语义正确
	if (!anchor.isDeferred && anchor.view.getViewType() === 'empty') {
		return { kind: 'reuse', leaf: anchor };
	}
	return { kind: 'split', anchor };
}

/** 侧栏叶一律不可作预览锚点（含缓存 / 回捞两种来源）。 */
function isUsablePreviewLeaf(
	view: IOTOTasksCenterView,
	leaf: WorkspaceLeaf | null,
): leaf is WorkspaceLeaf {
	return (
		leaf !== null &&
		view.isLeafAvailable(leaf) &&
		!isLeafInSidebar(view.app.workspace, leaf)
	);
}

function applyPlacement(
	ws: Workspace,
	placement: PreviewLeafPlacement,
): WorkspaceLeaf {
	switch (placement.kind) {
		case 'reuse':
			return placement.leaf;
		case 'split':
			return ws.createLeafBySplit(placement.anchor, 'vertical');
		case 'tab':
			return ws.getLeaf('tab');
	}
}

export function ensurePreviewLeaf(view: IOTOTasksCenterView): WorkspaceLeaf {
	const cachedLeaf = view.previewLeaf;
	if (isUsablePreviewLeaf(view, cachedLeaf)) {
		return cachedLeaf;
	}

	const recoveredLeaf = view.findReusablePreviewLeaf();
	if (isUsablePreviewLeaf(view, recoveredLeaf)) {
		view.previewLeaf = recoveredLeaf;
		return recoveredLeaf;
	}

	const ws = view.app.workspace;
	const previewLeaf = applyPlacement(
		ws,
		resolvePreviewLeafPlacement(ws, view.leaf),
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
