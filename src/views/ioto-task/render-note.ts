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

import type { App, Component } from 'obsidian';

import {
	parseSections,
	sectionHasChecklist,
} from '../../tasks-center/note-structure';
import {
	attachTaskNoteLinkDelegates,
	getTopLevelSections,
	renderSection,
} from './render-sections';
// 叶子类型模块：被渲染子模块反向引用的 3 个纯类型已下沉到 `render-note-types.ts`
// （Plan-20261009-142035 §七 C-1），本文件只从叶子引类型，不再对外「持有」它们。
import type {
	TaskNoteEditing,
	TaskNoteFilters,
	TaskNoteLinks,
} from './render-note-types';

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
export type {
	TaskNoteEditing,
	TaskNoteFilters,
	TaskNoteLinks,
} from './render-note-types';
export { getSectionStateKey } from './render-sections';
export { renderCardActions } from './render-card-actions';
