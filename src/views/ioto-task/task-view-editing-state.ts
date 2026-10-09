/**
 * 编辑态判据的**唯一真源**（[[Plan-20261010-070400]] 批次 0）。
 *
 * 背景：判断「现在有没有编辑器 / 是不是卡片级编辑」的判据曾散落 13 处，各自手写
 * `editingLine !== null || continuationLine !== null` 之类的组合，加第四种编辑器
 * （Section 编辑，[[Discuss-20261010-062220]] §五 批次 1）就要回头补 13 处。
 * 这里把它们收成一张判定表：三个行号字段是真源，`kind` 由它们推导，13 处只问 kind。
 *
 * 两条实现红线：
 * 1. **判空一律 `typeof line === 'number'`**：行号 `0` 是合法值（首行），truthy 判据
 *    会漏；`.mjs` 测试桩可能没有 `sectionEditLine`（值是 `undefined`），`!== null`
 *    会把它误判成 `'section'`。
 * 2. **只看行号、不看 handle**：`beginEdit` 里存在「行号已置、handle 未置」的窗口，
 *    该窗口必须继续挡住重绘（A1 依赖）。
 *
 * 零 `obsidian` 值依赖 / 零 DOM，可被 jiti 直接导入单测（范式同源
 * `task-query-filter.ts`）。
 */

import type { TaskViewHost } from './task-view-host';

/** 当前活跃的编辑器种类；`null` = 无编辑器。 */
export type EditingKind = 'card' | 'continuation' | 'section' | null;

/** 推导 `editingKind` 所需的最小状态面（`IOTOTaskView` / `TaskViewHost` 结构性满足）。 */
export interface EditingStateHost {
	editingLine: number | null;
	continuationLine: number | null;
	sectionEditLine: number | null;
}

/**
 * 🔴 唯一真源：kind 由三个行号推导，顺序即优先级（三者互斥，先到先得）。
 *
 * 刻意**不读 handle**：行号为「意图」、handle 为「挂载结果」，判据要覆盖两者之间的
 * 窗口（见文件头红线 2）。
 */
export function resolveEditingKind(h: EditingStateHost): EditingKind {
	if (typeof h.editingLine === 'number') return 'card';
	if (typeof h.continuationLine === 'number') return 'continuation';
	if (typeof h.sectionEditLine === 'number') return 'section';
	return null;
}

/** A 组唯一真源：有任意编辑器开着吗？ */
export function hasLiveEditor(kind: EditingKind): boolean {
	return kind !== null;
}

/** B 组唯一真源：是「卡片级」编辑吗？（条目控制 / 放大 / Esc / 提交 只认这一种） */
export function isCardEditing(kind: EditingKind): boolean {
	return kind === 'card';
}

/** B4 专用：卡片或其续行正被编辑 → 该卡无条件保留可见。 */
export function isCardOrContinuationEditing(kind: EditingKind): boolean {
	return kind === 'card' || kind === 'continuation';
}

/** Section 编辑态（B3：AI 条目来源据此拒绝出条目）。 */
export function isSectionEditing(kind: EditingKind): boolean {
	return kind === 'section';
}

/**
 * 渲染层兜底用：需无条件保留的卡片行号（card=editingLine / continuation=拥有续行的
 * 任务行 / 其余 `null`）。走判定表再取值，不手写两行——否则判定表管不到渲染层。
 */
export function keepVisibleCardLine(h: EditingStateHost): number | null {
	if (!isCardOrContinuationEditing(resolveEditingKind(h))) return null;
	return h.editingLine ?? h.continuationLine;
}

/**
 * C 组收口 1：按 kind 的「提交」表。插入顺序即提交顺序（card → continuation），
 * 与重构前 `flushInlineEdits` 手写两行等价；新增第四种编辑器只改这张表。
 */
export const COMMIT_BY_KIND: Record<
	Exclude<EditingKind, null>,
	(view: TaskViewHost) => Promise<void>
> = {
	card: (view) => view.commitEdit(),
	continuation: (view) => view.commitContinuationEdit(),
	// 批次 0 尚无 Section 编辑器，恒 no-op；批次 1 接线时只改这一行。
	section: () => Promise.resolve(),
};

/** C 组收口 2：清三个行号字段（不 destroy 编辑器，由调用方先 destroy）。 */
export function resetEditingLines(view: TaskViewHost): void {
	view.editingLine = null;
	view.continuationLine = null;
	view.sectionEditLine = null;
}
