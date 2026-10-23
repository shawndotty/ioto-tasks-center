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
import { sectionFoldKey } from './section-fold-key';
import {
	isCardVisible,
	normalizeQuery,
	type CardVisibilityContext,
	type CardVisibilityInput,
} from './task-query-filter';
import { renderChecklistGroup, renderMarkdownChunk } from './render-checklist-card';
import type {
	TaskCardDrag,
	TaskContinuationFold,
	TaskNoteEditing,
	TaskNoteFilters,
	TaskNoteLinks,
	TaskSectionDrag,
} from './render-note-types';

interface RenderSectionOptions {
	app: App;
	scrollEl: HTMLElement;
	content: string;
	sourcePath: string;
	component: Component;
	section: NoteSection;
	collapsedSections: Set<string>;
	/** 折叠切换：只回传 `startLine`，key 由调用方按当前 `data` 实时解析（改名后旧 key 失效）。 */
	onToggleSection: (startLine: number) => void;
	editing: TaskNoteEditing;
	filters: TaskNoteFilters;
	recentTaskCount: number;
	/** 关键词过滤（已透传；空串 = 不过滤） */
	searchQuery: string;
	/** Section 拖拽排序（缺省 = 不渲染 grip：只读 / 「只显示任务」态） */
	sectionDrag?: TaskSectionDrag;
	/** 任务卡片拖拽排序（缺省 = 不渲染 grip：只读 / 过滤 / 搜索态） */
	cardDrag?: TaskCardDrag;
	/** 续写区折叠控制器（缺省 = 全展开且不渲染箭头） */
	continuationFold?: TaskContinuationFold;
}

/**
 * Section 折叠状态的稳定 key：**Level + 标题，不含行号**（[[Plan-20261023-062616]] S2）。
 *
 * 不含行号 ⇒ 上方插入 / 删除行不会让折叠态失效（旧键 `level:startLine:title` 一加
 * 任务就掉态）；代价是改标题会掉态——与续写区「内容改了就展开」同口径，fail-open。
 * 键的构造 / 解析 / 认领全收口在 `section-fold-key.ts`。
 */
export function getSectionStateKey(section: NoteSection): string {
	return sectionFoldKey(section.level, section.title);
}

/**
 * 只读态 / 选中态的双链：点击打开 + hover 预览；外加**外部链接**的点击接管。
 *
 * 一次委托挂在滚动容器上，同时覆盖 `.ioto-task-view__card-text`（卡片正文）与
 * `.ioto-task-view__md`（Section markdown）两处 `MarkdownRenderer` 产物
 * —— 核心不为自定义视图装这套处理（[[Research-20261004-001616]]）。
 * `renderTaskNote` 每次整树重建都会新建 `scrollEl` 并重新挂监听，旧的随 DOM 丢弃：
 * 无泄漏、无累积、不受重绘影响（[[Plan-20261004-004408]] §3.2 ③）。
 *
 * 外部链接（`a.external-link`，如 `[PDF](file:///…)`）**必须一并接管**：核心只在
 * Markdown View 的预览容器上装了这条委托，自定义视图没有 → 不接管就落到
 * `<a target="_blank">` 的默认导航，被 Electron 拒载 `file://`，console 报
 * `Not allowed to load local resource`（[[Research-20261012-142746]]）。
 */
