import { Notice } from 'obsidian';
import type { App } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	buildTasksSectionHeading,
	buildTopLevelTaskLine,
	findSectionByTitle,
	indentLevelOf,
	markAllChecklistItemsDone,
	parseChecklistItems,
	parseChecklistItemsInRange,
	parseSections,
	setTaskPin,
	setTaskRepeat,
	splitTaskLine,
	type NoteChecklistItem,
	type NoteSection,
} from '../../tasks-center/note-structure';
import {
	computeSwapRange,
	findSiblingTarget,
	type SwapDirection,
} from '../../tasks-center/note-task-swap';
import { buildTaskDuplicatePlan } from '../../tasks-center/note-task-duplicate';
import { DuplicateTaskModal } from '../../ui/duplicateTaskModal';
import { isTemplateAvailableForProject } from '../../tasks-center/batch-task-template';
import { extractListPropertyValuesFromContent } from '../../tasks-center/task-creation';
import {
	buildEntryTemplateLines,
	extractEntryTemplateVariables,
	renderEntryTemplate,
} from '../../tasks-center/task-entry-template';
import {
	EntryTemplateSelectModal,
	EntryTemplateVariablesModal,
} from '../../ui/entryTemplateModals';
import type { TaskViewHost } from './task-view-host';
import {
	RUN_TASK_COMMAND_ID,
	type CommandRegistryLike,
	type ToolbarButtonClickContext,
} from './task-view-constants';
import { lineAt, countContinuationLines } from './task-view-helpers';
import { runLineAction } from './task-view-editor-handlers';
import { commitBlockRange, commitTaskLineAction } from './commit-task-line';

/**
 * 命令面板 / 快捷键入口：仅转发到 `addTask`，不复制逻辑。
 * 工具栏 Shift+点击转调 `insertEntryTemplate()`
 * （[[Discuss-20261007-062838]] §六：`context` 缺省即普通添加）。
 */
export function triggerAddTask(
	view: TaskViewHost,
	context?: ToolbarButtonClickContext,
): void {
	if (context?.shiftKey) {
		void view.insertEntryTemplate();
		return;
	}
	void view.addTask();
}

/** 供 main.ts 的 checkCallback 判定命令是否可用：与按钮只读态隐藏同口径。 */
export function canAddTask(view: TaskViewHost): boolean {
	return view.file !== null && view.supportsInlineEdit();
}

/** 供 main.ts 的 checkCallback 判定「插入条目模板」命令是否可用（同 canAddTask 口径）。 */
export function canInsertEntryTemplate(view: TaskViewHost): boolean {
	return view.file !== null && view.supportsInlineEdit();
}

/**
 * 当前笔记 frontmatter 的 `Project` 值（取第一个为当前项目名）。
 * `view.data` 在 `setViewData` 之前仍是 `null`，而 `onOpen` 建工具栏时就会经
 * `hasAvailableEntryTemplate()` 走到这里 —— 若直接解引用会抛错、把 `buildToolbar()`
 * 打断在「添加」按钮之前，待 `setViewData` 再建一次就成了「两排 toolbar」
 * （[[Report-20261007-070144]]）。故先兜底成空串。
 */
export function resolveCurrentProjectNames(view: TaskViewHost): string[] {
	return extractListPropertyValuesFromContent(view.data ?? '', 'Project');
}

export function resolveCurrentSubject(view: TaskViewHost): string {
	return (
		extractListPropertyValuesFromContent(view.data ?? '', 'Subject')[0] ??
		''
	);
}

/**
 * 「插入条目模板…」主入口（[[Plan-20261006-225329]] §5.4）：
 * 门禁 → 项目过滤 → 选模板 → 收变量 → 求值/重定位 → 走 `runLineAction` 插入。
 */
