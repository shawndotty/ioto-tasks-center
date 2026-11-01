/**
 * 跨文件落点的受理判据（[[Research-20261031-204852]] §4.4 /
 * [[Plan-20261031-205655]] §四.3b）。
 *
 * 纯函数、零 DOM / 零 obsidian（`jiti` 可直导）：只吃「目标视图的可观测状态」，
 * 返回第一个命中的拒绝理由。顺序即优先级，先命中先返回。
 *
 * 不满足时 UI 只做一件事：**不画指示线**（与现有拖拽一致，不新造红色禁投态）。
 */

export type ForeignDropReject =
	| 'not-ready'
	| 'readonly'
	| 'editing'
	| 'zoomed'
	| 'section-zoomed'
	| 'filtered'
	| 'searching'
	| 'same-file';

/** 目标视图的最小结构面（`TaskViewHost` 结构性满足，单测可传假对象）。 */
export interface ForeignDropCandidate {
	file: { path: string } | null;
	data: string;
	/** 编辑态种类：`null` = 空闲（`resolveEditingKind` 的无编辑器取值）。 */
	editingKind: string | null;
	zoomLine: number | null;
	sectionZoomLine: number | null;
	filters: {
		onlyTaskBlocks: boolean;
		onlyPending: boolean;
		recentOnly: boolean;
	};
	searchQuery: string;
	supportsInlineEdit(): boolean;
}

/**
 * 判定 `dst` 能否接收来自 `srcPath` 的任务卡。
 *
 * 矩阵（先命中先返回）：`not-ready`（无文件 / 无内容）→ `readonly` → `editing`
 * → `zoomed` → `section-zoomed` → `filtered`（`onlyPending` / `recentOnly`
 * 任一）→ `searching` → `same-file`（**同一文件开两个叶子也走同文件逻辑**）。
 */
export function checkForeignDropTarget(
	dst: ForeignDropCandidate | null,
	srcPath: string,
): { ok: true } | { ok: false; reason: ForeignDropReject } {
	if (!dst || !dst.file || !dst.data) {
		return { ok: false, reason: 'not-ready' };
	}
	if (!dst.supportsInlineEdit()) {
		return { ok: false, reason: 'readonly' };
	}
	if (dst.editingKind !== null) {
		return { ok: false, reason: 'editing' };
	}
	if (dst.zoomLine !== null) {
		return { ok: false, reason: 'zoomed' };
	}
	if (dst.sectionZoomLine !== null) {
		return { ok: false, reason: 'section-zoomed' };
	}
	if (dst.filters.onlyPending || dst.filters.recentOnly) {
		return { ok: false, reason: 'filtered' };
	}
	if (dst.searchQuery.trim().length > 0) {
		return { ok: false, reason: 'searching' };
	}
	if (dst.file.path === srcPath) {
		return { ok: false, reason: 'same-file' };
	}
	return { ok: true };
}
