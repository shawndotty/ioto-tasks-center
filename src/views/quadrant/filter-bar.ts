/**
 * 四象限顶部过滤条：标题 / 汇总、项目范围下拉、状态 chip / 状态菜单、侧栏开关
 * （[[Plan-20261115-201917]] §3.5 / §3.6，页头网格化见 [[Plan-20261116-061758]] §3）。
 *
 * 结构只建一次；标题、摘要、过滤条、开关是 `headerEl` 的直接子节点，
 * 由 CSS 命名区域排布（宽屏一行 / 窄屏两行），断点切换不重建 DOM。
 * 切换 chip / 范围后由 `updateQuadrantFilterBar` 原地更新 `aria-pressed`、
 * 计数与 `data-*`，避免 `<select>` 因整块重建而失焦。
 */

import { Menu } from 'obsidian';

import { t } from '../../lang/helpter';
import type {
	QuadrantProjectScope,
	QuadrantStatusKey,
} from '../../tasks-center/quadrant-data';
import type { QuadrantViewContext } from './context';
import {
	buildQuadrantTimeControls,
	updateQuadrantTimeControls,
} from './time-filter-bar';

const STATUS_CHIP_ORDER: QuadrantStatusKey[] = [
	'in-progress',
	'todo',
	'completed',
];

function statusChipLabel(key: QuadrantStatusKey): string {
	switch (key) {
		case 'in-progress':
			return t('priorityQuadrant.status.inProgress');
		case 'todo':
			return t('priorityQuadrant.status.todo');
		case 'completed':
			return t('priorityQuadrant.status.completed');
	}
}

export function encodeQuadrantScope(scope: QuadrantProjectScope): string {
	if (scope.kind === 'project') {
		return `project:${scope.projectName ?? ''}`;
	}
	return scope.kind;
}

export function decodeQuadrantScope(value: string): QuadrantProjectScope {
	if (value === 'all' || value === 'unarchived') {
		return { kind: value };
	}
	if (value.startsWith('project:')) {
		return {
			kind: 'project',
			projectName: value.slice('project:'.length),
		};
	}
	return { kind: 'unarchived' };
}

export function buildQuadrantFilterBar(
	container: HTMLElement,
	ctx: QuadrantViewContext,
): HTMLElement {
	const headerEl = container.createDiv({ cls: 'ioto-pq-header' });

	headerEl.createEl('h2', {
		cls: 'ioto-pq-header__title',
		text: t('priorityQuadrant.title'),
	});
	headerEl.createSpan({ cls: 'ioto-pq-header__summary' });

	const barEl = headerEl.createDiv({ cls: 'ioto-pq-filterbar' });

	const scopeLabelEl = barEl.createEl('label', {
		cls: 'ioto-pq-filterbar__scope',
	});
	scopeLabelEl.createSpan({ text: t('priorityQuadrant.scope.label') });
	const selectEl = scopeLabelEl.createEl('select', {
		cls: 'ioto-pq-scope-select',
	});
	selectEl.ariaLabel = t('priorityQuadrant.scope.label');
	selectEl.addEventListener('change', () => {
		ctx.setProjectScope(decodeQuadrantScope(selectEl.value));
	});

	const chipsEl = barEl.createDiv({ cls: 'ioto-pq-chips' });
	chipsEl.setAttribute('role', 'group');
	chipsEl.setAttribute('aria-label', t('priorityQuadrant.status.groupLabel'));
	for (const key of STATUS_CHIP_ORDER) {
		const chipEl = chipsEl.createEl('button', {
			cls: 'ioto-pq-chip',
		});
		chipEl.type = 'button';
		chipEl.dataset.statusKey = key;
		chipEl.createSpan({ text: statusChipLabel(key) });
		chipEl.createSpan({ cls: 'ioto-pq-chip__count' });
		if (key === 'todo') {
			chipEl.title = t('priorityQuadrant.status.todoTooltip');
		}
		chipEl.addEventListener('click', () => ctx.toggleStatusKey(key));
	}

	// 窄屏把 chip 收进菜单；宽屏由 CSS 隐藏。两个入口都只读 `ctx.getStatusKeys()`，
	// chips 不 `remove()`，隐藏后 `aria-pressed` 仍继续回写（[[Plan-20261116-061758]] §3.4）。
	const statusBtnEl = barEl.createEl('button', { cls: 'ioto-pq-status-menu' });
	statusBtnEl.type = 'button';
	statusBtnEl.setAttribute('aria-haspopup', 'menu');
	statusBtnEl.createSpan({
		cls: 'ioto-pq-status-menu__label',
		text: t('priorityQuadrant.status.groupLabel'),
	});
	statusBtnEl.createSpan({ cls: 'ioto-pq-status-menu__count' });
	statusBtnEl.addEventListener('click', (event: MouseEvent) => {
		const menu = new Menu();
		buildQuadrantStatusMenu(menu, ctx);
		menu.showAtMouseEvent(event);
	});

	// 时间范围：宽屏下拉 / 窄屏菜单，二者都在 DOM，显示切换交给 CSS
	// （[[Plan-20261116-083330]] §3.3 / §3.4）。
	buildQuadrantTimeControls(barEl, ctx);

	// 开关放在 header 最右（[[Plan-20261116-060249]] §3.4）：过滤条里**只此一个**，
	// `updateQuadrantFilterBar` 在 `headerEl` 上按类名回写状态，作用域已覆盖此处。
	const toggleEl = headerEl.createEl('button', {
		cls: 'ioto-pq-sidebar-toggle ioto-pq-header__toggle',
	});
	toggleEl.type = 'button';
	toggleEl.setAttribute('aria-controls', 'ioto-pq-sidebar');
	toggleEl.setAttribute(
		'aria-label',
		t('priorityQuadrant.sidebar.toggleAria'),
	);
	toggleEl.createSpan({ text: t('priorityQuadrant.sidebar.toggle') });
	toggleEl.createSpan({ cls: 'ioto-pq-chip__count' });
	toggleEl.addEventListener('click', () => ctx.toggleSidebar());

	return headerEl;
}