export async function insertEntryTemplate(view: TaskViewHost): Promise<void> {
	if (!view.file || !view.supportsInlineEdit()) {
		return; // 只读降级：静默（同「添加任务」口径 1605-1607）
	}

	const config = view.entryTemplateProvider();
	if (!config.enabled || config.templates.length === 0) {
		new Notice(t('notice.entryTemplate.notConfigured'));
		return;
	}

	const projectNames = resolveCurrentProjectNames(view);
	const currentProject = projectNames[0] ?? '';
	const available = config.templates.filter((template) =>
		isTemplateAvailableForProject(template, currentProject),
	);
	if (available.length === 0) {
		new Notice(t('notice.entryTemplate.noTemplateForProject'));
		return;
	}

	// 锚点在提交前快照：`commitEdit` 会清掉 `editingLine`。
	const anchorLine = view.selectedLine ?? view.editingLine;
	await view.commitEdit();

	const onlyTemplate = available[0];
	const template =
		available.length === 1
			? onlyTemplate
			: await new EntryTemplateSelectModal(
					view.app,
					available,
					currentProject,
				).openAndGetValue();
	if (!template) {
		return;
	}

	const variables = extractEntryTemplateVariables(template.content);
	let values: Record<string, string> = {};
	if (variables.length > 0) {
		const collected = await new EntryTemplateVariablesModal(
			view.app,
			variables,
		).openAndGetValue();
		if (!collected) {
			return;
		}
		values = collected;
	}

	const rendered = renderEntryTemplate(template.content, values, {
		now: new Date(),
		project: currentProject,
		subject: resolveCurrentSubject(view),
	});

	if (anchorLine !== null) {
		const raw = lineAt(view, anchorLine);
		const parts = splitTaskLine(raw);
		const built = buildEntryTemplateLines(rendered, {
			line: raw,
			indentLevel: parts ? indentLevelOf(parts.indent) : 0,
			listMarker: parts?.listMarker ?? '- ',
		});
		if (built.lines.length === 0) {
			return;
		}
		const nextEditLine =
			anchorLine + 1 + countContinuationLines(view, anchorLine);
		await runLineAction(
			view,
			anchorLine,
			raw,
			(line) => [line, ...built.lines],
			nextEditLine,
			{
				insertAfterContinuations: true,
				animateRecentSwap: true,
				caretOffset: built.firstLineCursorOffset,
			},
		);
		return;
	}

	// 无锚点（极少）：退化为「追加到末条任务之后」的顶层落点，与 addTask 同口径。
	const built = buildEntryTemplateLines(rendered, {
		line: '- ',
		indentLevel: 0,
		listMarker: '- ',
	});
	if (built.lines.length === 0) {
		return;
	}
	await appendTaskBlock(view, () => built.lines, {
		caretOffset: built.firstLineCursorOffset,
	});
}

export async function addTask(view: TaskViewHost): Promise<void> {
	await appendTaskBlock(view, (referenceLine) => [
		buildTopLevelTaskLine(referenceLine, ''),
	]);
}

/**
 * 「添加任务」与「无锚点插入条目模板」共用的三段式落点：
 * 文件末条之后 → `任务` Section 段首 → 文末新建 `# 任务` 段。
 *
 * `buildNewLines(referenceLine)` 返回要追加的行（不含定位行本身）：既有的
 * 「添加任务」传「一条顶层空任务」，条目模板传模板展开后的多行。
 * 逐字保持原 `addTask` 的行为（[[Plan-20261006-225329]] §5.1）。
 */
