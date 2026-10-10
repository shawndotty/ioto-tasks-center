/**
 * 任务笔记的结构解析原语 —— barrel 入口。
 *
 * 本文件不再包含实现，仅 re-export 五个子域，保持 `from '.../note-structure'`
 * 的外部引用路径不变（5 个源文件 + 6 个测试文件均经此 barrel 导入）。
 *
 * 子域拆分（均纯字符串 / 零 DOM / 零 obsidian 依赖）：
 * - `note-controls`：控制项扫描（depends / agent / model / fanout / turns）
 * - `note-sections`：Section 解析（frontmatter / 围栏 / 标题 / 引导区）
 * - `note-task-line`：任务行拆分 / 重组 / 缩进 / 勾选等编辑原语
 * - `note-checklist`：Checklist 条目解析与 Section 过滤谓词
 * - `note-continuation`：卡片续行识别与列宽感知去缩进
 *
 * 三条解析口径（与 [[Plan-20261002-200615]] §5.1 一致）：
 * 1. frontmatter 整段排除，不算 Section；其后的引导正文单独成 level = 0 的块。
 * 2. 标题只在「非代码围栏 / 非注释」的行里才算。
 * 3. 每块带精确行范围（0 基、闭区间），供后续行级写回做外科手术。
 */

export type {
	ControlKind,
	ControlToken,
} from './note-controls';
export { splitDisplayText } from './note-controls';

export type {
	NoteSection,
	CommentScanState,
	CommentScanResult,
} from './note-sections';
export {
	FENCE_PATTERN,
	stripCommentContentFromLine,
	parseSections,
	findSectionByTitle,
} from './note-sections';

export type { TaskLineParts } from './note-task-line';
export {
	TASK_LINE_PATTERN,
	indentLevelOf,
	computeIndentLevel,
	splitTaskLine,
	continuationIndentForTaskLine,
	indentContinuationLines,
	taskBodyForEditor,
	composeTaskLine,
	replaceTaskBody,
	SOFT_BREAK,
	insertSoftBreak,
	toggleTaskMarker,
	markTaskLineDone,
	setTaskIndent,
	buildSiblingTaskLine,
	buildTasksSectionHeading,
	buildTopLevelTaskLine,
} from './note-task-line';

export type {
	NoteChecklistItem,
	ParseChecklistOptions,
} from './note-checklist';
export {
	parseChecklistItems,
	parseChecklistItemsInRange,
	markAllChecklistItemsDone,
	isChecklistItemDone,
	sectionHasChecklist,
} from './note-checklist';

export {
	isTaskContinuationLine,
	parentIndentLevelOfTaskLine,
	collectTaskContinuations,
	dedentContinuationLines,
	dedentLines,
	commonIndentPrefix,
} from './note-continuation';
