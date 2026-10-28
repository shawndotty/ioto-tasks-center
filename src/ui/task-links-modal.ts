/**
 * 任务链接浏览窗口（[[Plan-20261028-154638]] §4.8）。
 *
 * 打开类**不 import 任何视图模块**：只收一个快照 Promise + 一个点击回调，
 * 因此任务中心没打开时也能用（命令 1），也避免 ui → views 的值级依赖边。
 */

import { Modal, TFile, type App } from 'obsidian';

import { t, type TranslationKey } from '../lang/helpter';
import { mapWithConcurrency } from '../tasks-center/async';
import {
	TASK_LINK_CATEGORIES,
	filterTaskLinks,
	type TaskLinksFilterResult,
} from '../tasks-center/task-links-index';
import type {
	TaskLinkCategory,
	TaskLinkEntry,
	TaskLinksSnapshot,
} from '../tasks-center/types';

/** 正文预读并发：列表通常只有个位数到几十条，8 足够且不打满磁盘。 */
const BODY_READ_CONCURRENCY = 8;

const TAB_LABEL_KEYS: Record<TaskLinkCategory, TranslationKey> = {
	subtask: 'taskLinks.tabs.subtask',
	input: 'taskLinks.tabs.input',
	output: 'taskLinks.tabs.output',
	outcome: 'taskLinks.tabs.outcome',
};

const EMPTY_KEYS: Record<TaskLinkCategory, TranslationKey> = {
	subtask: 'taskLinks.empty.subtask',
	input: 'taskLinks.empty.input',
	output: 'taskLinks.empty.output',
	outcome: 'taskLinks.empty.outcome',
};

export type TaskLinkEntryKind = 'task' | 'note';

export interface TaskLinksModalOptions {
	snapshot: Promise<TaskLinksSnapshot>;
	onOpenEntry: (entry: TaskLinkEntry, kind: TaskLinkEntryKind) => void;
}

export class TaskLinksModal extends Modal {
	private readonly options: TaskLinksModalOptions;
	private isActive = false;
	private snapshot: TaskLinksSnapshot | null = null;
	private bodies = new Map<string, string>();
	private query = '';
	private activeCategory: TaskLinkCategory = 'subtask';
	private filterResult: TaskLinksFilterResult | null = null;
	/** 重绘只换列表与计数，输入框节点保持复用 → 打字不会丢焦点。 */
	private readonly tabButtons = new Map<
		TaskLinkCategory,
		HTMLButtonElement
	>();
	private listEl: HTMLElement | null = null;
	private searchInputEl: HTMLInputElement | null = null;

	constructor(app: App, options: TaskLinksModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.isActive = true;
		this.modalEl.addClass('ioto-tasks-center__task-links-modal');
		this.setTitle(t('taskLinks.title'));
		this.contentEl.empty();
		this.renderStatus(t('taskLinks.state.loading'));
		void this.load();
	}

	onClose(): void {
		this.isActive = false;
		this.contentEl.empty();
		this.snapshot = null;
		this.filterResult = null;
		this.bodies.clear();
		this.tabButtons.clear();
		this.listEl = null;
		this.searchInputEl = null;
		this.query = '';
	}

	/**
	 * 两段式 Esc：有搜索词时只清词，空词时才关窗。
	 *
	 * 必须覆盖 `onEscapeKey`：核心 Modal 在构造时把 `this.onEscapeKey.bind(this)`
	 * 注册进自己的 scope，而 scope 的处理器由**全局** keymap 在捕获阶段触发，
	 * 插件在 `modalEl` 上加的任何捕获监听都排在它之后（实测先被关窗）。
	 * 覆盖后走的是同一条注册路径，且 `e.defaultPrevented` 会被核心原样尊重。
	 */
	onEscapeKey(event: KeyboardEvent): void {
		if (this.query) {
			event.preventDefault();
			this.applyQuery('');
			this.searchInputEl?.focus();
			return;
		}

		event.preventDefault();
		this.close();
	}

	private async load(): Promise<void> {
		let snapshot: TaskLinksSnapshot | null = null;
		try {
			snapshot = await this.options.snapshot;
		} catch {
			snapshot = null;
		}

		if (!this.isAlive()) {
			return;
		}

		if (!snapshot) {
			this.renderStatus(t('taskLinks.state.error'));
			return;
		}

		this.snapshot = snapshot;
		this.bodies = await this.readBodies(collectEntryPaths(snapshot));
		if (!this.isAlive()) {
			return;
		}

		this.renderShell();
	}

	/** 关闭后到达的结果直接丢弃（`isActive` + `isConnected` 双判）。 */
	private isAlive(): boolean {
		return this.isActive && Boolean(this.modalEl.isConnected);
	}

	private async readBodies(
		paths: readonly string[],
	): Promise<Map<string, string>> {
		const bodies = new Map<string, string>();
		await mapWithConcurrency(
			[...new Set(paths)],
			BODY_READ_CONCURRENCY,
			async (path) => {
				const file = this.app.vault.getAbstractFileByPath(path);
				if (!(file instanceof TFile)) {
					return;
				}

				try {
					bodies.set(path, await this.app.vault.cachedRead(file));
				} catch {
					// 读失败按「没有正文」处理：只影响搜索命中，不该让面板空掉。
				}
			},
		);
		return bodies;
	}

	private renderStatus(text: string): void {
		this.contentEl.empty();
		this.contentEl.createDiv({
			cls: 'ioto-tasks-center__task-links-empty',
			text,
		});
	}