export async function appendTaskBlock(
	view: TaskViewHost,
	buildNewLines: (referenceLine: string) => string[],
	options?: { caretOffset?: number | null },
): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) {
		return;
	}

	// 落点可能是文件级（末条任务之后 / `任务` 段首 / 文末新建段），通常不在聚焦节内：
	// 先退出「只看本节」，否则新任务插在隐藏区、用户看不到
	// （[[Research-20261019-131228]] §4.6）。
	if (view.sectionZoomLine !== null) {
		view.exitSectionZoom();
	}

	// 先落盘未提交正文，否则 runLineAction 里的 destroyActiveEditor 会丢弃它。
	await view.commitEdit();

	const items = parseChecklistItems(view.data, { includeEmpty: true });
	const last = items.length > 0 ? items[items.length - 1] : undefined;

	if (last) {
		// 文件级末条任务之后追加**顶层 0 级**任务。
		// 落点跨过末条任务的续行，避免新任务插到续行之前（同 insertSibling）。
		await runLineAction(
			view,
			last.line,
			lineAt(view, last.line),
			(raw) => [raw, ...buildNewLines(raw)],
			last.line + 1 + countContinuationLines(view, last.line),
			{
				insertAfterContinuations: true,
				animateRecentSwap: true,
				caretOffset: options?.caretOffset,
			},
		);
		return;
	}

	const section = findTasksSection(view);
	if (section) {
		// 无任务 → 在 `任务`/`Tasks` Section **段首**（标题行下一行）插入。
		await runLineAction(
			view,
			section.startLine,
			lineAt(view, section.startLine),
			(heading) => [heading, ...buildNewLines('- ')],
			section.startLine + 1,
			{
				animateRecentSwap: true,
				caretOffset: options?.caretOffset,
			},
		);
		return;
	}

	// 无 Section → 文末新建 `# 任务`（en `# Tasks`）再建任务。
	// 裸标题只用于 findTasksSection 的精确匹配（见 :1471），写进笔记时必须补 `# `，
	// 否则建出的是普通段落而非标题块。
	const sectionTitle = buildTasksSectionHeading(
		t('view.iotoTaskView.tasksSectionTitle'),
	);
	const lines = view.data.split('\n');
	const lastIndex = lines.length - 1;
	const lastLine = lines[lastIndex] ?? '';

	if (view.data.length === 0) {
		await runLineAction(
			view,
			0,
			'',
			() => [sectionTitle, ...buildNewLines('- ')],
			1,
			{
				animateRecentSwap: true,
				caretOffset: options?.caretOffset,
			},
		);
		return;
	}

	if (lastLine.trim() === '') {
		// 末行已是空行：直接复用为分隔，避免双空行。
		await runLineAction(
			view,
			lastIndex,
			lastLine,
			() => ['', sectionTitle, ...buildNewLines('- ')],
			lastIndex + 2,
			{
				animateRecentSwap: true,
				caretOffset: options?.caretOffset,
			},
		);
		return;
	}

	await runLineAction(
		view,
		lastIndex,
		lastLine,
		(raw) => [raw, '', sectionTitle, ...buildNewLines('- ')],
		lastIndex + 3,
		{
			animateRecentSwap: true,
			caretOffset: options?.caretOffset,
		},
	);
}

/** 按当前语言标题（去空白精确相等、多命中取最靠前）找 `任务`/`Tasks` Section。 */
export function findTasksSection(view: TaskViewHost): ReturnType<typeof findSectionByTitle> {
	return findSectionByTitle(
		view.data,
		t('view.iotoTaskView.tasksSectionTitle'),
	);
}

export async function runTask(view: TaskViewHost): Promise<void> {
	// 先落盘（标题 + 续写），再派发：`executeCommandById` 内部走被包装的
	// `executeCommand`，对方 `resolveRunGate` 会立刻读盘。
	await view.flushInlineEdits();

	const registry = (view.app as App & { commands?: CommandRegistryLike })
		.commands;
	if (
		!registry?.commands ||
		!(RUN_TASK_COMMAND_ID in registry.commands) ||
		!registry.executeCommandById
	) {
		new Notice(t('notice.iotoTaskView.runTaskUnavailable'));
		return;
	}

	await Promise.resolve(registry.executeCommandById(RUN_TASK_COMMAND_ID));
}

/** 供 main.ts 门控「全部标记完成」：与 canAddTask 同口径（只读态隐藏）。 */
export function canMarkAllTasksDone(view: TaskViewHost): boolean {
	return view.file !== null && view.supportsInlineEdit();
}

/**
 * Task View 侧「把当前文件所有任务标记为完成」：
 * 文件级全量（不随 `onlyPending` 等视图过滤缩小范围）；无改动即不写盘、不弹「完成」。
 * 写盘只经已登记的 `view.applyOutcome()`（CallExpression），不直写 `view.data`。
 */
export async function markAllTasksDone(view: TaskViewHost): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) {
		return; // 只读降级：静默
	}

	// ① 先落盘在册编辑器（卡片 / 续写 / Section），避免与未提交正文双写错位
	await view.flushInlineEdits();

	// ② 先判是否有改动（幂等：无改动不写盘）
	const preview = markAllChecklistItemsDone(view.data);
	if (preview.changedLines.length === 0) {
		new Notice(t('notice.markAllTasksDone.none'));
		return;
	}

	// ③ 原子读改写；回调内按「最新 content」重算（并发外部写入自洽，同 commitTaskLineAction 红线）
	let changed = 0;
	let nextContent = '';
	await view.app.vault.process(file, (content) => {
		const result = markAllChecklistItemsDone(content);
		changed = result.changedLines.length;
		nextContent = result.content;
		return result.content === content ? content : result.content;
	});

	if (changed === 0) {
		new Notice(t('notice.markAllTasksDone.none'));
		return;
	}

	// ④ 同步 data/lastLoadedText（走已登记写点）+ 重绘（对齐 runLineAction 收尾）
	view.applyOutcome({ status: 'ok', content: nextContent });
	view.renderNote(view.data);

	// ⑤ 反馈
	new Notice(t('notice.markAllTasksDone.done', [String(changed)]));
}

