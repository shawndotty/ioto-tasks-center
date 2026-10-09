import { Platform, setIcon } from 'obsidian';

import { t } from '../../lang/helpter';
import { isTemplateAvailableForProject } from '../../tasks-center/batch-task-template';
import type { TaskViewHost } from './task-view-host';
import type { ToolbarButtonClickContext } from './task-view-constants';
import { queryCard } from './task-view-helpers';

/** 建常驻外壳：`__toolbar`（固定）+ `__body`（可滚）。幂等，重绘不重建。 */
export function buildToolbar(view: TaskViewHost): void {
	if (view.toolbarEl?.isConnected && view.bodyEl?.isConnected) {
		return;
	}

	const toolbarEl = view.contentEl.createDiv({
		cls: 'ioto-task-view__toolbar',
	});
	const leftEl = toolbarEl.createDiv({
		cls: 'ioto-task-view__toolbar-left',
	});
	const rightEl = toolbarEl.createDiv({
		cls: 'ioto-task-view__toolbar-right',
	});

	view.toggleTaskBlocksEl = createToolbarButton(leftEl, {
		cls: 'ioto-task-view__toggle',
		icon: 'list-todo',
		label: t('view.iotoTaskView.toolbar.toggleTaskBlocks'),
		title: t('view.iotoTaskView.toolbar.toggleTaskBlocksTooltip'),
		attr: { 'data-filter': 'task-blocks' },
		onClick: () => {
			void view.toggleFilter('onlyTaskBlocks');
		},
	});
	view.togglePendingEl = createToolbarButton(leftEl, {
		cls: 'ioto-task-view__toggle',
		icon: 'circle-check-big',
		label: t('view.iotoTaskView.toolbar.togglePending'),
		title: t('view.iotoTaskView.toolbar.togglePendingTooltip'),
		attr: { 'data-filter': 'pending' },
		onClick: () => {
			void view.toggleFilter('onlyPending');
		},
	});
	// ③ 显示最近任务：每个 Section 只保留末尾 N 个顶级任务（阈值取自设置）。
	view.toggleRecentEl = createToolbarButton(leftEl, {
		cls: 'ioto-task-view__toggle',
		icon: 'history',
		label: t('view.iotoTaskView.toolbar.toggleRecent'),
		title: recentTaskTitle(view),
		attr: { 'data-filter': 'recent' },
		onClick: () => {
			void view.toggleFilter('recentOnly');
		},
	});
	// ④ 搜索任务：左簇第 4 个 toggle，紧挨「最近任务」右侧（[[Plan-20261009-064624]]）。
	// 复用 __toggle 类：按下态直接用四套主题既有的 [aria-pressed="true"] 样式，零 CSS。
	view.searchToggleEl = createToolbarButton(leftEl, {
		cls: 'ioto-task-view__toggle',
		icon: 'search',
		label: t('view.iotoTaskView.toolbar.toggleSearch'),
		title: t('view.iotoTaskView.toolbar.toggleSearchTooltip'),
		attr: { 'data-action': 'toggle-search' },
		onClick: () => {
			view.toggleSearch();
		},
	});
	// 删除按钮建在「执行」之前：`toolbar-right` 右锚（`margin-inline-start:auto`），
	// 显隐只改右簇左边界，「执行 / 添加」不平移（[[Plan-20261007-194826]] §六.4）。
	// 初值显隐交给末尾的 `refreshToolbarState()`（建栏时 `selectedLine` 为 null，自动隐藏）。
	view.deleteTaskEl = createToolbarButton(rightEl, {
		cls: 'ioto-task-view__action',
		icon: 'trash-2',
		label: t('view.iotoTaskView.toolbar.deleteTask'),
		title: t('view.iotoTaskView.toolbar.deleteTaskTooltip'),
		attr: { 'data-action': 'delete-task' },
		onClick: () => {
			requestDeleteSelected(view);
		},
	});
	view.runTaskEl = createToolbarButton(rightEl, {
		cls: 'ioto-task-view__action',
		icon: 'play',
		label: t('view.iotoTaskView.toolbar.runTask'),
		title: t('view.iotoTaskView.toolbar.runTaskTooltip'),
		attr: { 'data-action': 'run-task' },
		onClick: () => {
			void view.runTask();
		},
	});
	view.addTaskEl = createToolbarButton(rightEl, {
		cls: 'ioto-task-view__action',
		icon: 'plus',
		label: t('view.iotoTaskView.toolbar.addTask'),
		title: addTaskTooltip(view),
		attr: { 'data-action': 'add-task' },
		onClick: (context) => {
			view.triggerAddTask(context);
		},
	});

	// DOM 顺序固定 `__toolbar` → `__searchbar` → `__body`（[[Plan-20261006-161121]] §2.3b）。
	const searchbarEl = view.contentEl.createDiv({
		cls: 'ioto-task-view__searchbar is-hidden',
	});
	view.searchInputEl = searchbarEl.createEl('input', {
		cls: 'ioto-task-view__search-input',
		attr: {
			type: 'search',
			placeholder: t('view.iotoTaskView.search.placeholder'),
			'aria-label': t('view.iotoTaskView.search.placeholder'),
		},
	});
	const searchActionsEl = searchbarEl.createDiv({
		cls: 'ioto-task-view__search-actions',
	});
	view.searchPrevEl = createSearchButton(searchActionsEl, {
		icon: 'chevron-up',
		label: t('view.iotoTaskView.search.prev'),
		action: 'search-prev',
		onClick: () => view.stepMatch(-1),
	});
	view.searchNextEl = createSearchButton(searchActionsEl, {
		icon: 'chevron-down',
		label: t('view.iotoTaskView.search.next'),
		action: 'search-next',
		onClick: () => view.stepMatch(1),
	});
	createSearchButton(searchActionsEl, {
		icon: 'x',
		label: t('view.iotoTaskView.search.close'),
		action: 'search-close',
		onClick: () => view.closeSearch(),
	});
	view.searchBarEl = searchbarEl;

	const input = view.searchInputEl;
	input.addEventListener('input', () => view.onSearchInput());
	input.addEventListener('keydown', (event) => {
		if (event.isComposing) {
			return; // IME 组字放行
		}
		if (event.key === 'Enter') {
			// Enter = 下一个 / Shift+Enter = 上一个（对齐核心查找条）
			event.preventDefault();
			view.stepMatch(event.shiftKey ? -1 : 1);
			return;
		}
		if (event.key === 'Escape') {
			// Esc = 关闭 + 清空（Q5）
			event.preventDefault();
			view.closeSearch();
		}
	});

	view.bodyEl = view.contentEl.createDiv({ cls: 'ioto-task-view__body' });
	view.toolbarEl = toolbarEl;
	refreshToolbarState(view);
	view.refreshSearchNavState();
}