export function attachTaskNoteLinkDelegates(
	scrollEl: HTMLElement,
	links: TaskNoteLinks,
): void {
	const findLink = (
		target: EventTarget | null,
		selector: string,
	): HTMLAnchorElement | null =>
		target instanceof HTMLElement ? target.closest(selector) : null;

	scrollEl.addEventListener('click', (event) => {
		const link = findLink(event.target, 'a.internal-link');
		const linktext = link?.getAttribute('data-href');
		if (linktext) {
			// 挡掉 <a target="_blank"> 的 window.open 默认行为
			event.preventDefault();
			// 不再冒泡到卡片的选择 / 编辑逻辑（卡片本体 click 对 a 早退是双保险）
			event.stopPropagation();
			links.open(linktext, Keymap.isModEvent(event));
			return;
		}

		// 外部链接：核心同款——preventDefault 掐掉默认导航，再 `window.open` 交
		// Electron 主进程路由（http(s) → 系统浏览器，file: → 打开本体文件）。
		const external = findLink(event.target, 'a.external-link');
		const href = external?.getAttribute('href');
		if (href) {
			event.preventDefault();
			event.stopPropagation();
			links.openExternal(href);
		}
	});

	scrollEl.addEventListener('mouseover', (event) => {
		const link = findLink(event.target, 'a.internal-link');
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
			scrollEl,
			section,
			collapsed,
			onToggle: () => onToggleSection(section.startLine),
			editing: options.editing,
			sectionDrag: options.sectionDrag,
		});
	}

	if (collapsed) {
		return;
	}

	const bodyEl = sectionEl.createDiv({ cls: 'ioto-task-view__section-body' });

	// 双击正文区进「编辑本节内容」（[[Research-20261019-135324]] 方案 A）：
	// 与铅笔按钮同一条链路 `editSection`，不另造状态。
	// 🔴 必须挂在 `.section-body`（卡片与 markdown 块的共同父级），并先排除 `.card`：
	// 卡片自带「选中 → 编辑（或续行编辑）」两段式语义，不能被节编辑抢走。
	// 标题双击已被「改标题」占用，故不挂 `.section`；也不挂 `scrollEl`（要回查行号）。
	if (section.level > 0 && options.editing.enabled && options.editing.editSection) {
		bodyEl.addEventListener('dblclick', (event) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) {
				return;
			}
			// Task Item（正文 / 续行 / checkbox / 动作区 / 内联编辑器）→ 保持卡片链路。
			if (target.closest('.ioto-task-view__card')) {
				return;
			}
			// 自带点击语义的元素 → 放行（双链点一次就打开，双击不应再进节编辑）。
			if (target.closest('a, button, input, select, textarea')) {
				return;
			}
			event.preventDefault();
			options.editing.editSection?.(section.startLine);
		});
	}

	renderSectionBody({
		app,
		scrollEl,
		bodyEl,
		content,
		sourcePath,
		component,
		section,
		editing: options.editing,
		filters: options.filters,
		recentTaskCount: options.recentTaskCount,
		searchQuery: options.searchQuery,
		cardDrag: options.cardDrag,
		continuationFold: options.continuationFold,
	});
}