/* ------------------------------------------------------------------ *
 * 条目 pin 切换（[[Plan-20261022-200135]] §3 S4）
 *
 * pin 是纯视图语义（`#ioto/pin`）：只影响「显示最近任务」的保留集，
 * 不参与执行。写盘走单行原地改，行号不变。
 * ------------------------------------------------------------------ */

/** 行内是否已 pin（复用解析层，不做第二套字符串分析）。 */
function isPinnedLine(line: string): boolean {
	return (
		splitTaskLine(line)?.controls.some((control) => control.kind === 'pin') ===
		true
	);
}

/** 行内是否已 repeat（复用解析层，不做第二套字符串分析）。 */
function isRepeatedLine(line: string): boolean {
	return (
		splitTaskLine(line)?.controls.some(
			(control) => control.kind === 'repeat',
		) === true
	);
}

/** 供 main.ts 的 checkCallback 门控：有选中卡且可写。 */
export function canToggleSelectedTaskPin(view: TaskViewHost): boolean {
	return (
		view.file !== null && view.supportsInlineEdit() && view.selectedLine !== null
	);
}

/**
 * pin / repeat 的公共写回：**显式行号**，不读 `selectedLine`
 * （[[Plan-20261023-104335]] M2/M3：右键在放大态 / 正编辑另一张卡时改选不可靠）。
 *
 * ① 先落盘在册编辑器 → ② `commitTaskLineAction`（data-line 定位 + originalLine
 * 二次定位 + unchanged 短路 + conflict 三态）→ ③ `applyOutcome` + 整树重绘 + Notice。
 * 与 `indentSelected` / `deleteSelected` 同构，取代裸 `vault.process`（M4）。
 */
async function toggleTaskControl(
	view: TaskViewHost,
	line: number,
	kind: 'pin' | 'repeat',
): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) return;

	// ① 先落盘在册编辑器，避免与未提交正文双写错位（与 markAllTasksDone 同序）
	await view.flushInlineEdits();

	const transform =
		kind === 'pin'
			? (raw: string) => setTaskPin(raw, !isPinnedLine(raw))
			: (raw: string) => setTaskRepeat(raw, !isRepeatedLine(raw));

	const outcome = await commitTaskLineAction(view.app, file, {
		line,
		originalLine: view.lineAt(line),
		transform,
	});
	// 🔴 红线：data / lastLoadedText 必须同步
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}
	if (outcome.status !== 'ok') return; // unchanged：目标态已达，无写盘、无重绘

	view.renderNote(view.data);
	const nextLine = view.lineAt(line);
	new Notice(
		t(
			kind === 'pin'
				? isPinnedLine(nextLine)
					? 'notice.iotoTaskView.pinAdded'
					: 'notice.iotoTaskView.pinRemoved'
				: isRepeatedLine(nextLine)
					? 'notice.iotoTaskView.repeatAdded'
					: 'notice.iotoTaskView.repeatRemoved',
		),
	);
}

/** 右键菜单：给**指定行**加 / 去 `#ioto/pin`。 */
export async function toggleTaskPin(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	await toggleTaskControl(view, line, 'pin');
}

/** 右键菜单：给**指定行**加 / 去 `#ioto/repeat`。 */
export async function toggleTaskRepeat(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	await toggleTaskControl(view, line, 'repeat');
}

/** 命令入口（`itc-toggle-task-pin`）：语义不变，改为委托 toggleTaskPin。 */
export async function toggleSelectedTaskPin(view: TaskViewHost): Promise<void> {
	const line = view.selectedLine;
	if (!canToggleSelectedTaskPin(view) || line === null) return;
	await toggleTaskPin(view, line);
}