/**
 * 窄屏状态菜单：分组标题 + 三个状态项（含计数、当前项打勾）。
 * 每次点击时按 `ctx` 现状重建，不缓存；`toggleStatusKey` 是纯内存翻转 + 重绘。
 */
export function buildQuadrantStatusMenu(
	menu: Menu,
	ctx: QuadrantViewContext,
): void {
	const model = ctx.getModel();
	const activeKeys = ctx.getStatusKeys();
	menu.addItem((item) => {
		item.setTitle(t('priorityQuadrant.status.groupLabel')).setIsLabel(
			true,
		);
	});
	for (const key of STATUS_CHIP_ORDER) {
		menu.addItem((item) => {
			item.setTitle(
				t('view.taskFilterSwitcher.menuItem', [
					statusChipLabel(key),
					String(model?.statusCounts[key] ?? 0),
				]),
			)
				.setChecked(activeKeys.has(key))
				.onClick(() => ctx.toggleStatusKey(key));
		});
	}
}

function optionSignature(ctx: QuadrantViewContext): string {
	return ctx
		.getProjectOptions()
		.map((project) => `${project.name}\u0000${project.archived ? 1 : 0}`)
		.join('\u0001');
}

function rebuildScopeOptions(
	selectEl: HTMLSelectElement,
	ctx: QuadrantViewContext,
): void {
	selectEl.empty();

	selectEl.createEl('option', {
		text: t('priorityQuadrant.scope.all'),
		value: 'all',
	});
	selectEl.createEl('option', {
		text: t('priorityQuadrant.scope.unarchived'),
		value: 'unarchived',
	});

	const projects = ctx.getProjectOptions();
	if (projects.length === 0) return;

	const groupEl = selectEl.createEl('optgroup', {
		attr: { label: t('priorityQuadrant.scope.projectGroup') },
	});
	for (const project of projects) {
		groupEl.createEl('option', {
			text: project.archived
				? `${project.name}${t('priorityQuadrant.scope.archivedSuffix')}`
				: project.name,
			value: `project:${project.name}`,
		});
	}
}

export function updateQuadrantFilterBar(
	headerEl: HTMLElement,
	ctx: QuadrantViewContext,
): void {
	const model = ctx.getModel();
	const summaryEl = headerEl.querySelector<HTMLElement>(
		'.ioto-pq-header__summary',
	);
	if (summaryEl) {
		summaryEl.setText(
			t('priorityQuadrant.summary', [String(model?.total ?? 0)]),
		);
	}

	const selectEl = headerEl.querySelector<HTMLSelectElement>(
		'.ioto-pq-scope-select',
	);
	if (selectEl) {
		if (selectEl.dataset.optionSignature !== optionSignature(ctx)) {
			rebuildScopeOptions(selectEl, ctx);
			selectEl.dataset.optionSignature = optionSignature(ctx);
		}
		selectEl.value = encodeQuadrantScope(ctx.getProjectScope());
	}

	const statusKeys = ctx.getStatusKeys();
	for (const chipEl of Array.from(
		headerEl.querySelectorAll<HTMLElement>('.ioto-pq-chip'),
	)) {
		const key = chipEl.dataset.statusKey as QuadrantStatusKey | undefined;
		if (!key) continue;
		const active = statusKeys.has(key);
		chipEl.classList.toggle('is-active', active);
		chipEl.setAttribute('aria-pressed', active ? 'true' : 'false');
		const countEl = chipEl.querySelector<HTMLElement>(
			'.ioto-pq-chip__count',
		);
		if (countEl) {
			countEl.setText(String(model?.statusCounts[key] ?? 0));
		}
	}

	const toggleEl = headerEl.querySelector<HTMLElement>(
		'.ioto-pq-sidebar-toggle',
	);
	if (toggleEl) {
		toggleEl.classList.toggle('is-active', ctx.isSidebarOpen());
		toggleEl.setAttribute(
			'aria-expanded',
			ctx.isSidebarOpen() ? 'true' : 'false',
		);
		const countEl = toggleEl.querySelector<HTMLElement>(
			'.ioto-pq-chip__count',
		);
		if (countEl) {
			countEl.setText(String(model?.counts.unlabeled ?? 0));
		}
	}

	const statusBtnEl = headerEl.querySelector<HTMLElement>(
		'.ioto-pq-status-menu',
	);
	if (statusBtnEl) {
		const included = [...statusKeys].reduce(
			(sum, key) => sum + (model?.statusCounts[key] ?? 0),
			0,
		);
		statusBtnEl
			.querySelector<HTMLElement>('.ioto-pq-status-menu__count')
			?.setText(String(included));
		const label = t('view.taskFilterSwitcher.current', [
			t('priorityQuadrant.status.groupLabel'),
			String(included),
		]);
		statusBtnEl.setAttribute('aria-label', label);
		statusBtnEl.setAttribute('title', label);
	}

	updateQuadrantTimeControls(headerEl, ctx);
}