function renderSectionHeader(options: {
	sectionEl: HTMLElement;
	scrollEl: HTMLElement;
	section: NoteSection;
	collapsed: boolean;
	onToggle: () => void;
	editing: TaskNoteEditing;
	sectionDrag?: TaskSectionDrag;
}): void {
	const { sectionEl, scrollEl, section, collapsed, onToggle, editing, sectionDrag } =
		options;
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

	const titleEl = headerEl.createEl(
		`h${Math.min(Math.max(section.level, 1), 6)}` as keyof HTMLElementTagNameMap,
		{
			cls: 'ioto-task-view__section-title',
			text: section.title,
		},
	);
	// 标题独立编辑（[[Plan-20261019-122509]] §3.7）：双击标题、或点右缘输入框图标
	// （图标与「编辑本节内容」的铅笔刻意区分，避免同形不同义，[[Discuss-20261019-125340]]）。
	// 只监听 `dblclick`，不在 `mousedown` 阶段 preventDefault——否则第二次 click
	// 命不中同一个元素，双击永远不触发。只读态不挂事件、不建改名入口。
	if (editing.enabled && editing.editSectionTitle) {
		titleEl.addEventListener('dblclick', (event) => {
			event.preventDefault();
			event.stopPropagation();
			editing.editSectionTitle?.(section.startLine);
		});

		const titleEditBtn = headerEl.createEl('button', {
			cls: 'ioto-task-view__section-title-edit-btn',
			attr: {
				type: 'button',
				'aria-label': t('view.iotoTaskView.sectionEditTitle'),
				title: t('view.iotoTaskView.sectionEditTitle'),
			},
		});
		// `text-cursor-input`（输入框 + 光标）读作「改这段文字」，与行尾 `pencil`
		// （通用「编辑内容」）语义分工。该图标较新，而 `minAppVersion` 仍是 1.5.7：
		// 老客户端缺图标时 `setIcon` 不产 svg（按钮空白、不报错），退回极老极稳的 `type`。
		setIcon(titleEditBtn, 'text-cursor-input');
		if (!titleEditBtn.querySelector('svg')) {
			setIcon(titleEditBtn, 'type');
		}
		titleEditBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			editing.editSectionTitle?.(section.startLine);
		});
	}

	const actionsEl = headerEl.createDiv({
		cls: 'ioto-task-view__section-actions',
	});
	// 编辑入口 + 关闭入口（[[Plan-20261010-090233]]）：只在支持内联编辑时建按钮，
	// 只读态保持空容器。渲染层**常驻两个按钮、不判态**——两态互换由 CSS 认
	// `.ioto-task-view__section.is-editing` 驱动（唯一真源，与是否重绘无关）。
	if (editing.enabled) {
		// 删除入口排在最左（Johnny 2026-10-18 要求放在编辑按钮**前面**）：
		// 顺序 = 删除 → 编辑 → 放大 → 关闭 → 拖拽。缺省回调 = 能力不可用（同编辑 / 新增）。
		// 拖拽（移动）恒为最右（Johnny 2026-10-19 要求）：它与放大 / 关闭互斥隐藏，
		// 故是否可见都不影响「移动图标在最后」这一视觉口径。
		if (editing.deleteSection) {
			const deleteBtn = actionsEl.createEl('button', {
				cls: 'ioto-task-view__section-delete-btn',
				attr: {
					type: 'button',
					'aria-label': t('view.iotoTaskView.sectionDelete'),
					title: t('view.iotoTaskView.sectionDelete'),
				},
			});
			setIcon(deleteBtn, 'trash-2');
			deleteBtn.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				editing.deleteSection?.(section.startLine, section.title);
			});
		}

		const editBtn = actionsEl.createEl('button', {
			cls: 'ioto-task-view__section-edit-btn',
			attr: {
				type: 'button',
				'aria-label': t('view.iotoTaskView.sectionEdit'),
				// 与标题按钮补齐对等的 tooltip：同形按钮「一个有名字一个没名字」
				// 是误解的最大放大器（[[Discuss-20261019-125340]] §2.3）。
				title: t('view.iotoTaskView.sectionEdit'),
			},
		});
		setIcon(editBtn, 'pencil');
		editBtn.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			editing.editSection?.(section.startLine);
		});

		// 「只看本节」：布局态开关（[[Research-20261019-131228]] §4.3）。
		// 位置在编辑之后、关闭之前；同一按钮就地翻面 maximize-2 ↔ minimize-2。
		// 节编辑态由 CSS 隐藏（已隔离，避免两个开关叠加）。
		if (editing.toggleSectionZoom) {
			const zoomed = (editing.sectionZoomLine ?? null) === section.startLine;
			const zoomLabel = t(
				zoomed
					? 'view.iotoTaskView.sectionZoomOut'
					: 'view.iotoTaskView.sectionZoomIn',
			);
			const zoomBtn = actionsEl.createEl('button', {
				cls: 'ioto-task-view__section-zoom-btn',
				attr: {
					type: 'button',
					'aria-label': zoomLabel,
					title: zoomLabel,
					'aria-pressed': zoomed ? 'true' : 'false',
					'data-action': 'toggle-section-zoom',
				},
			});
			setIcon(zoomBtn, zoomed ? 'minimize-2' : 'maximize-2');
			zoomBtn.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				editing.toggleSectionZoom?.(section.startLine);
			});
			// Esc 的局部路径之一：按钮仍有焦点时可直接退出（DOM 不重建 → 焦点不丢）。
			// 🔴 必须读实时 getter：`zoomed` 是渲染期快照，切换后不会重建。
			zoomBtn.addEventListener('keydown', (event) => {
				if (
					event.key === 'Escape' &&
					(editing.sectionZoomLine ?? null) === section.startLine
				) {
					event.preventDefault();
					editing.exitSectionZoom?.();
				}
			});
		}

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

		// 拖拽手柄恒排最右（Johnny 2026-10-19 要求：放大 / 缩小等入口都得在它前面）：
		// 关闭按钮在普通态 `display: none`、放大态 grip 自身隐藏，故 grip 在两种
		// 可见组合里都落在最后一位。无文字图标，事件由手势模块接管。
		// 「只显示任务」态 controller 缺省，不渲染（与底部加号同口径）。
		if (sectionDrag) {
			const dragHandleEl = actionsEl.createEl('button', {
				cls: 'ioto-task-view__section-drag-handle',
				attr: {
					type: 'button',
					'aria-label': t('view.iotoTaskView.sectionDragHandle'),
					title: t('view.iotoTaskView.sectionDragHandle'),
					'aria-grabbed': 'false',
					draggable: 'false',
				},
			});
			setIcon(dragHandleEl, 'grip-vertical');
			sectionDrag.attachHandle(dragHandleEl, sectionEl, scrollEl);
		}
	}
}