/* ------------------------------------------------------------------ *
 * 创建任务副本（[[Plan-20261023-145916]]）
 *
 * 写盘复用 `commitBlockRange`（一次原子区间替换），不新增写盘原语。
 * 链路照 `swapSelectedTask`：守卫 → 算块 → 原子写 → 同步 data → 重建 → 回填选中。
 * ------------------------------------------------------------------ */

/** 供 main.ts 的 checkCallback 门控：有选中卡且可写。 */
export function canDuplicateTask(view: TaskViewHost): boolean {
	return (
		view.file !== null &&
		view.supportsInlineEdit() &&
		view.selectedLine !== null
	);
}

/**
 * 把 `line` 那张卡整块复制一份（任务行 + 续写区 + 整棵子树），副本落在**块尾**。
 *
 * 有续写区时先问「是否连同续写区」，无续写区零交互直接复制。复制完只选中副本
 * 并滚入视野，**不进编辑**（Johnny 已拍板，Plan §二 #3）。
 */
export async function duplicateTask(
	view: TaskViewHost,
	line: number,
): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) {
		return; // 只读降级：静默
	}

	// ① 守卫：先落盘在册编辑器，否则复制的是旧字节
	await view.flushInlineEdits();
	// ② 守卫：放大态重绘后 restoreZoom 会停在原卡，新副本看不见
	if (view.zoomLine !== null) {
		view.exitZoom();
	}
	// ③ 守卫：撤待删除确认遮罩（与 swapSelectedTask 同序）
	view.cancelPendingDelete(false);

	// ④ 快照锚点：行号会随别的编辑漂移，原文用于弹窗关闭后的二次定位
	const originalLine = view.lineAt(line);
	if (splitTaskLine(originalLine) === null) {
		return; // 已不是任务行（stale data-line）
	}
	const ownContinuations = countContinuationLines(view, line);

	// ⑤ 有续写区才问；无续写区 → 零交互直接复制
	let includeContinuation = true;
	if (ownContinuations > 0) {
		const choice = await new DuplicateTaskModal(view.app, {
			continuationCount: ownContinuations,
		}).openAndPick();
		if (choice === null) {
			return; // 取消：不写盘
		}
		includeContinuation = choice === 'withContinuation';
	}

	// ⑥ 弹窗是长窗口：用**最新** data 重新定位 + 重算块
	const content = view.data;
	const lines = content.split('\n');
	let anchor = line;
	if (lines[anchor] !== originalLine) {
		anchor = lines.indexOf(originalLine);
		if (anchor < 0) {
			new Notice(t('notice.iotoTaskView.commitConflict'));
			await view.reloadFromVault();
			view.renderNote(view.data);
			return;
		}
	}

	const items = parseChecklistItems(content, { includeEmpty: true });
	const plan = buildTaskDuplicatePlan(content, items, anchor, {
		includeContinuation,
	});
	if (!plan) {
		new Notice(t('notice.iotoTaskView.commitConflict'));
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}

	// ⑦ 一次原子区间重写（块 = 原块 + 副本）
	const outcome = await commitBlockRange(view.app, file, {
		startLine: plan.start,
		endLine: plan.end,
		originalLines: plan.originalLines,
		nextText: plan.nextLines.join('\n'),
	});
	// 🔴 红线：data / lastLoadedText 必须同步
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}
	if (outcome.status !== 'ok') {
		return; // unchanged：理论不可达（副本必然改变文本），防御性短路
	}

	// ⑧ 结构性变更 → 整树重建 → 选中副本并滚入视野（不进编辑）
	view.selectedLine = plan.duplicateLine;
	view.renderNote(view.data, { animateRecentSwap: true });
	view.applySelection(plan.duplicateLine);
	new Notice(t('notice.iotoTaskView.duplicateCreated'));
}

/** 命令入口（`itc-duplicate-task`）：从 `selectedLine` 取行号，与 pin 家族同构。 */
export async function duplicateSelectedTask(
	view: TaskViewHost,
): Promise<void> {
	const line = view.selectedLine;
	if (!canDuplicateTask(view) || line === null) {
		return;
	}
	await duplicateTask(view, line);
}

/* ------------------------------------------------------------------ *
 * 同级任务互换（[[Plan-20261014-194115]] §4.3）
 *
 * 写盘直接复用 `commitBlockRange`（一次原子区间替换，不新增写盘原语）。
 * ------------------------------------------------------------------ */

