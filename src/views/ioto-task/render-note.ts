/**
 * IOTOTask 视图的渲染层：把任务笔记的 Section（Block）与 checklist（卡片）画成 DOM。
 *
 * 与解析层严格分离：这里只消费 `note-structure.ts` 的输出，不自己做字符串分析。
 * DOM 上挂 `data-level` / `data-start-line` / `data-end-line` / `data-line` /
 * `data-task` / `data-indent` 等属性，是 Phase 2/3 挂按钮与行级写回的契约。
 */

import { MarkdownRenderer, setIcon, type App, type Component } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	collectTaskContinuations,
	dedentLines,
	isChecklistItemDone,
	parseChecklistItemsInRange,
	parseSections,
	sectionHasChecklist,
	type ControlKind,
	type ControlToken,
	type NoteChecklistItem,
	type NoteSection,
} from '../../tasks-center/note-structure';
import { isOverlayFocusTarget } from './embedded-editor';
import { resolveDeleteConfirmKey } from './delete-confirm';
import {
	collectCardLines,
	pickAdjacentLine,
	pickEdgeLine,
} from './card-navigation';
import { pickRecentTopLevelLines } from './recent-task-filter';
import { shouldTriggerTaskHoverPreview } from '../task-hover-preview';

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
}

/** 链接交互回调（由 `IOTOTaskView` 注入；只读态同样生效）。 */
export interface TaskNoteLinks {
	/** 打开双链：`newTab` = 按了 Cmd/Ctrl */
	open(linktext: string, newTab: boolean): void;
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
}

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
}

/** Section 折叠状态的稳定 key（Level + 起始行 + 标题，重排后不会错位）。 */
export function getSectionStateKey(section: NoteSection): string {
	return `${section.level}:${section.startLine}:${section.title}`;
}

export function renderTaskNote(options: RenderTaskNoteOptions): void {
	const { containerEl, content } = options;
	const filters: TaskNoteFilters = options.filters ?? {
		onlyTaskBlocks: false,
		onlyPending: false,
		recentOnly: false,
	};
	const recentTaskCount = options.recentTaskCount ?? 3;
	const sections = parseSections(content);
	const scrollEl = containerEl.createDiv({ cls: 'ioto-task-view__scroll' });
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
		});
	}
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
function attachTaskNoteLinkDelegates(
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
		links.open(linktext, hasCommandModifier(event));
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
function getTopLevelSections(sections: NoteSection[]): NoteSection[] {
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

function renderSection(options: RenderSectionOptions): void {
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
	});
}

