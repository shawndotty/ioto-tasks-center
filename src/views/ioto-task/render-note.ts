/**
 * IOTOTask 视图的渲染层：把任务笔记的 Section（Block）与 checklist（卡片）画成 DOM。
 *
 * 与解析层严格分离：这里只消费 `note-structure.ts` 的输出，不自己做字符串分析。
 * DOM 上挂 `data-level` / `data-start-line` / `data-end-line` / `data-line` /
 * `data-task` / `data-indent` / `data-task-key` 等属性，是 Phase 2/3 挂按钮与
 * 行级写回的契约。
 *
 * `data-line` 是**真实文件行号**（删/插后会整体漂移），只作写回定位用；
 * `data-indent` + `data-task-key`（源码文本）是「最近任务」进出场动效的身份键
 * （[[Plan-20261005-150106]] §2.3），不参与编辑/导航。
 *
 * Phase 2 拆分后本文件是 barrel + 主入口：类型定义 + `renderTaskNote` 主流程 +
 * 移动端滚动上报，具体渲染逻辑在子模块（`render-sections` / `render-checklist-card`
 * / `render-card-actions` / `render-card-keybind` / `render-control-badges`）。
 */

import type { App, Component, PaneType } from 'obsidian';

import {
	parseSections,
	sectionHasChecklist,
} from '../../tasks-center/note-structure';
import {
	attachTaskNoteLinkDelegates,
	getTopLevelSections,
	renderSection,
} from './render-sections';

/** 编辑交互回调（由 `IOTOTaskView` 注入；只读态 `enabled = false`）。 */
export interface TaskNoteEditing {
	readonly enabled: boolean;
	/**
	 * 当前处于**选择态**的行号（0 基文件行号）。
	 *
	 * 🔴 必须是 getter：渲染层在 click / keydown 闭包里读实时值；若建成普通属性
	 * 会捕获构建那一刻的旧值，导致「第二次点击进编辑」永远判不出来
	 * （[[Plan-20261003-194909]] §5.1a）。
	 */
	readonly selectedLine: number | null;
	/** 只选中（`idle → selected`）：加类 + 聚焦，不建编辑器 */
	select(line: number): void;
	/** 删除该行，并把选择落到相邻卡片（`selected → selected/null`） */
	delete(line: number): void;
	/**
	 * 取消「待删除确认」瞬态（pending 时有效）；缺省 = 该能力不可用。
	 * 供取消按钮 / `Esc` 调用（[[Plan-20261005-141853]] 步骤 6）。
	 */
	cancelDelete?(): void;
	/**
	 * 是否正处于「待删除确认」瞬态（getter，读实时值，供 keydown 路由）。
	 *
	 * 🔴 必须是 getter：渲染层在 keydown 闭包里读实时值；普通属性会捕获构建那一刻
	 * 的旧值，pending 判定永远失效（同 `selectedLine`）。
	 */
	readonly deletePending?: boolean;
	/**
	 * 当前处于**编辑态**的文件行号（getter，读实时值）；非编辑态 `null`。
	 *
	 * 🔴 必须是 getter：图层在渲染时读实时值。用于关键词过滤里「编辑中的卡无条件保留」
	 * 的兜底判定——与 `selectedLine`（仅选中）区分，避免把「仅选中、未编辑」的卡也保留
	 * （[[Plan-20261006-161121]] §2.2e）。
	 */
	readonly editingLine?: number | null;
	/** 进入卡片正文内联编辑（同时会提交上一张正在编辑的卡片） */
	beginEdit(line: number): void;
	/**
	 * 点续行块：进入该卡续行的就地多行编辑（会先提交正在编辑的标题 / 其它续行）。
	 */
	beginContinuationEdit(line: number): void;
	/**
	 * 选择态 `Shift+Enter`：在 `line` 下方插入一张同级空卡片，并进入其编辑态。
	 * 与编辑态 `Enter` 的「新建同级」同源，只是不拆分当前正文。
	 */
	insertSibling(line: number): void;
	/**
	 * 选择态 `Tab` / `Shift+Tab`：对 `line` 做 ±1 级缩进（`delta = +1 / -1`）。
	 * 与编辑态 `onIndent` 同源（`setTaskIndent`），只是不进入编辑器。
	 */
	indent(line: number, delta: number): void;
	/** 3a 勾选：点 checkbox ↔ 行内 `[ ]` / `[x]`（乐观更新由调用方负责） */
	toggleTask(line: number, cardEl: HTMLElement): void;
	/**
	 * 派发「插入出链」命令（`ioto-settings:ioto-insert-outgoing-link`）。
	 * **缺省 = 按钮不渲染**：天然表达「命令未注册 / 只读态 → 隐藏按钮」
	 * （[[Plan-20261005-111411]] §三 步骤 1，坑 E）。
	 */
	insertOutgoingLink?(line: number): void;
	/**
	 * 派发「编辑条目控制」命令（`ioto-settings:ioto-edit-item-controls`）。
	 * **缺省 = 按钮不渲染**（同上）。
	 */
	editItemControls?(line: number): void;
	/**
	 * 当前处于「聚焦放大」态的文件行号（getter，读实时值）；非放大态 `null`。
	 * 与 `editingLine` 同源——放大只在编辑态存在，故通常等于 `editingLine`。
	 */
	readonly zoomLine?: number | null;
	/**
	 * 切换「聚焦放大」：对同一行再次调用即缩小（幂等，纯 DOM 开关，不重绘）。
	 * **缺省 = 按钮不渲染**（只读 / 不支持内联编辑时不显示放大按钮）。
	 */
	toggleZoom?(line: number): void;
	/**
	 * 放大态点击卡片：把焦点交还内嵌编辑器（[[Discuss-20261008-173935]] 方案 A）。
	 * 放大卡点击一律走这里——不走「未选中 → 先选中」两段式，也不回落选中态。
	 * **缺省 = 放大不可用**（只读 / 不支持内联编辑时不显示放大按钮）。
	 */
	focusZoomEditor?(line: number): void;
}