/** Section 正文起点：引导区（level 0）从 `startLine` 起，标题块从下一行起。 */
function sectionBodyStart(section: NoteSection): number {
	return section.level === 0 ? section.startLine : section.startLine + 1;
}

/**
 * 选中行所在 **Section** 的条目（绝对行号），供同级定位；不在任何 Section → `null`。
 *
 * `parseSections` 返回含嵌套子块的升序列表，`.find` 命中**最外层**（= 渲染层的顶层
 * Section，`renderTaskNote` 只对 roots 调 `renderSection`）；`items` 一旦限定在该
 * 区间内，「不越块」即自动成立，父级搜索天然止于块首。
 */
function sectionItemsForSwap(
	view: TaskViewHost,
	line: number,
): NoteChecklistItem[] | null {
	const content = view.data ?? '';
	const section = parseSections(content).find(
		(s) => line >= sectionBodyStart(s) && line <= s.endLine,
	);
	if (!section) {
		return null;
	}
	return parseChecklistItemsInRange(
		content,
		sectionBodyStart(section),
		section.endLine,
		{ includeEmpty: true },
	);
}

/** 供 main.ts 的 checkCallback 门控：与 canAddTask 同口径，另加「有可命中的同级目标」。 */
export function canSwapSelectedTask(
	view: TaskViewHost,
	direction: SwapDirection,
): boolean {
	if (view.file === null || !view.supportsInlineEdit()) {
		return false;
	}
	const line = view.selectedLine;
	if (line === null) {
		return false;
	}
	const items = sectionItemsForSwap(view, line);
	return items !== null && findSiblingTarget(items, line, direction) !== null;
}

/**
 * 把选中卡与其**同级**上 / 下兄弟整块对调（任务行 + 续写区 + 整棵子树）。
 *
 * 链路与 `deleteSelected` 同构：守卫（落盘 / 退放大 / 撤遮罩）→ 算块区间 →
 * 一次原子区间重写 → 同步 `data` → 整树重建 → 按**重算后的新行号**回填选中。
 */
export async function swapSelectedTask(
	view: TaskViewHost,
	direction: SwapDirection,
): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) {
		return; // 只读降级：静默
	}

	// ① 守卫：先落盘在册编辑器（卡片 / 续写 / Section），否则按行号取块会取到旧字节
	await view.flushInlineEdits();
	// ② 守卫：半放大态不搬行号 —— 先退放大（对齐 runLineAction 的 exitZoom）
	if (view.zoomLine !== null) {
		view.exitZoom();
	}
	// ③ 守卫：撤待删除确认遮罩（对齐 select / applySelection）
	view.cancelPendingDelete(false);

	const current = view.selectedLine;
	if (current === null) {
		return;
	}
	const items = sectionItemsForSwap(view, current);
	if (!items) {
		return;
	}

	const target = findSiblingTarget(items, current, direction);
	if (target === null) {
		// 已是同级首 / 末条：不写盘，幂等 Notice
		new Notice(
			t(
				direction === 'next'
					? 'notice.iotoTaskView.swapNoNext'
					: 'notice.iotoTaskView.swapNoPrev',
			),
		);
		return;
	}

	const range = computeSwapRange(
		(view.data ?? '').split('\n'),
		items,
		current,
		target,
	);
	if (!range) {
		return;
	}

	const newSelectedLine =
		direction === 'next' ? range.aNewLine : range.bNewLine;

	// ④ 一次原子区间重写（range 级，绝不整篇序列化）
	const outcome = await commitBlockRange(view.app, file, {
		startLine: range.start,
		endLine: range.end,
		originalLines: range.originalLines,
		nextText: range.nextLines.join('\n'),
	});
	// 🔴 红线：data / lastLoadedText 必须同步（conflict 会弹 Notice）
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		view.renderNote(view.data);
		return;
	}
	if (outcome.status !== 'ok') {
		return; // unchanged：无写入、选中不动
	}

	// ⑤ 结构性变更 → 整树重建（带进出场动画）→ 按重算后的新行号回填选中
	view.selectedLine = newSelectedLine;
	view.renderNote(view.data, { animateRecentSwap: true });
	view.applySelection(newSelectedLine);
}
