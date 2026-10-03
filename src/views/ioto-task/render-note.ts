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
	parseChecklistItemsInRange,
	parseSections,
	type ControlKind,
	type ControlToken,
	type NoteChecklistItem,
	type NoteSection,
} from '../../tasks-center/note-structure';
import { isOverlayFocusTarget } from './embedded-editor';
import {
	collectCardLines,
	pickAdjacentLine,
} from './card-navigation';

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
	/** 进入卡片正文内联编辑（同时会提交上一张正在编辑的卡片） */
	beginEdit(line: number): void;
	/** 3a 勾选：点 checkbox ↔ 行内 `[ ]` / `[x]`（乐观更新由调用方负责） */
	toggleTask(line: number, cardEl: HTMLElement): void;
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
}

/** Section 折叠状态的稳定 key（Level + 起始行 + 标题，重排后不会错位）。 */
export function getSectionStateKey(section: NoteSection): string {
	return `${section.level}:${section.startLine}:${section.title}`;
}

export function renderTaskNote(options: RenderTaskNoteOptions): void {
	const { containerEl, content } = options;
	const sections = parseSections(content);
	const scrollEl = containerEl.createDiv({ cls: 'ioto-task-view__scroll' });

	for (const section of getTopLevelSections(sections)) {
		renderSection({ ...options, scrollEl, section });
	}
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
}): void {
	const { app, bodyEl, content, sourcePath, component, section, editing } =
		options;
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
			}
			renderChecklistGroup({
				app,
				bodyEl,
				items: group,
				sourcePath,
				component,
				editing,
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

function renderChecklistGroup(options: {
	app: App;
	bodyEl: HTMLElement;
	items: NoteChecklistItem[];
	sourcePath: string;
	component: Component;
	editing: TaskNoteEditing;
}): void {
	const { app, bodyEl, items, sourcePath, component, editing } = options;
	const listEl = bodyEl.createEl('ul', { cls: 'ioto-task-view__checklist' });

	for (const item of items) {
		const done = item.marker.toLowerCase() === 'x';
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
		setIcon(checkboxEl, done ? 'check-square' : 'square');
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
			// 编辑中不重复进入
			if (target.closest('.ioto-task-view__card-editor')) {
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
				if (target?.closest('.ioto-task-view__card-editor')) {
					return;
				}
				// 只有卡片本体真正持有焦点时才响应（点了正文里的其他交互元素时不响应）
				if (target !== cardEl) {
					return;
				}

				const order = collectCardLines(
					cardEl.closest('.ioto-task-view__scroll') ?? activeDocument.body,
				);
				switch (event.key) {
					case 'Enter': {
						editing.beginEdit(item.line);
						break;
					}
					case 'ArrowUp': {
						const prev = pickAdjacentLine(order, item.line, -1);
						if (prev !== null) {
							editing.select(prev);
						}
						break;
					}
					case 'ArrowDown': {
						const next = pickAdjacentLine(order, item.line, 1);
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

		renderCardActions(cardEl, item.controls);
	}
}

/**
 * 构建 / 就地重建一张卡片的动作区徽章。
 *
 * 首次渲染（`renderChecklistGroup`）与条目控制面板写回后的就地刷新
 * （`IOTOTaskView.refreshCardActions`）共用同一份逻辑，避免两处写法漂移：
 * 只重建 `.ioto-task-view__card-actions` 子树，**不碰**正文区与内联编辑器；
 * 容器不存在时按卡片结构新建，保证编辑器存活、正文不丢、滚动位置不动。
 */
export function renderCardActions(
	cardEl: HTMLElement,
	controls: ControlToken[],
): void {
	let actionsEl = cardEl.querySelector<HTMLElement>(
		'.ioto-task-view__card-actions',
	);
	if (!actionsEl) {
		actionsEl = cardEl.createDiv({ cls: 'ioto-task-view__card-actions' });
	}
	actionsEl.empty();
	renderControlBadges(actionsEl, controls);
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