function renderSectionHeader(options: {
	sectionEl: HTMLElement;
	section: NoteSection;
	collapsed: boolean;
	onToggle: () => void;
}): void {
	const { sectionEl, section, collapsed, onToggle } = options;
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
	headerEl.createDiv({ cls: 'ioto-task-view__section-actions' });
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

	// ②/③ 叠加后本 Section 可见卡片数为 0：渲染空态，不再画空 `<ul>`（Q8）。
	if (filters.onlyPending && items.length > 0) {
		const hasVisible = items.some(
			(item) =>
				(!recentLines || recentLines.has(item.line)) &&
				!isChecklistItemDone(item),
		);
		if (!hasVisible) {
			bodyEl.createDiv({
				cls: 'ioto-task-view__empty',
				text: t('view.iotoTaskView.empty.allDone'),
			});
			return;
		}
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
				filters,
				recentLines,
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

/**
 * 「主修饰键」：Mac 的 Command 与 Win/Linux 的 Ctrl。
 * 与核心「Cmd/Ctrl+Enter 切换勾选」的口径一致，故两者同义，不做平台分支
 * （[[Plan-20261003-222709]] §四.2b）。
 */
function hasCommandModifier(event: MouseEvent | KeyboardEvent): boolean {
	return event.metaKey || event.ctrlKey;
}

function renderChecklistGroup(options: {
	app: App;
	bodyEl: HTMLElement;
	items: NoteChecklistItem[];
	sourcePath: string;
	component: Component;
	editing: TaskNoteEditing;
	filters: TaskNoteFilters;
	/** ③ 最近任务过滤：保留的行号集合；`null` = 未开启。 */
	recentLines: Set<number> | null;
	/** 卡片行号 → 该卡的续行 markdown（无续行的卡不出现） */
	continuationMarkdown: Map<number, string>;
	/** 卡片行号 → 该卡的续行行号数组（无续行的卡不出现） */
	continuationLines: Map<number, number[]>;
}): void {
	const {
		app,
		bodyEl,
		items,
		sourcePath,
		component,
		editing,
		filters,
		recentLines,
		continuationMarkdown,
		continuationLines,
	} = options;
	const listEl = bodyEl.createEl('ul', { cls: 'ioto-task-view__checklist' });

	for (const item of items) {
		// ③ 只显示最近任务：不属于末尾 N 组的行不生成 DOM（与 ② 同为独立 skip）。
		if (recentLines && !recentLines.has(item.line)) {
			continue;
		}
		const done = isChecklistItemDone(item);
		// ② 只显示未完成：已完成卡不生成 DOM（collectCardLines 读 DOM，
		// 隐藏卡天然不可达，↑↓ 自动跳过）；空 Section 不在此处隐藏。
		if (filters.onlyPending && done) {
			continue;
		}
		const cardEl = listEl.createEl('li', {
			cls: 'ioto-task-view__card',
			attr: {
				'data-line': String(item.line),
				'data-task': item.marker,
				'data-indent': String(item.indentLevel),
				// 只读态不参与焦点：否则方向键会在别的视图里也响应
				tabindex: editing.enabled ? '-1' : null,
			},
		});
		if (editing.selectedLine === item.line) {
			cardEl.addClass('is-selected');
		}

		const checkboxEl = cardEl.createEl('button', {
			cls: 'ioto-task-view__card-checkbox',
			attr: {
				type: 'button',
				'aria-pressed': done ? 'true' : 'false',
				'aria-label': t('view.iotoTaskView.checkboxToggle', [
					truncateLabel(item.text),
				]),
			},
		});
		setIcon(checkboxEl, done ? 'check' : '');
		checkboxEl.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			editing.toggleTask(item.line, cardEl);
		});

		const selected = editing.selectedLine === item.line;
		const textEl = cardEl.createDiv({
			cls: 'ioto-task-view__card-text',
			attr: {
				title: selected
					? t('view.iotoTaskView.selectedHint')
					: t('view.iotoTaskView.selectCardHint'),
			},
		});
		void MarkdownRenderer.render(
			app,
			item.text,
			textEl,
			sourcePath,
			component,
		);

		// 编辑入口挂在卡片本体（li）而非正文区：空条目正文区高度为 0，挂正文区会命中不到
		// （[[Research-20261003-091331]] §四，[[Plan-20261003-094145]] §5.5）。整张卡片
		// （含 padding / 空白区）都可进入编辑；交互元素按 closest 逐类排除。
		//
		// 两段式点击（[[Plan-20261003-194909]] §三）：未选中 → 只选中；已选中 → 进编辑。
		cardEl.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			if (!target) {
				return;
			}
			// 点 wikilink / 标签等交互元素时让核心处理，不进入编辑
			if (target.closest('a')) {
				return;
			}
			// checkbox 走 3a（自身也 stopPropagation，这里按 closest 双保险）
			if (target.closest('.ioto-task-view__card-checkbox')) {
				return;
			}
			// 动作区改为整行底栏后，只排除「可交互的徽章本体」；底栏空白仍应可点进编辑，
			// 否则会比改前多出一整条「点不进编辑」的空白带（改前动作区只占徽章宽）。
			if (target.closest('.ioto-task-view__badge')) {
				return;
			}
			// 动作区按钮：自身已 stopPropagation，这里按 closest 双保险
			// （[[Plan-20261005-111411]] §三 步骤 3）
			if (target.closest('.ioto-task-view__card-action-btn')) {
				return;
			}
			// 待删除确认遮罩 / 按钮：按钮自身已 stopPropagation，这里按 closest 双保险；
			// 点遮罩空白同样不触发选择 / 编辑（[[Plan-20261005-141853]] Q8）。
			if (target.closest('.ioto-task-view__delete-confirm')) {
				return;
			}
			// 编辑中不重复进入
			if (target.closest('.ioto-task-view__card-editor')) {
				return;
			}
			// 续行虽已成卡片后代，但它不是任务行（标题编辑器只编辑任务那一行），
			// 点它进**续行编辑器**，而不是「选中该卡 / 再点进标题编辑」。
			if (target.closest('.ioto-task-view__card-continuation')) {
				if (editing.enabled) {
					editing.beginContinuationEdit(item.line);
				}
				return;
			}
			// 「不支持内联编辑」时保留原 Notice 路径，不进选择态
			if (!editing.enabled) {
				editing.beginEdit(item.line);
				return;
			}
			// 用 DOM 上的类判「是否已选中」，与真实状态自洽，不依赖闭包快照
			if (cardEl.hasClass('is-selected')) {
				editing.beginEdit(item.line);
			} else {
				editing.select(item.line);
			}
		});

		// 选择态键位：Enter 编辑 / ↑↓ 移动选择 / Delete·Backspace 删除
		// （[[Plan-20261003-194909]] §5.2d）。只读态不挂。
		if (editing.enabled) {
			cardEl.addEventListener('keydown', (event) => {
				// IME 组字中一律放行，否则中文候选确认会误触发删除
				if (event.isComposing) {
					return;
				}
				// 浮层（条目控制 Modal / 建议器）抢焦点期间不吞键
				if (isOverlayFocusTarget(activeDocument.activeElement)) {
					return;
				}
				const target = event.target as HTMLElement | null;
				// 编辑器是卡片的**后代**，keydown 会冒泡上来；不守卫则编辑态输入
				// Enter / Backspace 会同时触发卡片分支（[[Plan-20261003-194909]] §6.3）。
				if (
					target?.closest('.ioto-task-view__card-editor') ||
					target?.closest('.ioto-task-view__continuation-editor')
				) {
					return;
				}
				// 只有卡片本体真正持有焦点时才响应（点了正文里的其他交互元素时不响应）
				if (target !== cardEl) {
					return;
				}

				// 待删除确认瞬态：优先路由（[[Plan-20261005-141853]] 步骤 5）。
				// 判定抽成纯函数（delete-confirm.ts）覆盖 auto-repeat / 二次 Del / Esc / 导航。
				const pendingAction = resolveDeleteConfirmKey(
					editing.deletePending === true,
					event.key,
					event.repeat,
					{
						shiftKey: event.shiftKey,
						commandModifier: hasCommandModifier(event),
						altKey: event.altKey,
					},
				);
				if (pendingAction === 'repeat') {
					// 坑 A：长按连发不得走到确认
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				if (pendingAction === 'confirm') {
					// 二次 Del/Backspace 或纯 Enter → 确认（delete 由 requestDelete 分派）
					editing.delete(item.line);
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				if (pendingAction === 'cancel') {
					// Q3：Esc 取消
					editing.cancelDelete?.();
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				if (pendingAction === 'fallthrough') {
					// 其余键（↑↓ / Shift+Enter / Cmd+Enter 等）：先取消 pending，再走常规分支
					editing.cancelDelete?.();
				}

				const order = collectCardLines(
					cardEl.closest('.ioto-task-view__scroll') ?? activeDocument.body,
				);
				switch (event.key) {
					case 'Enter': {
						// Mod+Enter（macOS Command / 其它平台 Ctrl）切换完成态**已移交
						// Obsidian Scope**（`select-mode-scope.ts`）：核心 Keymap 挂在
						// `window` 上的捕获监听会抢先吃掉这个组合，DOM 层根本收不到
						// （Windows 上 Ctrl+Enter 完全无效、macOS 只有 Ctrl+Enter 能用，
						// 就是这个原因）。
						// 这里只留兜底：万一事件仍冒泡进来，按原条件吞掉，**绝不**
						// 当作普通 Enter 落进编辑态（否则会与 scope 的写回交错）。
						if (
							hasCommandModifier(event) &&
							!event.shiftKey &&
							!event.altKey
						) {
							break;
						}
						// Shift+Enter：在选中卡片下方新建一张同级空卡并直接开编；
						// 纯修饰键排除，避免抢占 Ctrl/Cmd/Alt+Shift+Enter 等组合。
						if (
							event.shiftKey &&
							!hasCommandModifier(event) &&
							!event.altKey
						) {
							editing.insertSibling(item.line);
							break;
						}
						editing.beginEdit(item.line);
						break;
					}
					case 'ArrowUp': {
						// Cmd/Ctrl+↑：跳到第一张可见卡
						const jump =
							hasCommandModifier(event) &&
							!event.shiftKey &&
							!event.altKey;
						const prev = jump
							? pickEdgeLine(order, 'first')
							: pickAdjacentLine(order, item.line, -1);
						if (prev !== null) {
							editing.select(prev);
						}
						break;
					}
					case 'ArrowDown': {
						// Cmd/Ctrl+↓：跳到最后一张可见卡
						const jump =
							hasCommandModifier(event) &&
							!event.shiftKey &&
							!event.altKey;
						const next = jump
							? pickEdgeLine(order, 'last')
							: pickAdjacentLine(order, item.line, 1);
						if (next !== null) {
							editing.select(next);
						}
						break;
					}
					case 'Delete':
					case 'Backspace': {
						editing.delete(item.line);
						break;
					}
					default:
						return;
				}
				event.preventDefault();
				event.stopPropagation();
			});
		}

		renderCardActions(cardEl, item.controls, {
			line: item.line,
			editing,
		});

		// 续行：挂成卡片的**直接子元素**（不再是同一 `<ul>` 里的兄弟 `<li>`），
		// 这样它才落在 `.ioto-task-view__card` 这个盒子里，拿到卡片的背景 / 边框 /
		// 圆角，并跟随 `.is-selected` / `.is-editing` 高亮（`flex: 1 1 100%` 独占
		// 一整行，排在正文行之后，见 styles.css）。
		// 🔴 不能挂进 `.card-text`：`refreshCard` 会 `textEl.empty()` 后只重渲染
		// `item.text`，续行会被清掉且不重建；挂 `cardEl`（textEl 的兄弟）完全避开。
		// 点击它**不**进编辑态（它只显示，编辑器只编辑任务那一行；guard 见卡片
		// click 处理器）。`collectCardLines` 用 `.ioto-task-view__card` 选择器，续行
		// 作为卡片后代仍是同一张卡，↑↓ 导航不受影响（比兄弟 `<li>` 更干净）。
		// ② 只显示未完成时随卡片一起隐藏（现在是其子元素，天然跟随，无需显式条件）。
		const continuation = continuationMarkdown.get(item.line);
		if (continuation !== undefined) {
			const contLines = continuationLines.get(item.line) ?? [];
			const continuationEl = cardEl.createDiv({
				cls: 'ioto-task-view__card-continuation',
				attr: {
					'data-line': String(item.line),
					'data-cont-start': String(
						contLines[0] ?? item.line + 1,
					),
					'data-cont-end': String(
						contLines[contLines.length - 1] ?? item.line + 1,
					),
					title: editing.enabled
						? t('view.iotoTaskView.continuationEditHint')
						: '',
				},
			});
			const mdEl = continuationEl.createDiv({
				cls: 'ioto-task-view__md',
			});
			void MarkdownRenderer.render(
				app,
				continuation,
				mdEl,
				sourcePath,
				component,
			);
		}
	}
}

/**
 * 构建 / 就地重建一张卡片的动作区：**左栏图标按钮 + 右栏只读徽章**。
 *
 * 首次渲染（`renderChecklistGroup`）与条目控制面板写回后的就地刷新
 * （`IOTOTaskView.refreshCardActions`）共用同一份逻辑，避免两处写法漂移：
 * 只重建 `.ioto-task-view__card-actions` 子树，**不碰**正文区与内联编辑器；
 * 容器不存在时按卡片结构新建，保证编辑器存活、正文不丢、滚动位置不动。
 *
 * 左右分栏见 [[Plan-20261005-111411]] §三 步骤 2：`options.editing` 上是否挂
 * `insertOutgoingLink` / `editItemControls` 决定左栏按钮是否出现（缺省=隐藏）。
 */
export function renderCardActions(
	cardEl: HTMLElement,
	controls: ControlToken[],
	options: { line: number; editing: TaskNoteEditing },
): void {
	let actionsEl = cardEl.querySelector<HTMLElement>(
		'.ioto-task-view__card-actions',
	);
	if (!actionsEl) {
		actionsEl = cardEl.createDiv({ cls: 'ioto-task-view__card-actions' });
	}
	actionsEl.empty();

	const buttonsEl = actionsEl.createDiv({
		cls: 'ioto-task-view__card-actions-buttons',
	});
	renderCardActionButtons(buttonsEl, options);

	const badgesEl = actionsEl.createDiv({
		cls: 'ioto-task-view__card-actions-badges',
	});
	renderControlBadges(badgesEl, controls);
}

/**
 * 渲染左栏图标按钮：出链、条目控制（顺序固定，[[Plan-20261005-111411]] Q6）。
 * 只在编辑控制器提供了对应回调时才渲染——即 `supportsInlineEdit()` 为真且
 * 目标命令已注册（Q5：只读 / ioto-settings 未启用时隐藏按钮）。
 */
function renderCardActionButtons(
	containerEl: HTMLElement,
	options: { line: number; editing: TaskNoteEditing },
): void {
	const { line, editing } = options;

	if (editing.insertOutgoingLink) {
		createCardActionButton(containerEl, {
			icon: 'arrow-up-right',
			label: t('view.iotoTaskView.cardActions.insertOutgoingLink'),
			action: 'insert-outgoing-link',
			// 闭包内 `?.` 兜底：方法存在性在渲染时已判定，此处只为满足窄化
			onClick: () => editing.insertOutgoingLink?.(line),
		});
	}

	if (editing.editItemControls) {
		createCardActionButton(containerEl, {
			icon: 'sliders-horizontal',
			label: t('view.iotoTaskView.cardActions.editItemControls'),
			action: 'edit-item-controls',
			onClick: () => editing.editItemControls?.(line),
		});
	}
}

/**
 * 单个卡片动作按钮：`<button>` + `setIcon`，仅图标（可见内容为图标，
 * `label` 只进 `aria-label` / `title`）。点击 `stopPropagation`，避免冒泡到
 * 卡片点击 → 误触发选择 / 进入编辑（[[Plan-20261005-111411]] §三 步骤 3）。
 */
function createCardActionButton(
	containerEl: HTMLElement,
	options: {
		icon: string;
		label: string;
		action: string;
		onClick: () => void;
	},
): HTMLButtonElement {
	const btn = containerEl.createEl('button', {
		cls: 'ioto-task-view__card-action-btn',
		attr: {
			type: 'button',
			'aria-label': options.label,
			title: options.label,
			'data-action': options.action,
		},
	});
	setIcon(btn, options.icon);
	btn.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		options.onClick();
	});
	return btn;
}

