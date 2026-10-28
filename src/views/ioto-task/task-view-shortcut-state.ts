/**
 * 「打开面板瞬间的状态」→ 该高亮哪个键位分组（[[Plan-20261028-142008]]）。
 *
 * 🔴 语义是**快照**，不是实时：核心 `Modal` 打开即夺焦，卡片/续写/节编辑器随即
 *    blur 提交并销毁，搜索框也失去焦点 —— 进 `onOpen` 再读只会读到「什么都没开」。
 *    所以快照必须在 `new ShortcutHelpModal(...).open()` 之前取
 *    （唯一入口 `shortcutHelpModal.ts` 的 `openShortcutHelpModal`）。
 *
 * 本模块**不 import obsidian**（只 `import type`），`doc` 由调用方传入而不是读全局
 * `activeDocument`，可被 jiti 直接单测。
 */

import type { EditingKind } from './task-view-editing-state';
import type { ShortcutGroupId } from './task-view-shortcut-spec';

/** 判据所需的最小状态面（`IOTOTaskView` / `TaskViewHost` 结构性满足）。 */
export interface ShortcutStateSource {
	readonly editingKind: EditingKind;
	zoomLine: number | null;
	selectedLine: number | null;
	pendingDeleteLine: number | null;
	searchInputEl: HTMLInputElement | null;
}

/** 折成 5 个布尔/枚举后的快照：映射函数只认它，不再碰视图字段。 */
export interface ShortcutStateInput {
	editingKind: EditingKind;
	zoomed: boolean;
	selected: boolean;
	deletePending: boolean;
	searchFocused: boolean;
}

export function captureShortcutState(
	source: ShortcutStateSource,
	doc: Pick<Document, 'activeElement'>,
): ShortcutStateInput {
	return {
		editingKind: source.editingKind,
		zoomed: source.zoomLine !== null,
		selected: source.selectedLine !== null,
		deletePending: source.pendingDeleteLine !== null,
		searchFocused:
			source.searchInputEl !== null &&
			doc.activeElement === source.searchInputEl,
	};
}

/**
 * 🔴 唯一真源：优先级自上而下，先命中先返回（逐条理由见 Plan §3.1）。
 * 返回类型是联合类型 → id 打错字编译期就炸；新增组也会在 switch 处被要求补全。
 */
export function resolveCurrentShortcutGroupId(
	input: ShortcutStateInput,
): ShortcutGroupId {
	if (input.deletePending) return 'deleteConfirm';
	if (input.searchFocused) return 'search';
	switch (input.editingKind) {
		case 'card':
			return 'editTitle';
		case 'continuation':
			return 'continuation';
		case 'section':
		case 'section-title':
			return 'section';
		case null:
			break;
	}
	if (input.selected && !input.zoomed) return 'select';
	return 'view';
}
