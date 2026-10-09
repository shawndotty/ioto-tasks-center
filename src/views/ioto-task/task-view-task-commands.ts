import { Notice } from 'obsidian';
import type { App } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	buildTasksSectionHeading,
	buildTopLevelTaskLine,
	findSectionByTitle,
	indentLevelOf,
	parseChecklistItems,
	splitTaskLine,
} from '../../tasks-center/note-structure';
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
import type { IOTOTaskView } from '../iotoTaskView';
import {
	RUN_TASK_COMMAND_ID,
	type CommandRegistryLike,
	type ToolbarButtonClickContext,
} from './task-view-constants';
import { lineAt, countContinuationLines } from './task-view-helpers';
import { runLineAction } from './task-view-editor-handlers';

/**
 * 命令面板 / 快捷键入口：仅转发到 `addTask`，不复制逻辑。
 * 工具栏 Shift+点击转调 `insertEntryTemplate()`
 * （[[Discuss-20261007-062838]] §六：`context` 缺省即普通添加）。
 */
export function triggerAddTask(
	view: IOTOTaskView,
	context?: ToolbarButtonClickContext,
): void {
	if (context?.shiftKey) {
		void view.insertEntryTemplate();
		return;
	}
	void view.addTask();
}

/** 供 main.ts 的 checkCallback 判定命令是否可用：与按钮只读态隐藏同口径。 */
export function canAddTask(view: IOTOTaskView): boolean {
	return view.file !== null && view.supportsInlineEdit();
}

/** 供 main.ts 的 checkCallback 判定「插入条目模板」命令是否可用（同 canAddTask 口径）。 */
export function canInsertEntryTemplate(view: IOTOTaskView): boolean {
	return view.file !== null && view.supportsInlineEdit();
}

/**
 * 当前笔记 frontmatter 的 `Project` 值（取第一个为当前项目名）。
 * `view.data` 在 `setViewData` 之前仍是 `null`，而 `onOpen` 建工具栏时就会经
 * `hasAvailableEntryTemplate()` 走到这里 —— 若直接解引用会抛错、把 `buildToolbar()`
 * 打断在「添加」按钮之前，待 `setViewData` 再建一次就成了「两排 toolbar」
 * （[[Report-20261007-070144]]）。故先兜底成空串。
 */
export function resolveCurrentProjectNames(view: IOTOTaskView): string[] {
	return extractListPropertyValuesFromContent(view.data ?? '', 'Project');
}

export function resolveCurrentSubject(view: IOTOTaskView): string {
	return (
		extractListPropertyValuesFromContent(view.data ?? '', 'Subject')[0] ??
		''
	);
}

/**
 * 「插入条目模板…」主入口（[[Plan-20261006-225329]] §5.4）：
 * 门禁 → 项目过滤 → 选模板 → 收变量 → 求值/重定位 → 走 `runLineAction` 插入。
 */
export async function insertEntryTemplate(view: IOTOTaskView): Promise<void> {
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

export async function addTask(view: IOTOTaskView): Promise<void> {
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
	view: IOTOTaskView,
	buildNewLines: (referenceLine: string) => string[],
	options?: { caretOffset?: number | null },
): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) {
		return;
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
export function findTasksSection(view: IOTOTaskView): ReturnType<typeof findSectionByTitle> {
	return findSectionByTitle(
		view.data,
		t('view.iotoTaskView.tasksSectionTitle'),
	);
}

export async function runTask(view: IOTOTaskView): Promise<void> {
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
