/**
 * 子任务层级折叠（[[Plan-20261114-203739]] S1）。
 *
 * 纯函数层 = 全文层级索引 + 折叠键；DOM 应用层只动**已渲染**卡片的类 / aria，
 * 不重建 DOM、不写视图状态（状态在 `IOTOTaskView.subtasksCollapsed`）。
 * 组织范式同 `continuation-fold.ts`：纯函数零 `obsidian`，jiti 可直接导入单测。
 *
 * 🔴 折叠键**不含行号**：插入 / 删除 / 拖拽 / 续写不会让折叠态跳到别的卡上；
 * 正文哈希 + 缩进 + 同签名序号足以区分「同名父任务」。改标题即换键 → fail-open 展开。
 *
 * 🔴 索引一次覆盖整篇（不是按 Section / 按过滤结果现算）：过滤开关不会让键漂移，
 * 批量命令也能拿到被过滤掉的父键。可见性只影响「出不出箭头」。
 */

import {
	parseChecklistItems,
	parseSections,
} from '../../tasks-center/note-structure';

/** 折叠态类名（挂在父卡上；导出摘的就是它）。 */
export const SUBTASK_COLLAPSED_CLASS = 'is-subtasks-collapsed';
/** 子孙卡隐藏类（仍渲染，靠 `getClientRects()` 过滤导航）。 */
export const SUBTASK_HIDDEN_CLASS = 'is-subtasks-hidden';
/** 父卡左槽位的折叠箭头。 */
export const SUBTASK_TOGGLE_CLASS = 'ioto-task-view__subtask-toggle';
/** 折叠后的「N 项」计数条。 */
export const SUBTASK_COUNT_CLASS = 'ioto-task-view__subtask-count';

export interface SubtaskHierarchyNode {
	line: number;
	key: string;
	indent: number;
	/** 结构上的全部子孙行号（文件顺序，含被过滤的卡） */
	descendants: number[];
}

export interface SubtaskKeyIndex {
	keyByLine: Map<number, string>;
	nodeByLine: Map<number, SubtaskHierarchyNode>;
}

/** 渲染期父卡契约（由 `render-sections` 按可见性门控生成）。 */
export interface SubtaskRenderNode {
	line: number;
	key: string;
	/** 可见子孙行号（折叠时真正会消失的卡） */
	lines: number[];
	count: number;
	effectiveCollapsed: boolean;
	/** 本次强制展开（搜索 / 编辑中祖先）：批量折叠必须跳过 */
	forced: boolean;
}

/** FNV-1a 32 位 → 8 位十六进制（与续写区同算法，前缀换成 `h`）。 */
function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, '0');
}

/**
 * 全文层级索引：行号 → 折叠键 / 子孙行号。
 *
 * - 层级只按缩进（`indentLevel`），视图级语义 =「缩进更深就是子任务」；
 * - 标题是硬边界：`## 子标题` 之后的缩进任务不再归上一个父任务；
 * - 行号不进键，序号只按「同缩进 + 同正文哈希」计数。
 */
export function buildSubtaskKeyIndex(content: string): SubtaskKeyIndex {
	const items = parseChecklistItems(content, { includeEmpty: true });
	const headingLines = parseSections(content)
		.filter((section) => section.level > 0)
		.map((section) => section.startLine)
		.sort((a, b) => a - b);

	const keyByLine = new Map<number, string>();
	const nodeByLine = new Map<number, SubtaskHierarchyNode>();
	const ordinalBySignature = new Map<string, number>();
	const stack: SubtaskHierarchyNode[] = [];
	let headingCursor = 0;

	for (const item of items) {
		while (
			headingCursor < headingLines.length &&
			(headingLines[headingCursor] ?? 0) < item.line
		) {
			stack.length = 0;
			headingCursor += 1;
		}
		while (
			stack.length > 0 &&
			(stack[stack.length - 1] as SubtaskHierarchyNode).indent >=
				item.indentLevel
		) {
			stack.pop();
		}

		const hash = fnv1a(item.text);
		const signature = `${item.indentLevel}:${hash}`;
		const ordinal = ordinalBySignature.get(signature) ?? 0;
		ordinalBySignature.set(signature, ordinal + 1);
		const key = `h:${item.indentLevel}:${hash}:${ordinal}`;

		const node: SubtaskHierarchyNode = {
			line: item.line,
			key,
			indent: item.indentLevel,
			descendants: [],
		};
		// 推给**所有**祖先：否则折叠根节点只隐藏直接子级、漏掉孙级。
		for (const ancestor of stack) {
			ancestor.descendants.push(item.line);
		}
		stack.push(node);
		keyByLine.set(item.line, key);
		nodeByLine.set(item.line, node);
	}

	return { keyByLine, nodeByLine };
}