/** 工具栏通用按钮：图标 + 文案 + 真实指针 Shift 采样。 */
function createToolbarButton(
	parentEl: HTMLElement,
	options: {
		cls: string;
		icon: string;
		label: string;
		title: string;
		attr: Record<string, string>;
		onClick: (context: ToolbarButtonClickContext) => void;
	},
): HTMLButtonElement {
	const btn = parentEl.createEl('button', {
		cls: options.cls,
		attr: {
			type: 'button',
			'aria-label': options.label,
			title: options.title,
			...options.attr,
		},
	});
	const iconEl = btn.createSpan({
		cls: 'ioto-task-view__toolbar-icon',
	});
	setIcon(iconEl, options.icon);
	btn.createSpan({
		cls: 'ioto-task-view__toolbar-label',
		text: options.label,
	});
	/**
	 * 真实指针按下时采样一次 Shift（[[Discuss-20261007-062838]] §三.②）：
	 * 按钮被聚焦后 Shift+Enter / Shift+Space 也会激活它，合成的 `click` 同样带
	 * `shiftKey === true` —— 但不会先派发 `pointerdown`，以此只认真实指针。
	 */
	let pressedShift = false;
	btn.addEventListener('pointerdown', (event) => {
		pressedShift = event.shiftKey;
	});
	btn.addEventListener('click', (event) => {
		event.preventDefault();
		// `detail > 0` 为兜底：键盘合成的 click 恒为 0（同 §三.② 备选判据）。
		const shiftKey = pressedShift && event.detail > 0;
		pressedShift = false;
		options.onClick({ shiftKey });
	});
	return btn;
}

