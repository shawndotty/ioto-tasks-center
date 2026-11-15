/**
 * 四象限顶部过滤条：标题 / 汇总、项目范围下拉、状态 chip、侧栏开关
 * （[[Plan-20261115-201917]] §3.5 / §3.6）。
 *
 * 结构只建一次；切换 chip / 范围后由 `updateQuadrantFilterBar` 原地更新
 * `aria-pressed`、计数与 `data-*`，避免 `<select>` 因整块重建而失焦。
 */

import { t } from '../../lang/helpter';
import type {
	QuadrantProjectScope,
	QuadrantStatusKey,
} from '../../tasks-center/quadrant-data';
import type { QuadrantViewContext } from './context';

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

	const titleRowEl = headerEl.createDiv({
		cls: 'ioto-pq-header__title-row',
	});
	titleRowEl.createEl('h2', {
		cls: 'ioto-pq-header__title',
		text: t('priorityQuadrant.title'),
	});
	titleRowEl.createSpan({ cls: 'ioto-pq-header__summary' });

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

	const toggleEl = barEl.createEl('button', {
		cls: 'ioto-pq-sidebar-toggle',
	});
	toggleEl.type = 'button';
	toggleEl.setAttribute('aria-controls', 'ioto-pq-sidebar');
	toggleEl.createSpan({ text: t('priorityQuadrant.sidebar.toggle') });
	toggleEl.createSpan({ cls: 'ioto-pq-chip__count' });
	toggleEl.addEventListener('click', () => ctx.toggleSidebar());

	return headerEl;
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
}