/** 全文件「有子孙」的父任务键（批量命令与命令门禁用，不扫 DOM）。 */
export function collectSubtaskFoldKeys(content: string): string[] {
	const { nodeByLine } = buildSubtaskKeyIndex(content);
	const keys: string[] = [];
	for (const node of nodeByLine.values()) {
		if (node.descendants.length > 0) {
			keys.push(node.key);
		}
	}
	return keys;
}

/** `data-sub-lines` → 行号数组（过滤非数字 / 空段）。 */
export function readSubtaskLines(dataset: {
	subLines?: string | undefined;
}): number[] {
	const raw = dataset.subLines ?? '';
	if (raw.length === 0) {
		return [];
	}
	const lines: number[] = [];
	for (const part of raw.split(',')) {
		if (part.length === 0) {
			continue;
		}
		const line = Number(part);
		if (Number.isFinite(line)) {
			lines.push(line);
		}
	}
	return lines;
}

/** 只动父卡的类 + 箭头 aria / tooltip；不重建 DOM、不写状态。 */
export function applySubtaskFoldState(
	cardEl: HTMLElement,
	collapsed: boolean,
): void {
	cardEl.classList.toggle(SUBTASK_COLLAPSED_CLASS, collapsed);
	const toggleEl = cardEl.querySelector<HTMLElement>(
		`.${SUBTASK_TOGGLE_CLASS}`,
	);
	toggleEl?.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
	// 两条文案都预先挂在 DOM 上，供纯模块切换（避免纯模块引 i18n）。
	const label = collapsed
		? toggleEl?.dataset.labelCollapsed
		: toggleEl?.dataset.labelExpanded;
	if (toggleEl && label) {
		toggleEl.setAttribute('aria-label', label);
		toggleEl.setAttribute('title', label);
	}
}

/**
 * 按「所有仍然是折叠态的父卡」重算隐藏集合。
 *
 * 🔴 展开不能只摘自己子孙的隐藏类：父级 P 折叠时把子级 C 与孙级 G 一起隐藏；
 * 若 C 自己也是折叠态，展开 P 后 C 应出现、G 应继续隐藏。先清空再全量重算，
 * 嵌套态互不覆盖。
 */
export function syncSubtaskVisibility(root: ParentNode): void {
	root.querySelectorAll<HTMLElement>(
		`.ioto-task-view__card.${SUBTASK_HIDDEN_CLASS}`,
	).forEach((card) => card.classList.remove(SUBTASK_HIDDEN_CLASS));

	const cardsByLine = new Map<string, HTMLElement>();
	root.querySelectorAll<HTMLElement>('.ioto-task-view__card[data-line]').forEach(
		(card) => cardsByLine.set(card.dataset.line ?? '', card),
	);

	root.querySelectorAll<HTMLElement>(
		`.ioto-task-view__card.${SUBTASK_COLLAPSED_CLASS}[data-sub-lines]`,
	).forEach((parent) => {
		for (const line of readSubtaskLines(parent.dataset)) {
			cardsByLine.get(String(line))?.classList.add(SUBTASK_HIDDEN_CLASS);
		}
	});
}