/**
 * 搜索条图标按钮（照 `createToolbarButton` 裁剪的纯图标版）：
 * 可见内容为图标，`label` 只进 `aria-label` / `title`（[[Plan-20261006-161121]] §2.3b）。
 */
function createSearchButton(
	parentEl: HTMLElement,
	options: {
		icon: string;
		label: string;
		action: string;
		onClick: () => void;
	},
): HTMLButtonElement {
	const btn = parentEl.createEl('button', {
		cls: 'ioto-task-view__search-btn',
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
		options.onClick();
	});
	return btn;
}

/**
 * 按 `view.filters` 刷新栏态：两个 toggle 的 `aria-pressed`；只读态隐藏「添加任务」。
 * `aria-pressed` 以**属性真源**为准（`renderNote` 每次刷新），不缓存按钮内部状态。
 */
export function refreshToolbarState(view: TaskViewHost): void {
	view.toggleTaskBlocksEl?.setAttribute(
		'aria-pressed',
		view.filters.onlyTaskBlocks ? 'true' : 'false',
	);
	view.togglePendingEl?.setAttribute(
		'aria-pressed',
		view.filters.onlyPending ? 'true' : 'false',
	);
	view.toggleRecentEl?.setAttribute(
		'aria-pressed',
		view.filters.recentOnly ? 'true' : 'false',
	);
	// 阈值随设置变化：每次刷新重取 provider 更新 tooltip，避免只取一次导致滞后。
	view.toggleRecentEl?.setAttribute('title', recentTaskTitle(view));
	// 只读态隐藏「添加任务」：插入后进不了编辑只会剩 Notice（§5.4）。
	view.addTaskEl?.toggleClass('is-hidden', !view.supportsInlineEdit());
	// 模板 hint 随「可用模板」显隐（每次刷新重取，避免设置改完 tooltip 滞后）。
	view.addTaskEl?.setAttribute('title', addTaskTooltip(view));
	// 兜底重算删除按钮显隐（建栏 / clear / 设置热切换等整栏刷新点，§4.4 落点 A）。
	refreshDeleteButtonVisibility(view);
	// 搜索按钮按下态：建栏 / renderNote / 设置热切换等整栏刷新点同步（[[Plan-20261009-064624]]）。
	view.refreshSearchToggleState();
}

/**
 * 刷新工具栏「删除」按钮的显隐与 pending 态（[[Plan-20261007-194826]] §4.3）。
 *
 * 判据全真才显示：
 *  - 未在**放大**态（`zoomLine`）：方案 A 下放大 ≡ 单卡编辑面，删除入口整体停用，
 *    删除须先「缩小」退出放大（[[Discuss-20261008-173935]] Q3）；
 *  - 未在**标题**编辑（`editingLine`）：`beginEdit` 结尾会 `applySelection`，编辑态
 *    `selectedLine` 仍指向该行，只判 `selectedLine` 会在编辑时冒出删除按钮；
 *  - 未在**续行**编辑（`continuationLine`）：续行编辑不置 `editingLine`，同理会误显示；
 *  - 有可命中的选中卡（复用 `canToggleSelectedFromScope()` 口径）：否则选中行已被
 *    过滤 / 折叠时按钮还在、点了静默失败；
 *  - 且 `Platform.isMobile` **或** 桌面端设置已开启（含平板，勿用 CSS `.is-phone`）。
 *
 * pending 期间加 `is-pending` + `aria-pressed`，向用户传达「再点即删」。
 */
export function refreshDeleteButtonVisibility(view: TaskViewHost): void {
	const hasSelectedCard =
		view.selectedLine !== null && queryCard(view, view.selectedLine) !== null;
	const show =
		view.zoomLine === null &&
		view.editingLine === null &&
		view.continuationLine === null &&
		hasSelectedCard &&
		(Platform.isMobile || view.deleteButtonOnDesktopProvider());
	view.deleteTaskEl?.toggleClass('is-hidden', !show);

	const pending = view.pendingDeleteLine !== null;
	view.deleteTaskEl?.toggleClass('is-pending', pending);
	view.deleteTaskEl?.setAttribute('aria-pressed', pending ? 'true' : 'false');
}

