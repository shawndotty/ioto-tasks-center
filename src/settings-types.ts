import { DEFAULT_DATE_TASK_DATE_FORMAT } from './tasks-center/date-task-format';
import {
	createDefaultTaskTemplateConfigMap,
	type TaskCreationType,
	type TaskTemplateConfigMap,
} from './tasks-center/task-template-config';
import {
	DEFAULT_BATCH_TEMPLATE_CONFIG,
	type BatchTemplateConfig,
} from './tasks-center/batch-task-template';
import {
	DEFAULT_ENTRY_TEMPLATE_CONFIG,
	type EntryTemplateConfig,
} from './tasks-center/task-entry-template';
import { ENABLED_TASK_CREATION_TYPE_ORDER } from './tasks-center/enabled-task-creation-types';
import {
	DEFAULT_INPUT_ROOT_PATH,
	DEFAULT_OUTPUT_ROOT_PATH,
	DEFAULT_OUTCOME_ROOT_PATH,
	DEFAULT_TASKS_ROOT_PATH,
} from './tasks-center/types';

export type ProjectListSortMode =
	| 'incomplete-count'
	| 'incomplete-count-asc'
	| 'name'
	| 'name-desc';
export type ProjectListGroupMode = 'none' | 'category';
export type TaskListSortMode =
	| 'created-desc'
	| 'created-asc'
	| 'updated-desc'
	| 'updated-asc'
	| 'name-asc'
	| 'name-desc'
	| 'priority-desc'
	| 'priority-asc'
	/** 仅在搜索时生效：按命中相关度排列，不作为可持久化的排序设置。 */
	| 'relevance';
export type TaskListGroupMode = 'none' | 'status' | 'priority';

/** 任务搜索的入口形态：常驻内联输入框（默认）或旧的弹窗。 */
export type TaskSearchEntryMode = 'inline' | 'modal';

export type TaskListTimeFilter =
	| 'none'
	| 'created-week'
	| 'created-two-weeks'
	| 'created-month'
	| 'created-calendar-week'
	| 'created-calendar-month'
	| 'updated-week'
	| 'updated-two-weeks'
	| 'updated-month'
	| 'updated-calendar-week'
	| 'updated-calendar-month';
export type TaskLinkBadgeBackgroundMode = 'multicolor' | 'monochrome';

/**
 * IOTOTask 视图的外观风格：
 * - `glass`：玻璃拟态（Aurora 渐变 + 模糊，默认，最华丽）
 * - `modern`：现代扁平（无边框分层 + 圆角 + 极浅投影，介于 glass 与 card 之间）
 * - `simple`：简洁（白卡 + 浅灰表头带 + 发丝分隔线 + 药丸按钮，最克制）
 * - `card`：经典扁平卡片（有边框 + 左侧实心强调线，最克制）
 * - `morandi`：莫兰迪（护眼）（自带低饱和暖色板 + 宽行高 / 大字距 / 无眩光，无障碍优先）
 */
export type TaskViewAppearanceStyle =
	| 'glass'
	| 'modern'
	| 'simple'
	| 'card'
	| 'morandi';

/** 任务视图导出图片的宽度口径：跟随视图宽度（默认）或固定像素。 */
export type TaskViewExportWidthMode = 'view' | 'fixed';

/** 任务视图导出图片的运行时设置（由 `main.ts` 组装成 provider 交给视图，见 [[Plan-20261006-102142]] §2.3）。 */
export interface TaskViewExportOptions {
	widthMode: TaskViewExportWidthMode;
	fixedWidth: number;
	scale: number;
	withHeader: boolean;
	withFooter: boolean;
}

/** 固定宽度允许区间（px，[[Plan-20261006-102142]] §2.5）。 */
export const EXPORT_IMAGE_FIXED_WIDTH_MIN = 320;
export const EXPORT_IMAGE_FIXED_WIDTH_MAX = 2000;
export const DEFAULT_EXPORT_IMAGE_FIXED_WIDTH = 900;

