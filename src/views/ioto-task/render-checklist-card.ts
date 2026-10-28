/**
 * 卡片渲染：把 checklist 项画成卡片 DOM（checkbox + 正文 + 续行 + 动作区 +
 * 选择态键位）。
 *
 * 与解析层严格分离：只消费 `note-structure.ts` 的输出，不做字符串分析。
 * DOM 上挂 `data-line` / `data-task` / `data-indent` / `data-task-key` 等属性，
 * 是 Phase 2/3 挂按钮与行级写回的契约。
 *
 * 从 `render-note.ts` 拆出（Phase 2）。
 */

import {
	MarkdownRenderer,
	Platform,
	setIcon,
	type App,
	type Component,
} from 'obsidian';

import { t } from '../../lang/helpter';
import { isChecklistItemDone, type NoteChecklistItem } from '../../tasks-center/note-structure';
import { renderCardActions } from './render-card-actions';
import {
	shouldShowCardContextMenu,
	showCardContextMenu,
} from './render-card-context-menu';
import { attachCardKeydownHandler } from './render-card-keybind';
import {
	isCardVisible,
	type CardVisibilityContext,
} from './task-query-filter';
import { applySearchHighlight } from '../../tasks-center/search-highlight';
import {
	CONTINUATION_COLLAPSED_CLASS,
	CONTINUATION_SUMMARY_CLASS,
	CONTINUATION_TOGGLE_CLASS,
	continuationFoldKey,
	shouldForceExpand,
} from './continuation-fold';
import type {
	TaskCardDrag,
	TaskContinuationFold,
	TaskNoteEditing,
} from './render-note-types';

function truncateLabel(text: string, maxLength = 40): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}

	return `${trimmed.slice(0, maxLength)}…`;
}

