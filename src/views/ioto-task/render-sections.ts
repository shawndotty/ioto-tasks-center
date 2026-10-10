/**
 * Section（Block）级渲染：顶层 Section 分组、折叠头、Section body（checklist
 * + markdown 混排）、双链委托。
 *
 * 与解析层严格分离：只消费 `note-structure.ts` 的输出，不做字符串分析。
 * 从 `render-note.ts` 拆出（Phase 2）。
 */

import {
	Keymap,
	setIcon,
	type App,
	type Component,
} from 'obsidian';

import { t } from '../../lang/helpter';
import {
	collectTaskContinuations,
	dedentLines,
	isChecklistItemDone,
	parseChecklistItemsInRange,
	type NoteChecklistItem,
	type NoteSection,
} from '../../tasks-center/note-structure';
import { shouldTriggerTaskHoverPreview } from '../task-hover-preview';
import { pickRecentTopLevelLines } from './recent-task-filter';
import {
	isCardVisible,
	normalizeQuery,
	type CardVisibilityContext,
	type CardVisibilityInput,
} from './task-query-filter';
import { renderChecklistGroup, renderMarkdownChunk } from './render-checklist-card';
import type { TaskNoteEditing, TaskNoteFilters, TaskNoteLinks } from './render-note-types';

interface RenderSectionOptions {
	app: App;
	scrollEl: HTMLElement;
	content: string;
	sourcePath: string;
	component: Component;
	section: NoteSection;
	collapsedSections: Set<string>;
	onToggleSection: (key: string) => void;
	editing: TaskNoteEditing;
	filters: TaskNoteFilters;
	recentTaskCount: number;
	/** 关键词过滤（已透传；空串 = 不过滤） */
	searchQuery: string;
}

/** Section 折叠状态的稳定 key（Level + 起始行 + 标题，重排后不会错位）。 */
export function getSectionStateKey(section: NoteSection): string {
	return `${section.level}:${section.startLine}:${section.title}`;
}

/**
 * 只读态 / 选中态的双链：点击打开 + hover 预览。
 *
 * 一次委托挂在滚动容器上，同时覆盖 `.ioto-task-view__card-text`（卡片正文）与
 * `.ioto-task-view__md`（Section markdown）两处 `MarkdownRenderer` 产物
 * —— 核心不为自定义视图装这套处理（[[Research-20261004-001616]]）。
 * `renderTaskNote` 每次整树重建都会新建 `scrollEl` 并重新挂监听，旧的随 DOM 丢弃：
 * 无泄漏、无累积、不受重绘影响（[[Plan-20261004-004408]] §3.2 ③）。
 */
export function attachTaskNoteLinkDelegates(
	scrollEl: HTMLElement,
	links: TaskNoteLinks,
): void {
	const findLink = (target: EventTarget | null): HTMLAnchorElement | null =>
		target instanceof HTMLElement ? target.closest('a.internal-link') : null;

	scrollEl.addEventListener('click', (event) => {
		const link = findLink(event.target);
		const linktext = link?.getAttribute('data-href');
		if (!linktext) {
			return;
		}
		// 挡掉 <a target="_blank"> 的 window.open 默认行为
		event.preventDefault();
		// 不再冒泡到卡片的选择 / 编辑逻辑（卡片本体 click 对 a 早退是双保险）
		event.stopPropagation();
		links.open(linktext, Keymap.isModEvent(event));
	});

	scrollEl.addEventListener('mouseover', (event) => {
		const link = findLink(event.target);
		const linktext = link?.getAttribute('data-href');
		if (!link || !linktext) {
			return;
		}
		// 复用现成的 relatedTarget 去重
		if (!shouldTriggerTaskHoverPreview(event, link)) {
			return;
		}
		links.hover(event, linktext, link);
	});
}

/**
 * 顶层 Section = Block。嵌套标题（`## …`）留在父块体内，交给 MarkdownRenderer
 * 兜底渲染为分组标题；引导区（level 0）也不作为任何标题的子块。
 */
export function getTopLevelSections(sections: NoteSection[]): NoteSection[] {
	const roots: NoteSection[] = [];
	const stack: NoteSection[] = [];

	for (const section of sections) {
		while (stack.length > 0) {
			const top = stack[stack.length - 1];
			if (!top) {
				break;
			}

			if (section.level <= top.level || section.startLine > top.endLine) {
				stack.pop();
				continue;
			}

			break;
		}

		if (stack.length === 0) {
			roots.push(section);
		}

		stack.push(section);
	}

	return roots;
}