/** 设置热切换：只重算删除按钮显隐，不整栏重刷、不重绘（[[Plan-20261007-194826]] §4.7）。 */
export function applyDeleteButtonSetting(view: TaskViewHost): void {
	refreshDeleteButtonVisibility(view);
}

/**
 * 工具栏「删除」入口：把当前选中行交给既有二次确认链（[[Discuss-20261007-193721]] §三.1）。
 *
 * 判据保证按钮仅在「有可命中选中卡」时可见，故空选中为不可达的防御出口：
 * 静默 return 即可（`enterPendingDelete` 内部还会再用 `queryCard` 兜一次）。
 */
function requestDeleteSelected(view: TaskViewHost): void {
	const line = view.selectedLine;
	if (line === null) {
		return;
	}
	void view.requestDelete(line);
}

/** ③ 按钮 tooltip：内插当前阈值（设置变更后由 `refreshToolbarState` 重取）。 */
function recentTaskTitle(view: TaskViewHost): string {
	return t('view.iotoTaskView.toolbar.toggleRecentTooltip', [
		String(view.recentTaskCountProvider()),
	]);
}

/**
 * 「添加」按钮 tooltip：只在**当前笔记有可用条目模板**时才拼上 Shift+点击的提示
 * （[[Discuss-20261007-062838]] §三.①）——没说出来 ≈ 不存在；没模板时不教这个手势，
 * 免得用户按了 Shift 只看到一条「未配置模板」的 Notice 以为是没按到。
 */
function addTaskTooltip(view: TaskViewHost): string {
	const base = t('view.iotoTaskView.toolbar.addTaskTooltip');
	if (!hasAvailableEntryTemplate(view)) {
		return base;
	}
	return `${base}${t('view.iotoTaskView.toolbar.addTaskTemplateHint')}`;
}

/** 当前笔记是否有可用条目模板：与 `insertEntryTemplate()` 的项目过滤同口径。 */
function hasAvailableEntryTemplate(view: TaskViewHost): boolean {
	const config = view.entryTemplateProvider();
	if (!config.enabled || config.templates.length === 0) {
		return false;
	}
	const currentProject = view.resolveCurrentProjectNames()[0] ?? '';
	return config.templates.some((template) =>
		isTemplateAvailableForProject(template, currentProject),
	);
}

/**
 * 按设置切换 IOTOTask 视图外观：玻璃（`.is-glass`）/ 现代（`.is-modern`）/ 简洁（`.is-simple`）/ 莫兰迪（`.is-morandi`）/ 经典卡片。
 * `card` 为基线，不挂任何风格类；四个风格类互斥（一次只挂一个）。
 * 设置变更时由 `main.ts` 的 `applySettingsToOpenViews` 调此方法来即时回退 / 切换，
 * 无需整树重建（`contentEl` 的类在 `renderNote` 的 `empty()` 后仍然保留）。
 * 见 [[Plan-20261003-215547]] §7.1、[[Plan-20261005-200436]]、[[Plan-20261005-230336]]、[[Plan-20261007-063658]]。
 */
export function applyAppearanceStyle(view: TaskViewHost): void {
	const style = view.appearanceStyleProvider();
	view.contentEl.toggleClass('is-glass', style === 'glass');
	view.contentEl.toggleClass('is-modern', style === 'modern');
	view.contentEl.toggleClass('is-simple', style === 'simple');
	view.contentEl.toggleClass('is-morandi', style === 'morandi');
}

/**
 * 阈值（`recentTaskCount`）设置变更后由 `main.ts` 调用：
 * 刷新按钮 tooltip；仅当「显示最近任务」开启时重绘（阈值变化需重算分组），
 * 其余情况不动 DOM（[[Plan-20261005-101007]] §2.6）。
 */
export function applyRecentTaskCount(view: TaskViewHost): void {
	refreshToolbarState(view);
	if (view.filters.recentOnly) {
		view.renderNote(view.data);
	}
}

/**
 * 条目模板设置变更后由 `main.ts` 调用：重刷工具栏，只为更新「添加」按钮 tooltip 里的
 * 模板 hint（[[Discuss-20261007-062838]] §三.①）。不改 DOM 结构、不重绘列表。
 */
export function applyEntryTemplate(view: TaskViewHost): void {
	refreshToolbarState(view);
}