export interface IOTOTasksCenterSettings {
	tasksRootPath: string;
	inputRootPath: string;
	outputRootPath: string;
	outcomeRootPath: string;
	projectListSortMode: ProjectListSortMode;
	projectListGroupMode: ProjectListGroupMode;
	taskListSortMode: TaskListSortMode;
	taskListGroupMode: TaskListGroupMode;
	taskListTimeFilter: TaskListTimeFilter;
	showTaskHierarchy: boolean;
	showTaskPriority: boolean;
	colorTaskTitleByPriority: boolean;
	showTaskSubtaskCount: boolean;
	showTaskNoteCoreMenu: boolean;
	showTaskNotePriorityMenu: boolean;
	taskLinkBadgeBackgroundMode: TaskLinkBadgeBackgroundMode;
	showTaskOutlinkCounts: boolean;
	showTaskInputOutlinkCount: boolean;
	showTaskOutputOutlinkCount: boolean;
	showTaskOutcomeOutlinkCount: boolean;
	hiddenProjectNames: string[];
	projectCategoryOptions: string[];
	enabledTaskCreationTypes: TaskCreationType[];
	taskTemplateConfigs: TaskTemplateConfigMap;
	dateTaskDateFormat: string;
	batchTemplateConfig: BatchTemplateConfig;
	/** Task View「条目模板」库（[[Plan-20261006-225329]] §二）。 */
	entryTemplateConfig: EntryTemplateConfig;
	taskSearchEntryMode: TaskSearchEntryMode;
	/**
	 * 在任务中心打开任务笔记时，是否默认使用 IOTOTask 任务视图（默认 false）。
	 * 仅门控「任务中心预览面板点开任务笔记」这一条自动路径；命令与右键菜单不受限。
	 */
	useIOTOTaskViewAsDefault: boolean;
	/** IOTOTask 视图外观风格（glass / modern / simple / card）。 */
	appearanceStyle: TaskViewAppearanceStyle;
	/** Task View「显示最近任务」保留的顶级任务数。 */
	recentTaskCount: number;
	/** Task View 导出图片的宽度口径（`view` 跟随视图 / `fixed` 固定 px）。 */
	exportImageWidthMode: TaskViewExportWidthMode;
	/** `exportImageWidthMode === 'fixed'` 时的宽度（px）。 */
	exportImageFixedWidth: number;
	/** 导出图片的像素倍率（1–4，步长 0.5）。 */
	exportImageScale: number;
	/** 导出图片是否带页眉（文件名 + 日期，默认关闭，[[Plan-20261006-102142]] Q3）。 */
	exportImageWithHeader: boolean;
	/** 导出图片是否带页尾（固定英文品牌标语，默认关闭，[[Discuss-20261008-091032]]）。 */
	exportImageWithFooter: boolean;
	/** Task View 桌面端是否在工具栏显示「删除」按钮（默认 false；移动端恒显示）。 */
	showTaskViewDeleteButtonOnDesktop: boolean;
}

export const DEFAULT_SETTINGS: IOTOTasksCenterSettings = {
	tasksRootPath: DEFAULT_TASKS_ROOT_PATH,
	inputRootPath: DEFAULT_INPUT_ROOT_PATH,
	outputRootPath: DEFAULT_OUTPUT_ROOT_PATH,
	outcomeRootPath: DEFAULT_OUTCOME_ROOT_PATH,
	projectListSortMode: 'incomplete-count',
	projectListGroupMode: 'none',
	taskListSortMode: 'created-desc',
	taskListGroupMode: 'none',
	taskListTimeFilter: 'none',
	showTaskHierarchy: true,
	showTaskPriority: false,
	colorTaskTitleByPriority: true,
	showTaskSubtaskCount: true,
	showTaskNoteCoreMenu: true,
	showTaskNotePriorityMenu: true,
	taskLinkBadgeBackgroundMode: 'multicolor',
	showTaskOutlinkCounts: false,
	showTaskInputOutlinkCount: true,
	showTaskOutputOutlinkCount: true,
	showTaskOutcomeOutlinkCount: true,
	hiddenProjectNames: [],
	projectCategoryOptions: [],
	enabledTaskCreationTypes: [...ENABLED_TASK_CREATION_TYPE_ORDER],
	taskTemplateConfigs: createDefaultTaskTemplateConfigMap(),
	dateTaskDateFormat: DEFAULT_DATE_TASK_DATE_FORMAT,
	batchTemplateConfig: { ...DEFAULT_BATCH_TEMPLATE_CONFIG },
	entryTemplateConfig: { ...DEFAULT_ENTRY_TEMPLATE_CONFIG },
	taskSearchEntryMode: 'inline',
	useIOTOTaskViewAsDefault: true,
	appearanceStyle: 'glass',
	recentTaskCount: 3,
	exportImageWidthMode: 'view',
	exportImageFixedWidth: DEFAULT_EXPORT_IMAGE_FIXED_WIDTH,
	exportImageScale: 2,
	exportImageWithHeader: false,
	exportImageWithFooter: false,
	showTaskViewDeleteButtonOnDesktop: false,
};

export { normalizeEnabledTaskCreationTypes } from './tasks-center/enabled-task-creation-types';

// 供 settings-options / settings-normalizers 引用，避免重复 import。
export type { TaskTemplateSourceMode } from './tasks-center/task-template-config';