	private renderShell(): void {
		const snapshot = this.snapshot;
		if (!snapshot) {
			return;
		}

		this.contentEl.empty();
		this.contentEl.createDiv({
			cls: 'ioto-tasks-center__modal-desc',
			text: t('taskLinks.subject', [snapshot.taskTitle]),
		});

		if (snapshot.parents.length > 0) {
			const parentRowEl = this.contentEl.createDiv({
				cls: 'ioto-tasks-center__task-links-parent',
			});
			parentRowEl.createSpan({
				cls: 'ioto-tasks-center__task-links-parent-label',
				text: t('taskLinks.parent.label'),
			});
			for (const parent of snapshot.parents) {
				const parentEl = parentRowEl.createEl('button', {
					cls: 'ioto-tasks-center__task-links-parent-item',
					text: parent.title,
					attr: { type: 'button', title: parent.subPath },
				});
				parentEl.addEventListener('click', () => {
					this.openEntry(parent, 'task');
				});
			}
		}

		const tabsEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__tabs ioto-tasks-center__task-links-tabs',
		});
		for (const category of TASK_LINK_CATEGORIES) {
			const tabEl = tabsEl.createEl('button', {
				cls: 'ioto-tasks-center__tab ioto-tasks-center__task-links-tab',
				attr: { type: 'button', 'data-tab-key': category },
			});
			tabEl.createSpan({
				cls: 'ioto-tasks-center__tab-label',
				text: t(TAB_LABEL_KEYS[category]),
			});
			tabEl.createSpan({
				cls: 'ioto-tasks-center__tab-count',
				text: '0',
			});
			tabEl.addEventListener('click', () => {
				this.activeCategory = category;
				this.updateTabs();
				this.renderList();
			});
			this.tabButtons.set(category, tabEl);
		}

		const searchEl = this.contentEl.createEl('input', {
			cls: 'ioto-tasks-center__task-links-search',
			attr: {
				type: 'search',
				placeholder: t('taskLinks.search.placeholder'),
			},
		});
		this.searchInputEl = searchEl;
		searchEl.addEventListener('input', () => {
			this.applyQuery(searchEl.value);
		});

		this.listEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__task-links-list',
		});

		this.updateTabs();
		this.renderList();
	}

	private applyQuery(value: string): void {
		this.query = value;
		if (this.searchInputEl && this.searchInputEl.value !== value) {
			this.searchInputEl.value = value;
		}
		this.updateTabs();
		this.renderList();
	}

	private updateTabs(): void {
		const snapshot = this.snapshot;
		if (!snapshot) {
			return;
		}

		this.filterResult = filterTaskLinks(snapshot, this.query, this.bodies);
		for (const category of TASK_LINK_CATEGORIES) {
			const tabEl = this.tabButtons.get(category);
			if (!tabEl) {
				continue;
			}

			const count = this.filterResult.counts[category];
			const countEl = tabEl.querySelector(
				'.ioto-tasks-center__tab-count',
			);
			if (countEl) {
				countEl.textContent = String(count);
			}
			tabEl.toggleClass('is-empty', count === 0);
			tabEl.toggleClass('is-active', category === this.activeCategory);
		}
	}

	private renderList(): void {
		const listEl = this.listEl;
		const snapshot = this.snapshot;
		if (!listEl || !snapshot) {
			return;
		}

		listEl.empty();
		const category = this.activeCategory;
		// 根目录不存在优先于另外两种空态：否则用户看到的是「暂无关联」，
		// 而真实原因是路径配错了（§3.6）。
		const missingRoot = snapshot.missingRoots[category];
		if (missingRoot) {
			listEl.createDiv({
				cls: 'ioto-tasks-center__task-links-empty',
				text: t('taskLinks.state.rootMissing', [missingRoot]),
			});
			return;
		}

		const entries = this.filterResult?.sections[category] ?? [];
		if (entries.length === 0) {
			listEl.createDiv({
				cls: 'ioto-tasks-center__task-links-empty',
				text: this.query.trim()
					? t('taskLinks.emptySearch')
					: t(EMPTY_KEYS[category]),
			});
			return;
		}

		const kind: TaskLinkEntryKind =
			category === 'subtask' ? 'task' : 'note';
		for (const entry of entries) {
			const itemEl = listEl.createEl('button', {
				cls: 'ioto-tasks-center__task-links-item',
				attr: { type: 'button', title: entry.subPath },
			});
			itemEl.createSpan({
				cls: 'ioto-tasks-center__task-links-item-title',
				text: entry.title,
			});
			itemEl.createSpan({
				cls: 'ioto-tasks-center__task-links-item-path',
				text: entry.subPath,
			});
			itemEl.addEventListener('click', () => {
				this.openEntry(entry, kind);
			});
		}
	}

	/** 先关窗再打开：Modal 是浮层，不关就会把刚点开的笔记挡在背后。 */
	private openEntry(entry: TaskLinkEntry, kind: TaskLinkEntryKind): void {
		this.close();
		this.options.onOpenEntry(entry, kind);
	}
}

function collectEntryPaths(snapshot: TaskLinksSnapshot): string[] {
	const paths = snapshot.parents.map((entry) => entry.path);
	for (const category of TASK_LINK_CATEGORIES) {
		for (const entry of snapshot.sections[category] ?? []) {
			paths.push(entry.path);
		}
	}
	return paths;
}
