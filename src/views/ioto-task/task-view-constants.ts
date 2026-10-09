import type { TFile } from 'obsidian';
import { Platform } from 'obsidian';

import type { CommitOutcome } from './commit-task-line';
import type { TaskNoteFilters } from './render-note-types';

/** 自动落盘窗口：与核心 2000ms 对齐；移动端 I/O 与电量敏感，放宽一档。 */
export const AUTOSAVE_INTERVAL_MS = Platform.isMobile ? 4000 : 2000;

/** 关键词实时过滤的输入 debounce（[[Discuss-20261006-160043]] §六 Q2）。 */
export const SEARCH_DEBOUNCE_MS = 200;

/** 过滤开关的 frontmatter 属性名（唯一真源，[[Plan-20261004-110845]] §二.1）。 */
export const PROPERTY_ONLY_TASK_BLOCKS = 'iotoTaskViewOnlyTaskBlocks';
export const PROPERTY_ONLY_PENDING = 'iotoTaskViewOnlyPending';
export const PROPERTY_RECENT_ONLY = 'iotoTaskViewRecentOnly';

/**
 * 过滤开关 → frontmatter 属性名映射（`toggleFilter` 的写盘真源）。
 * 开关新增时只需在此登记，写盘 / 补齐逻辑自动覆盖（[[Plan-20261005-101007]] §2.7）。
 */
export const FILTER_PROPERTY_NAMES: Record<keyof TaskNoteFilters, string> = {
	onlyTaskBlocks: PROPERTY_ONLY_TASK_BLOCKS,
	onlyPending: PROPERTY_ONLY_PENDING,
	recentOnly: PROPERTY_RECENT_ONLY,
};

/** ③「执行任务」由 ioto-settings 注册的命令 ID（按钮只派发，粒度交给对方）。 */
export const RUN_TASK_COMMAND_ID = 'ioto-settings:ioto-run-task';

/** 卡片动作区「插入出链」按钮派发的命令 ID（[[Plan-20261005-111411]] §三 步骤 4）。 */
export const INSERT_OUTGOING_LINK_COMMAND_ID =
	'ioto-settings:ioto-insert-outgoing-link';

/** 卡片动作区「编辑条目控制」按钮派发的命令 ID（同上）。 */
export const EDIT_ITEM_CONTROLS_COMMAND_ID = 'ioto-settings:ioto-edit-item-controls';

/**
 * 命令就绪补偿轮询间隔（[[Research-20261008-122828]] 方案 A）。
 *
 * ioto-settings 在 `onload` 后固定延迟 1s 才注册上述两条命令；视图若落在这 1s
 * 窗口内渲染，前两个动作按钮会因命令缺位而不被创建，且此后不重绘就一直残缺。
 */
export const COMMAND_READINESS_POLL_MS = 120;

/** 命令就绪补偿等待上限：超时保持隐藏（ioto-settings 未启用时的既有语义）。 */
export const COMMAND_READINESS_TIMEOUT_MS = 5000;

/** `app.commands` 的最小可判定形状（照抄 task-creation.ts 的 `CommandRegistryLike` 口径）。 */
export interface CommandRegistryLike {
	executeCommandById?: (commandId: string) => unknown;
	commands?: Record<string, unknown>;
}

/**
 * 工具栏按钮 `click` 回调拿到的指针上下文（[[Discuss-20261007-062838]] §三.②）。
 * `shiftKey` 只在**真实指针**按下时为真，键盘激活合成的 click 恒为 false。
 */
export interface ToolbarButtonClickContext {
	shiftKey: boolean;
}

/** IOTOTask 视图供「条目控制」桥接读写当前编辑卡片的宿主（见 item-control-bridge.ts）。 */
export interface ItemControlBridgeHost {
	/** 视图打开的任务文件（必须是真 `TFile`，满足 ioto-settings 的 `instanceof` 判据） */
	file: TFile;
	/** 当前内联编辑行的 0 基**文件行号**（面板据此定位，不是卡片内的相对行号） */
	line: number;
	/** 打开编辑时的原始整行（写回时的冲突二次定位基线） */
	originalLine: string;
	/** 面板要读的整行：磁盘行 + 未提交的 CM 正文合成（`replaceTaskBody`） */
	readBridgeLine(): string;
	/** 除编辑行外的其它行按磁盘内容返回 */
	readDiskLine(line: number): string;
	/** 面板确认后的新整行 → 落盘并同步 `data` / `lastLoadedText` / `editingOriginalLine` */
	commitBridgeLine(nextLine: string): Promise<CommitOutcome>;
	/** 供面板定位：该行卡片的视口坐标 */
	getLineCoords(line: number): {
		top: number;
		left: number;
		bottom: number;
		right: number;
	};
	/** 视图滚动容器宽度（面板用它约束自身宽度） */
	getScrollWidth(): number;
}