function renderSectionBody(options: {
	app: App;
	scrollEl: HTMLElement;
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
	/** 任务卡片拖拽排序（缺省 = 不渲染 grip） */
	cardDrag?: TaskCardDrag;
	/** 续写区折叠控制器（缺省 = 全展开且不渲染箭头） */
	continuationFold?: TaskContinuationFold;
}): void {
	const {
		app,
		scrollEl,
		bodyEl,
		content,
		sourcePath,
		component,
		section,
		editing,
		filters,
		recentTaskCount,
		searchQuery,
		cardDrag,
		continuationFold,
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

	// ③ 只显示最近任务：每个顶层 Section 各自取末尾 N 组（口径 A：先取组、后套 onlyPending）；
	//    `#ioto/pin` 的组无条件并入（不占 N 配额，见 [[Plan-20261022-200135]] S2）。
	const recentLines = filters.recentOnly
		? pickRecentTopLevelLines(
				items.map((item) => ({
					line: item.line,
					indentLevel: item.indentLevel,
					pinned: item.controls.some((control) => control.kind === 'pin'),
				})),
				recentTaskCount,
			)
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
				cardDrag,
				scrollEl,
				continuationFold,
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

/**
 * Section 列表底部**唯一**的「新增 Section」入口：无文字图标加号，刻意低存在感
 * （透明度 / hover 显隐由 CSS 负责）。
 *
 * 显隐门禁在调用方 `renderTaskNote`：仅在**非「只显示任务」**且支持内联编辑
 * （`editing.addSection` 存在）时渲染一次；section 编辑隔离态 / 卡片放大态由
 * CSS `:has()` 规则隐藏。
 */
export function renderAddSectionEntry(
	scrollEl: HTMLElement,
	onAddSection: () => void,
): void {
	const label = t('view.iotoTaskView.addSection');
	const rowEl = scrollEl.createDiv({
		cls: 'ioto-task-view__section-add',
	});
	const btn = rowEl.createEl('button', {
		cls: 'ioto-task-view__section-add-btn',
		attr: {
			type: 'button',
			'aria-label': label,
			title: label,
		},
	});
	setIcon(btn, 'plus');
	btn.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		onAddSection();
	});
}