export function renderChecklistGroup(options: {
	app: App;
	bodyEl: HTMLElement;
	items: NoteChecklistItem[];
	sourcePath: string;
	component: Component;
	editing: TaskNoteEditing;
	/** 四层过滤的可见性上下文（②③ + 关键词 + 编辑态兜底）；逐卡 skip 的唯一判据。 */
	visibilityCtx: CardVisibilityContext;
	/** 卡片行号 → 该卡的续行 markdown（无续行的卡不出现） */
	continuationMarkdown: Map<number, string>;
	/** 卡片行号 → 该卡的续行行号数组（无续行的卡不出现） */
	continuationLines: Map<number, number[]>;
	/**
	 * 卡片拖拽排序控制器（缺省 = 不渲染 grip：只读 / 过滤 / 搜索态）。
	 * 与 `scrollEl` 成对出现：grip 手势需要滚动容器做命中判定与边缘自动滚动。
	 */
	cardDrag?: TaskCardDrag;
	scrollEl?: HTMLElement;
	/**
	 * 续写区折叠控制器（缺省 = 全展开且不渲染箭头）。
	 * 缺省语义让旧调用 / 单测与「折叠前」零差异（[[Plan-20261022-232148]] §0-8）。
	 */
	continuationFold?: TaskContinuationFold;
}): void {
	const {
		app,
		bodyEl,
		items,
		sourcePath,
		component,
		editing,
		visibilityCtx,
		continuationMarkdown,
		continuationLines,
		cardDrag,
		scrollEl,
		continuationFold,
	} = options;
	const listEl = bodyEl.createEl('ul', { cls: 'ioto-task-view__checklist' });

	for (const item of items) {
		const done = isChecklistItemDone(item);
		// ②③ + 关键词：不可见卡不生成 DOM（collectCardLines 读 DOM，
		// 隐藏卡天然不可达，↑↓ 自动跳过）；空 Section 不在此处隐藏。
		// 与「空态判定」同源（`isCardVisible`），避免两处漂移。
		if (
			!isCardVisible(
				{
					line: item.line,
					done,
					title: item.text,
					continuation: continuationMarkdown.get(item.line),
				},
				visibilityCtx,
			)
		) {
			continue;
		}
		const cardEl = listEl.createEl('li', {
			cls: 'ioto-task-view__card',
			attr: {
				'data-line': String(item.line),
				'data-task': item.marker,
				'data-indent': String(item.indentLevel),
				// 身份键（源码文本，非渲染产物）：供最近任务进出场 diff。
				'data-task-key': item.text,
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

		// 拖拽手柄：常驻卡片、无文字图标；编辑 / 放大态由 CSS 认类隐藏（同 section
		// grip 口径）。必须挂在 cardEl 直接子级、且在 `.card-actions` 之外——
		// refreshCardActions 只重建动作区，不会清掉手柄。
		if (cardDrag && scrollEl) {
			const dragHandleEl = cardEl.createEl('button', {
				cls: 'ioto-task-view__card-drag-handle',
				attr: {
					type: 'button',
					'aria-label': t('view.iotoTaskView.cardDragHandle'),
					title: t('view.iotoTaskView.cardDragHandle'),
					'aria-grabbed': 'false',
					draggable: 'false',
				},
			});
			setIcon(dragHandleEl, 'grip-vertical');
			dragHandleEl.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
			});
			cardDrag.attachHandle(dragHandleEl, cardEl, scrollEl);
		}

		const selected = editing.selectedLine === item.line;
		const textEl = cardEl.createDiv({
			cls: 'ioto-task-view__card-text',
			attr: {
				title: selected
					? t(
							Platform.isMobile
								? 'view.iotoTaskView.selectedHintMobile'
								: 'view.iotoTaskView.selectedHint',
						)
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
		// 关键词命中高亮：`MarkdownRenderer.render` 的基础 DOM 是**同步** append 的
		// （[[Discuss-20261006-183552]] §一.2），同步跑即可命中；入参直接取已透传到卡片层的
		// `visibilityCtx.normalizedQuery`——与过滤判据同源，无需新增透传字段。
		applySearchHighlight(textEl, visibilityCtx.normalizedQuery);

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
			// 拖拽手柄：不进选择 / 编辑（自身也 stopPropagation，双保险）
			if (target.closest('.ioto-task-view__card-drag-handle')) {
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
			// 折叠态：整块都是「展开」入口（箭头 / 占位条 / 容器留白一视同仁），
			// 不能落到下面的「点续行进编辑」分支，否则想展开却进了编辑器。
			// 🔴 必须在 `.card-continuation` 分支**之前**。
			const collapsedEl = target.closest<HTMLElement>(
				`.${CONTINUATION_COLLAPSED_CLASS}`,
			);
			if (collapsedEl) {
				const contKey = collapsedEl.dataset.contKey;
				if (contKey) {
					continuationFold?.toggle(contKey, collapsedEl);
				}
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
			// 方案 A（[[Discuss-20261008-173935]]）：放大态 = 单卡编辑面。点击卡片空白 /
			// 正文区一律聚焦内嵌编辑器，不走「未选中 → 先选中」两段式、也不回落选中态。
			if (editing.zoomLine === item.line) {
				editing.focusZoomEditor?.(item.line);
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

		// 右键菜单（[[Plan-20261023-104335]] §4.7）：桌面端 only（移动端无 contextmenu，
		// 长按已被拖拽手柄占用，见 [[Research-20261023-090756]] D7）。
		cardEl.addEventListener('contextmenu', (event) => {
			// 移动端直接放行系统行为，不 preventDefault
			if (Platform.isMobile) return;
			if (!shouldShowCardContextMenu(event.target as HTMLElement | null)) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			// 惰性选中：只作视觉副作用（select 内部会顺带 cancelPendingDelete）。
			// 放大态一律不改选——applySelection 的 focus 会把常驻编辑器打掉（M3）。
			if (editing.zoomLine == null && editing.selectedLine !== item.line) {
				editing.select(item.line);
			}
			showCardContextMenu(event, {
				line: item.line,
				pinned: item.controls.some((control) => control.kind === 'pin'),
				repeated: item.controls.some((control) => control.kind === 'repeat'),
				writable: editing.enabled,
				onPin: (line) => editing.toggleTaskPin?.(line),
				onRepeat: (line) => editing.toggleTaskRepeat?.(line),
				onDuplicate: (line) => editing.duplicateTask?.(line),
				onDelete: (line) => editing.delete(line),
			});
		});

		// 选择态键位：Enter 编辑 / ↑↓ 移动选择 / Delete·Backspace 删除
		// （[[Plan-20261003-194909]] §5.2d）。只读态不挂。
		if (editing.enabled) {
			attachCardKeydownHandler(cardEl, item, editing);
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
			// 折叠态键 = 续写正文哈希（键不含标题：改标题不掉态，改内容自动展开）。
			const foldKey = continuationFoldKey(continuation);
			// 缺省控制器 / 强制展开时一律按展开渲染，且不渲染箭头：
			// 旧调用与只读降级零差异。
			const foldable = continuationFold !== undefined;
			const forceExpand = shouldForceExpand({
				continuation,
				normalizedQuery: visibilityCtx.normalizedQuery,
				editing: editing.keepVisibleLine === item.line,
			});
			const collapsed =
				foldable && !forceExpand && continuationFold.isCollapsed(foldKey);
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
					'data-cont-key': foldKey,
					// 批量折叠跳过标记：编辑中的卡 / 续写命中搜索词时本次强制展开
					// （[[Plan-20261024-060243]] S3）。语义是「本次渲染」，搜索词清空
					// 后即消失，命中期间执行的批量折叠不会落到这个键上——有意为之。
					'data-cont-force': forceExpand ? '1' : null,
					// 展开态的容器 tooltip（折叠时由 applyContinuationFoldState 换成
					// 「展开」文案，纯模块不引 i18n）。
					'data-hint-expanded': editing.enabled
						? t('view.iotoTaskView.continuationEditHint')
						: '',
					title: editing.enabled
						? t('view.iotoTaskView.continuationEditHint')
						: '',
				},
			});
			if (collapsed) {
				continuationEl.addClass(CONTINUATION_COLLAPSED_CLASS);
			}
			if (foldable) {
				// 占位条必须在 `.md` 之前（折叠时它自然成为首行）。
				const summaryEl = continuationEl.createDiv({
					cls: CONTINUATION_SUMMARY_CLASS,
					text: t('view.iotoTaskView.continuationCollapsedSummary', [
						String(contLines.length),
					]),
				});
				summaryEl.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					continuationFold?.toggle(foldKey, continuationEl);
				});

				const labelCollapsed = t('view.iotoTaskView.continuationExpand');
				const labelExpanded = t('view.iotoTaskView.continuationCollapse');
				const toggleEl = continuationEl.createEl('button', {
					cls: CONTINUATION_TOGGLE_CLASS,
					attr: {
						type: 'button',
						'aria-expanded': collapsed ? 'false' : 'true',
						'aria-label': collapsed ? labelCollapsed : labelExpanded,
						title: collapsed ? labelCollapsed : labelExpanded,
						// 两条文案都预先挂在 DOM 上，供纯模块切换（避免纯模块引 i18n）
						'data-label-collapsed': labelCollapsed,
						'data-label-expanded': labelExpanded,
					},
				});
				setIcon(toggleEl, 'right-triangle');
				// 🔴 不 preventDefault 会让焦点落到按钮上，卡片选中态的 ↑↓ / Enter /
				// Shift+Enter 全部失灵，直到用户再点一次卡片（照抄核心折叠指示器口径）。
				toggleEl.addEventListener('mousedown', (event) => {
					event.preventDefault();
				});
				toggleEl.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					continuationFold?.toggle(foldKey, continuationEl);
				});
			}
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
			// 续行同样跑高亮（Q1：标题 + 续行）；容器 `.ioto-task-view__md` 是渲染产物，
			// 不是编辑器容器，可安全包裹（[[Discuss-20261006-183552]] §五.4）。
			applySearchHighlight(mdEl, visibilityCtx.normalizedQuery);
		}
	}
}

export function renderMarkdownChunk(options: {
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
