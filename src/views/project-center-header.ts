/**
 * 项目中心视图的头部渲染：标题、搜索输入、搜索/刷新/创建按钮。
 *
 * Phase 5 拆分后从 `iotoProjectCenterView.ts` 抽出。返回创建项目按钮元素，
 * 由 `render()` 持有以便后续刷新其 disabled 状态。
 */

import { setIcon } from 'obsidian';

import { t } from '../lang/helpter';
import { handleCreateProjectAction } from './project-center-actions';
import type { ProjectCenterViewContext } from './project-center-types';

export function buildProjectCenterHeader(
	headerEl: HTMLElement,
	ctx: ProjectCenterViewContext,
): HTMLButtonElement | null {
	const headerLeftEl = headerEl.createDiv({
		cls: 'ioto-project-center__header-left',
	});
	const titleEl = headerLeftEl.createDiv({
		cls: 'ioto-project-center__title',
		text: t('projectCenter.title'),
	});
	titleEl.setAttribute('role', 'heading');

	const actionsEl = headerEl.createDiv({
		cls: 'ioto-project-center__actions',
	});
	if (ctx.isProjectSearchVisible) {
		const searchControlsEl = actionsEl.createDiv({
			cls: 'ioto-project-center__search-controls',
		});
		const searchInputWrapperEl = searchControlsEl.createDiv({
			cls: 'ioto-project-center__search-input-wrapper',
		});
		const searchInputEl = searchInputWrapperEl.createEl('input', {
			cls: 'ioto-project-center__search-input',
			type: 'search',
		});
		searchInputEl.placeholder = t('projectCenter.search.placeholder');
		searchInputEl.value = ctx.projectSearchInputValue;
		searchInputEl.setAttribute('enterkeyhint', 'search');
		searchInputEl.setAttribute('autocapitalize', 'off');
		searchInputEl.setAttribute('autocomplete', 'off');
		searchInputEl.spellcheck = false;
		searchInputEl.addEventListener('input', () => {
			ctx.setProjectSearchInputValue(searchInputEl.value);
		});
		searchInputEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter') {
				return;
			}

			event.preventDefault();
			ctx.applyProjectSearchQuery();
		});

		if (ctx.projectSearchInputValue || ctx.projectSearchQuery) {
			const clearButtonEl = searchInputWrapperEl.createEl('button', {
				cls: 'ioto-project-center__search-clear-button',
			});
			clearButtonEl.type = 'button';
			clearButtonEl.ariaLabel = t('projectCenter.search.clear');
			clearButtonEl.title = t('projectCenter.search.clearShort');
			setIcon(clearButtonEl, 'x');
			clearButtonEl.addEventListener('click', () => {
				ctx.clearProjectSearch();
			});
		}

		const searchButtonEl = searchControlsEl.createEl('button', {
			cls: 'ioto-project-center__search-button',
			text: t('projectCenter.search.button'),
		});
		searchButtonEl.type = 'button';
		searchButtonEl.ariaLabel = t('projectCenter.search.button');
		searchButtonEl.addEventListener('click', () => {
			ctx.applyProjectSearchQuery();
		});

		if (ctx.consumeShouldFocusProjectSearch()) {
			if (
				typeof window !== 'undefined' &&
				window.requestAnimationFrame
			) {
				window.requestAnimationFrame(() => {
					searchInputEl.focus();
				});
			} else {
				searchInputEl.focus();
			}
		}
	}

	const searchToggleButtonEl = actionsEl.createEl('button', {
		cls: 'ioto-project-center__icon-button',
	});
	searchToggleButtonEl.type = 'button';
	searchToggleButtonEl.ariaLabel = t('projectCenter.action.search');
	searchToggleButtonEl.title = t('projectCenter.action.search');
	setIcon(searchToggleButtonEl, 'search');
	searchToggleButtonEl.addEventListener('click', () => {
		ctx.toggleProjectSearch();
	});

	const refreshButtonEl = actionsEl.createEl('button', {
		cls: 'ioto-project-center__icon-button',
	});
	refreshButtonEl.type = 'button';
	refreshButtonEl.ariaLabel = t('projectCenter.action.refresh');
	refreshButtonEl.title = t('projectCenter.action.refresh');
	setIcon(refreshButtonEl, 'refresh-cw');
	refreshButtonEl.addEventListener('click', () => {
		void ctx.refreshFromVaultChange();
	});

	const createProjectButtonEl = actionsEl.createEl('button', {
		cls: 'ioto-project-center__icon-button',
	});
	createProjectButtonEl.type = 'button';
	createProjectButtonEl.disabled = !ctx.canCreateProject();
	createProjectButtonEl.ariaLabel = t(
		'projectCenter.action.createProject',
	);
	createProjectButtonEl.title = t('projectCenter.action.createProject');
	setIcon(createProjectButtonEl, 'plus');
	createProjectButtonEl.addEventListener('click', () => {
		void handleCreateProjectAction(ctx);
	});
	return createProjectButtonEl;
}