/** 链接交互回调（由 `IOTOTaskView` 注入；只读态同样生效）。 */
export interface TaskNoteLinks {
	/** 打开双链：`newLeaf` = 核心同款叶子类型（`Keymap.isModEvent` 的结果） */
	open(linktext: string, newLeaf: PaneType | boolean): void;
	/** 触发核心 hover 预览（修饰键判断交给核心） */
	hover(event: MouseEvent, linktext: string, targetEl: HTMLElement): void;
}

/** 视图过滤开关（[[Plan-20261004-110845]] 批次 B/C）。真源在笔记 frontmatter。 */
export interface TaskNoteFilters {
	/** ① 只显示任务区块：无任务列表的顶层 Section 整块隐藏 */
	onlyTaskBlocks: boolean;
	/** ② 只显示未完成任务：隐藏 `[x]` 卡片（空 Section 仍保留） */
	onlyPending: boolean;
	/** ③ 只显示最近任务：每个 Section 只保留末尾 N 个顶级任务（含其子任务） */
	recentOnly: boolean;
}

export interface RenderTaskNoteOptions {
	app: App;
	containerEl: HTMLElement;
	content: string;
	/** 渲染 wikilink / 嵌入时的来源路径 */
	sourcePath: string;
	component: Component;
	collapsedSections: Set<string>;
	onToggleSection: (key: string) => void;
	editing: TaskNoteEditing;
	/** 卡片正文与 Section markdown 里双链的点击 / hover 接管方 */
	links: TaskNoteLinks;
	/** 过滤开关（缺省视为全关，兼容旧调用） */
	filters?: TaskNoteFilters;
	/** ③「只显示最近任务」保留的顶级任务数（缺省 3） */
	recentTaskCount?: number;
	/** 关键词过滤的瞬态输入（**不进 `TaskNoteFilters`**，不落盘）。缺省 = 不过滤。 */
	searchQuery?: string;
}

export function renderTaskNote(options: RenderTaskNoteOptions): void {
	const { containerEl, content } = options;
	const filters: TaskNoteFilters = options.filters ?? {
		onlyTaskBlocks: false,
		onlyPending: false,
		recentOnly: false,
	};
	const recentTaskCount = options.recentTaskCount ?? 3;
	const searchQuery = options.searchQuery ?? '';
	const sections = parseSections(content);
	const scrollEl = containerEl.createDiv({ cls: 'ioto-task-view__scroll' });
	reportScrollToMobileNavbar(options.app, scrollEl);
	attachTaskNoteLinkDelegates(scrollEl, options.links);

	let roots = getTopLevelSections(sections);
	if (filters.onlyTaskBlocks) {
		// ① 只显示任务区块：纯渲染期过滤，`data-line` 仍是真实文件行号，
		// 编辑 / 删除 / 导航不受影响。
		roots = roots.filter((section) => sectionHasChecklist(content, section));
	}

	for (const section of roots) {
		renderSection({
			...options,
			scrollEl,
			section,
			filters,
			recentTaskCount,
			searchQuery,
		});
	}
}

/** 核心 `app.mobileNavbar` 的鸭子类型面（不在 obsidian.d.ts 公开面）。 */
interface MobileNavbarLike {
	onScroll?: (containerEl: Element, scrollTop: number) => void;
}

/**
 * 1-A：把内层滚动容器的滚动上报给核心，驱动 `.mobile-navbar` 的「下滑隐藏 / 上滑恢复」。
 * 核心内部 API（[[Research-20261007-105032]] §四 1-A）→ 存在性判断 + 静默降级：
 * 桌面或未来核心移除该 API 时，1-B 的底部留白仍是兜底。
 * 监听随每次 render 新建的 scrollEl 一起丢弃 → 无累积、无泄漏（同 :216 的委托口径）。
 */
function reportScrollToMobileNavbar(app: App | undefined, scrollEl: HTMLElement): void {
	const navbar = (app as unknown as { mobileNavbar?: MobileNavbarLike } | undefined)
		?.mobileNavbar;
	if (typeof navbar?.onScroll !== 'function') {
		return;
	}
	const onScroll = navbar.onScroll.bind(navbar);
	scrollEl.addEventListener('scroll', () => {
		onScroll(scrollEl, scrollEl.scrollTop);
	});
}

// Barrel re-exports：保持外部 import 路径不变（零破坏）
export { getSectionStateKey } from './render-sections';
export { renderCardActions } from './render-card-actions';