export function renderSection(options: RenderSectionOptions): void {
	const { app, scrollEl, content, sourcePath, component, section } = options;
	const { collapsedSections, onToggleSection } = options;
	const key = getSectionStateKey(section);
	const collapsed = collapsedSections.has(key);

	const sectionEl = scrollEl.createEl('section', {
		cls: 'ioto-task-view__section',
		attr: {
			'data-level': String(section.level),
			'data-start-line': String(section.startLine),
			'data-end-line': String(section.endLine),
		},
	});
	if (collapsed) {
		sectionEl.addClass('is-collapsed');
	}

	if (section.level > 0) {
		renderSectionHeader({
			sectionEl,
			section,
			collapsed,
			onToggle: () => onToggleSection(key),
			editing: options.editing,
		});
	}

	if (collapsed) {
		return;
	}

	const bodyEl = sectionEl.createDiv({ cls: 'ioto-task-view__section-body' });
	renderSectionBody({
		app,
		bodyEl,
		content,
		sourcePath,
		component,
		section,
		editing: options.editing,
		filters: options.filters,
		recentTaskCount: options.recentTaskCount,
		searchQuery: options.searchQuery,
	});
}

function renderSectionHeader(options: {
	sectionEl: HTMLElement;
	section: NoteSection;
	collapsed: boolean;
	onToggle: () => void;
	editing: TaskNoteEditing;
}): void {
	const { sectionEl, section, collapsed, onToggle, editing } = options;
	const headerEl = sectionEl.createDiv({ cls: 'ioto-task-view__section-header' });
	const toggleEl = headerEl.createEl('button', {
		cls: 'ioto-task-view__section-toggle',
		attr: {
			type: 'button',
			'aria-expanded': collapsed ? 'false' : 'true',
			'aria-label': t('view.iotoTaskView.sectionToggle', [
				section.title || t('view.iotoTaskView.fallbackTitle'),
			]),
		},
	});
	setIcon(toggleEl, collapsed ? 'chevron-right' : 'chevron-down');
	toggleEl.addEventListener('click', () => onToggle());

	headerEl.createEl(
		`h${Math.min(Math.max(section.level, 1), 6)}` as keyof HTMLElementTagNameMap,
		{
			cls: 'ioto-task-view__section-title',
			text: section.title,
		},
	);
	const actionsEl = headerEl.createDiv({
		cls: 'ioto-task-view__section-actions',
	});
	// 编辑入口 + 关闭入口（[[Plan-20261010-090233]]）：只在支持内联编辑时建按钮，
	// 只读态保持空容器。渲染层**常驻两个按钮、不判态**——两态互换由 CSS 认
	// `.ioto-task-view__section.is-editing` 驱动（唯一真源，与是否重绘无关）。
	if (editing.enabled) {
		const editBtn = actionsEl.createEl('button', {
			cls: 'ioto-task-view__section-edit-btn',
			attr: {
				type: 'button',
				'aria-label': t('view.iotoTaskView.sectionEdit'),
			},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			editing.editSection?.(section.startLine);
		});

		// 关闭 = 保存并退出（复用幂等的 `commitSectionEdit`，不新造退出路径）。
		const closeBtn = actionsEl.createEl('button', {
			cls: 'ioto-task-view__section-close-btn',
			attr: {
				type: 'button',
				'aria-label': t('view.iotoTaskView.sectionClose'),
			},
		});
		setIcon(closeBtn, 'x');
		closeBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			editing.closeSection?.(section.startLine);
		});
	}
}