/** 控制项 → 图标名（Obsidian `setIcon` 语汇）。 */
function controlIcon(kind: ControlKind): string {
	switch (kind) {
		case 'depends':
			return 'link';
		case 'agent':
			return 'bot';
		case 'model':
			return 'cpu';
		case 'fanout':
			return 'git-fork';
		case 'turns':
			return 'refresh-cw';
		default:
			return 'circle';
	}
}

/** 控制项 → 徽章文案（走 i18n，三语对齐）。 */
function controlLabel(control: ControlToken): string {
	switch (control.kind) {
		case 'depends':
			return Array.isArray(control.value)
				? t('view.iotoTaskView.badge.depends', [String(control.value.length)])
				: t('view.iotoTaskView.badge.dependsIndex', [
						String(control.value),
					]);
		case 'agent':
			return t('view.iotoTaskView.badge.agent', [String(control.value)]);
		case 'model':
			return t('view.iotoTaskView.badge.model', [String(control.value)]);
		case 'fanout':
			return control.value === true
				? t('view.iotoTaskView.badge.fanout')
				: t('view.iotoTaskView.badge.fanoutLimit', [
						String(control.value),
					]);
		case 'turns':
			return control.value === 0
				? t('view.iotoTaskView.badge.turnsUnlimited')
				: t('view.iotoTaskView.badge.turns', [String(control.value)]);
		default:
			return control.raw;
	}
}