function renderSectionBody(options: {
	app: App;
	bodyEl: HTMLElement;
	content: string;
	sourcePath: string;
	component: Component;
	section: NoteSection;
	editing: TaskNoteEditing;
	filters: TaskNoteFilters;
	recentTaskCount: number;
	/** 关键词过滤（已透传；空串 = 不过滤） */
	searchQuery: string;
}): void {
	const {
		app,
		bodyEl,
		content,
		sourcePath,
		component,
		section,
		editing,
		filters,
		recentTaskCount,
		searchQuery,
	} = options;
	const lines = content.split(/\r?\n/);
	const bodyStartLine =
		section.level === 0 ? section.startLine : section.startLine + 1;
	const items = parseChecklistItemsInRange(
		content,
		bodyStartLine,
		section.endLine,
		{ includeEmpty: true },
	);
	const itemByLine = new Map(items.map((item) => [item.line, item]));

	// 卡片续行：Markdown View 里在任务项下 Shift+Enter 敲出的正文，CommonMark
	// 视作该 list item 的一部分。它没有 `- [ ]` 标记，若按普通正文分块就会渲染成
	// `<ul>` 之外的孤儿 div（归属丢失）。这里取出归属，随卡片一起渲染。
	const continuationByLine = collectTaskContinuations(
		content,
		items,
		section.endLine,
	);
	const continuationMarkdown = new Map<number, string>();
	for (const item of items) {
		const continuation = continuationByLine.get(item.line);
		if (!continuation || continuation.length === 0) {
			continue;
		}
		continuationMarkdown.set(
			item.line,
			// 续行带着列表自动缩进，独立渲染时行首 ≥4 空格会被判成缩进代码块
			// （`<pre><code>`）；dedent 抹掉公共前导空白后再交给渲染器。
			dedentLines(continuation.map((index) => lines[index] ?? '').join('\n')),
		);
	}

	// ③ 只显示最近任务：每个顶层 Section 各自取末尾 N 组（口径 A：先取组、后套 onlyPending）。
	const recentLines = filters.recentOnly
		? pickRecentTopLevelLines(items, recentTaskCount)
		: null;

	// 四层过滤（①=Section 层已在外层处理；②③ + 关键词 = 卡片层）的唯一真源：
	// 「空态判定」与「逐卡 skip」共用 `isCardVisible`，避免两处漂移
	// （[[Plan-20261006-161121]] §2.2c/2.2d）。
	const normalizedQuery = normalizeQuery(searchQuery);
	const queryActive = normalizedQuery.length > 0;
	const toVisibility = (item: NoteChecklistItem): CardVisibilityInput => ({
		line: item.line,
		done: isChecklistItemDone(item),
		title: item.text,
		continuation: continuationMarkdown.get(item.line),
	});
	const visibilityCtx: CardVisibilityContext = {
		recentLines,
		onlyPending: filters.onlyPending,
		normalizedQuery,
		keepVisibleLine: editing.keepVisibleLine ?? null,
	};

	// ②/③/关键词叠加后本 Section 可见卡片数为 0：渲染空态，不再画空 `<ul>`（Q8）。
	// 文案按 `queryActive` 分流：搜索无命中 vs 全部完成（均为「本 Section 无可见卡」）。
	if (
		items.length > 0 &&
		!items.some((item) => isCardVisible(toVisibility(item), visibilityCtx))
	) {
		bodyEl.createDiv({
			cls: 'ioto-task-view__empty',
			text: queryActive
				? t('view.iotoTaskView.empty.noMatch', [searchQuery.trim()])
				: t('view.iotoTaskView.empty.allDone'),
		});
		return;
	}

	let lineIndex = bodyStartLine;
	while (lineIndex <= section.endLine) {
		const item = itemByLine.get(lineIndex);
		if (item) {
			const group: NoteChecklistItem[] = [];
			while (lineIndex <= section.endLine) {
				const nextItem = itemByLine.get(lineIndex);
				if (!nextItem) {
					break;
				}
				group.push(nextItem);
				lineIndex += 1;
				// 跳过本卡的续行：它们随卡片渲染，不能落进下面的 chunk 分支。
				const continuation = continuationByLine.get(nextItem.line);
				if (continuation && continuation.length > 0) {
					lineIndex =
						(continuation[continuation.length - 1] ?? lineIndex) + 1;
				}
			}
			renderChecklistGroup({
				app,
				bodyEl,
				items: group,
				sourcePath,
				component,
				editing,
				visibilityCtx,
				continuationMarkdown,
				continuationLines: continuationByLine,
			});
			continue;
		}

		const markdownLines: string[] = [];
		while (lineIndex <= section.endLine && !itemByLine.has(lineIndex)) {
			markdownLines.push(lines[lineIndex] ?? '');
			lineIndex += 1;
		}
		renderMarkdownChunk({
			app,
			bodyEl,
			markdown: markdownLines.join('\n'),
			sourcePath,
			component,
		});
	}
}