/** 徽章 tooltip：depends 列全部笔记名，其余保留原文。 */
function controlTitle(control: ControlToken): string {
	if (control.kind === 'depends' && Array.isArray(control.value)) {
		return control.value.join('、');
	}
	return control.raw;
}

/**
 * 把控制项渲染成动作区里的只读徽章（v1）。
 * 同一行同时有 `[model:: …]` 与 `#ioto/model/…` 时只显示优先级高者，但两者都
 * 保留在 `controls` 里供写回（[[Plan-20261003-162429]] §5.2）。
 */
function renderControlBadges(
	containerEl: HTMLElement,
	controls: ControlToken[],
): void {
	const hasInlineModel = controls.some(
		(control) =>
			control.kind === 'model' && control.raw.startsWith('[model'),
	);

	for (const control of controls) {
		if (
			control.kind === 'model' &&
			!control.raw.startsWith('[model') &&
			hasInlineModel
		) {
			continue;
		}

		const badgeEl = containerEl.createSpan({
			cls: 'ioto-task-view__badge',
			attr: {
				'data-kind': control.kind,
				title: controlTitle(control),
			},
		});
		const iconEl = badgeEl.createSpan({
			cls: 'ioto-task-view__badge-icon',
		});
		setIcon(iconEl, controlIcon(control.kind));
		badgeEl.createSpan({
			cls: 'ioto-task-view__badge-label',
			text: controlLabel(control),
		});
	}
}

function truncateLabel(text: string, maxLength = 40): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}

	return `${trimmed.slice(0, maxLength)}…`;
}

function renderMarkdownChunk(options: {
	app: App;
	bodyEl: HTMLElement;
	markdown: string;
	sourcePath: string;
	component: Component;
}): void {
	const { app, bodyEl, markdown, sourcePath, component } = options;
	if (markdown.trim().length === 0) {
		return;
	}

	const markdownEl = bodyEl.createDiv({ cls: 'ioto-task-view__md' });
	void MarkdownRenderer.render(
		app,
		markdown,
		markdownEl,
		sourcePath,
		component,
	);
}
