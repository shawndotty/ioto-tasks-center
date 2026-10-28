/**
 * 任务链接浏览窗口（[[Plan-20261028-154638]] §4.8、[[Plan-20261028-190721]] §3）。
 *
 * 打开类**不 import 任何视图模块**：只收一个快照 Promise、一个点击回调，
 * 以及两个「值注入」句柄（预览内双链解析 / 外链打开）。因此任务中心没打开时
 * 也能用（命令 1），也避免 ui → views 的值级依赖边。
 */

import {
	Component,
	Keymap,
	MarkdownRenderer,
	Modal,
	Platform,
	TFile,
	setIcon,
	type App,
} from 'obsidian';

import { t, type TranslationKey } from '../lang/helpter';
import { mapWithConcurrency } from '../tasks-center/async';
import { stripFrontmatter } from '../tasks-center/markdown-body';
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
	/** 预览内双链解析（views 层用 metadataCache + roots 判定 kind）。null = 解析不到。 */
	resolvePreviewLink?: (
		linktext: string,
		sourcePath: string,
	) => { path: string; kind: TaskLinkEntryKind } | null;
	/** 预览内外链（views 层负责 `toExternalOpenUrl` + `window.open`）。 */
	openExternalLink?: (href: string) => void;
}

interface PreviewFrame {
	entry: TaskLinkEntry;
	kind: TaskLinkEntryKind;
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
	/** 预览栈：空 = 列表态（窄），非空 = 展开态（两栏 / 手机换页）。 */
	private previewStack: PreviewFrame[] = [];
	/** 分类 → 最近一次预览的 path；只用于列表高亮，关窗即弃。 */
	private readonly selectedByCategory = new Map<TaskLinkCategory, string>();
	private previewComponent: Component | null = null;
	private previewSourcePath = '';
	/** 竞态令牌：只有最后一次 renderPreview 的结果会被画上去。 */
	private previewToken = 0;
	private bodyEl: HTMLElement | null = null;
	private listColEl: HTMLElement | null = null;
	private previewEl: HTMLElement | null = null;
	private previewTitleEl: HTMLElement | null = null;
	private previewPathEl: HTMLElement | null = null;
	private previewBodyEl: HTMLElement | null = null;

	constructor(app: App, options: TaskLinksModalOptions) {
		super(app);
		this.options = options;
	}

	onOpen(): void {
		this.isActive = true;
		this.modalEl.addClass('ioto-tasks-center__task-links-modal');
		// 手机靠 mod-lg 拿满屏（核心会同时改底色与 --interactive-normal，接受既定外观）。
		if (Platform.isPhone) {
			this.modalEl.addClass('mod-lg');
		}
		this.setTitle(t('taskLinks.title'));
		this.contentEl.empty();
		this.renderStatus(t('taskLinks.state.loading'));
		void this.load();
	}

	onClose(): void {
		this.isActive = false;
		this.disposePreviewComponent();
		this.contentEl.empty();
		this.snapshot = null;
		this.filterResult = null;
		this.bodies.clear();
		this.tabButtons.clear();
		this.previewStack = [];
		this.previewToken += 1;
		this.selectedByCategory.clear();
		this.listEl = null;
		this.searchInputEl = null;
		this.bodyEl = null;
		this.listColEl = null;
		this.previewEl = null;
		this.previewTitleEl = null;
		this.previewPathEl = null;
		this.previewBodyEl = null;
		this.previewSourcePath = '';
		this.query = '';
	}

	/**
	 * 三段式 Esc：有搜索词只清词 → 有预览收起预览 → 都没有才关窗。
	 *
	 * 必须覆盖 `onEscapeKey`：核心 Modal 在构造时把 `this.onEscapeKey.bind(this)`
	 * 注册进自己的 scope，而 scope 的处理器由**全局** keymap 在捕获阶段触发，
	 * 插件在 `modalEl` 上加的任何捕获监听都排在它之后（实测先被关窗）。
	 * 覆盖后走的是同一条注册路径，且 `e.defaultPrevented` 会被核心原样尊重。
	 */
	onEscapeKey(event: KeyboardEvent): void {
		event.preventDefault();
		if (this.query) {
			this.applyQuery('');
			this.searchInputEl?.focus();
			return;
		}

		if (this.previewStack.length > 0) {
			this.collapsePreview();
			return;
		}

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

	/** 预览正文：先查预读缓存，未命中才懒读（顺着双链走到的笔记不在 `bodies` 里）。 */
	private async readBody(path: string): Promise<string | null> {
		const cached = this.bodies.get(path);
		if (cached !== undefined) {
			return cached;
		}

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return null;
		}

		try {
			const raw = await this.app.vault.cachedRead(file);
			this.bodies.set(path, raw);
			return raw;
		} catch {
			return null;
		}
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
		this.bodyEl = this.contentEl.createDiv({
			cls: 'ioto-tasks-center__task-links-body',
		});
		this.listColEl = this.bodyEl.createDiv({
			cls: 'ioto-tasks-center__task-links-list-col',
		});

		// 任务信息块放在**左栏内部**而不是 contentEl 顶层：两栏共用同一个起点，
		// 右侧预览才能和左侧信息区顶部严格对齐（[[Report-20261028-200214]]）。
		const infoEl = this.listColEl.createDiv({
			cls: 'ioto-tasks-center__task-links-info',
		});
		infoEl.createDiv({
			cls: 'ioto-tasks-center__modal-desc',
			text: t('taskLinks.subject', [snapshot.taskTitle]),
		});

		if (snapshot.parents.length > 0) {
			const parentRowEl = infoEl.createDiv({
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
					// 父任务只是「看一眼」，不占用分类的选中记忆。
					this.previewFromList(parent, 'task', { remember: false });
				});
			}
		}

		const tabsEl = this.listColEl.createDiv({
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

		const searchEl = this.listColEl.createEl('input', {
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

		this.listEl = this.listColEl.createDiv({
			cls: 'ioto-tasks-center__task-links-list',
		});

		this.renderPreviewPane();

		this.updateTabs();
		this.renderList();
	}

	/** 预览列常驻 DOM（列表态整列 display:none），只换里面的内容。 */
	private renderPreviewPane(): void {
		if (!this.bodyEl) {
			return;
		}

		this.previewEl = this.bodyEl.createDiv({
			cls: 'ioto-tasks-center__task-links-preview',
		});

		const headerEl = this.previewEl.createDiv({
			cls: 'ioto-tasks-center__task-links-preview-header',
		});
		const backEl = headerEl.createEl('button', {
			cls: 'clickable-icon',
			attr: {
				type: 'button',
				'aria-label': t('taskLinks.preview.back'),
			},
		});
		setIcon(backEl, 'arrow-left');
		backEl.addEventListener('click', () => {
			this.goBack();
		});

		const metaEl = headerEl.createDiv({
			cls: 'ioto-tasks-center__task-links-preview-meta',
		});
		this.previewTitleEl = metaEl.createDiv({
			cls: 'ioto-tasks-center__task-links-preview-title',
		});
		this.previewPathEl = metaEl.createDiv({
			cls: 'ioto-tasks-center__task-links-preview-path',
		});

		const openEl = headerEl.createEl('button', {
			cls: 'ioto-tasks-center__task-links-preview-open',
			text: t('taskLinks.preview.openNote'),
			attr: { type: 'button' },
		});
		openEl.addEventListener('click', () => {
			const top = this.previewStack[this.previewStack.length - 1];
			if (top) {
				this.openEntry(top.entry, top.kind);
			}
		});

		this.previewBodyEl = this.previewEl.createDiv({
			cls: 'ioto-tasks-center__task-links-preview-body markdown-rendered',
		});
		this.attachPreviewLinkDelegate(this.previewBodyEl);
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
		// 整表重建：高亮只在重建时按记忆决定，不存在节点复用 → 不会有残留。
		const selectedPath = this.selectedByCategory.get(category);
		for (const entry of entries) {
			const itemEl = listEl.createEl('button', {
				cls: 'ioto-tasks-center__task-links-item',
				attr: { type: 'button', title: entry.subPath },
			});
			if (entry.path === selectedPath) {
				itemEl.addClass('is-active');
			}
			itemEl.createSpan({
				cls: 'ioto-tasks-center__task-links-item-title',
				text: entry.title,
			});
			itemEl.createSpan({
				cls: 'ioto-tasks-center__task-links-item-path',
				text: entry.subPath,
			});
			itemEl.addEventListener('click', (event) => {
				if (Keymap.isModEvent(event)) {
					this.openEntry(entry, kind);
					return;
				}
				this.previewFromList(entry, kind);
			});
			itemEl.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter') {
					return;
				}
				// 挡掉按钮把 Enter 合成 click（那会走单选预览）。
				event.preventDefault();
				this.openEntry(entry, kind);
			});
		}
	}

	// ---------------------------------------------------------------
	// 预览
	// ---------------------------------------------------------------

	/** 列表条目 / 父级药丸 → 预览（栈重置为深度 1）。 */
	private previewFromList(
		entry: TaskLinkEntry,
		kind: TaskLinkEntryKind,
		options: { remember?: boolean } = {},
	): void {
		if (options.remember !== false) {
			this.selectedByCategory.set(this.activeCategory, entry.path);
			this.renderList();
		}

		this.previewStack = [{ entry, kind }];
		this.modalEl.addClass('is-split');
		this.renderPreview();
	}

	/** 预览内双链 → 压栈（深度 +1），列表高亮不变。 */
	private pushPreview(entry: TaskLinkEntry, kind: TaskLinkEntryKind): void {
		this.previewStack.push({ entry, kind });
		this.modalEl.addClass('is-split');
		this.renderPreview();
	}

	/**
	 * `←` 一个按钮两段语义：深度 >1 退一层；深度 1 收起预览。
	 * 「收起」与 Esc 第二段同源 —— 预览只是窗内的一个状态。
	 */
	private goBack(): void {
		if (this.previewStack.length > 1) {
			this.previewStack.pop();
			this.renderPreview();
			return;
		}

		this.collapsePreview();
	}

	private collapsePreview(): void {
		this.previewStack = [];
		this.previewToken += 1;
		this.selectedByCategory.clear();
		this.modalEl.removeClass('is-split');
		this.disposePreviewComponent();
		this.previewBodyEl?.empty();
		this.previewSourcePath = '';
		// 高亮随整表重建一并消失。
		this.renderList();
	}

	private renderPreview(): void {
		const top = this.previewStack[this.previewStack.length - 1];
		const bodyEl = this.previewBodyEl;
		if (!top || !bodyEl) {
			return;
		}

		const token = (this.previewToken += 1);

		// 每帧换一个宿主管子：Modal 不是 Component（公共 d.ts 无 addChild），
		// 所以自建 Component 并自行 load/unload，换页/关窗都立即回收。
		this.disposePreviewComponent();
		const component = new Component();
		component.load();
		this.previewComponent = component;

		this.previewSourcePath = top.entry.path;
		this.previewTitleEl?.setText(top.entry.title);
		this.previewPathEl?.setText(top.entry.subPath);

		const cached = this.bodies.get(top.entry.path);
		if (cached === undefined) {
			bodyEl.empty();
			bodyEl.createDiv({
				cls: 'ioto-tasks-center__task-links-empty',
				text: t('taskLinks.state.loading'),
			});
			void this.readBody(top.entry.path).then((raw) => {
				this.paintPreviewBody(raw, component, token);
			});
			return;
		}

		this.paintPreviewBody(cached, component, token);
	}

	/** 卸载当前预览的宿主管子（连同它带起的嵌入子组件一起回收）。 */
	private disposePreviewComponent(): void {
		if (!this.previewComponent) {
			return;
		}

		this.previewComponent.unload();
		this.previewComponent = null;
	}

	private paintPreviewBody(
		raw: string | null,
		component: Component,
		token: number,
	): void {
		const bodyEl = this.previewBodyEl;
		// 最后一帧胜出：换页过快时旧结果直接丢弃。
		if (!bodyEl || token !== this.previewToken) {
			return;
		}

		bodyEl.empty();
		// 先归零再渲染：MarkdownRenderer 的基础 DOM 同步 append，异步补齐的图片只撑高。
		bodyEl.scrollTop = 0;
		if (raw === null) {
			bodyEl.createDiv({
				cls: 'ioto-tasks-center__task-links-empty',
				text: t('taskLinks.preview.missing'),
			});
			return;
		}

		void MarkdownRenderer.render(
			this.app,
			stripFrontmatter(raw),
			bodyEl,
			this.previewSourcePath,
			component,
		);
	}

	/**
	 * 预览内的链接一律自己接管：核心只在 Markdown View 的预览容器装了这条委托，
	 * 不接管的话双链点了没反应、外链会落进 `<a target="_blank">`（Electron 拒载 file://）。
	 *
	 * 容器常驻、只 `empty()` 子节点，所以监听只挂一次，不会随换页丢失。
	 */
	private attachPreviewLinkDelegate(rootEl: HTMLElement): void {
		rootEl.addEventListener('click', (event) => {
			const target =
				event.target instanceof HTMLElement ? event.target : null;
			const internal = target?.closest('a.internal-link');
			const linktext = internal?.getAttribute('data-href');
			if (internal && linktext) {
				// 挡掉 <a> 默认导航。
				event.preventDefault();
				event.stopPropagation();
				const from = this.previewSourcePath;
				const resolved = from
					? this.options.resolvePreviewLink?.(linktext, from)
					: null;
				if (!resolved) {
					// 解析不到（多为尚未创建的新笔记）→ 不动作，也不会误开标签页。
					return;
				}
				const entry = this.toEntry(resolved.path);
				if (!entry) {
					return;
				}
				this.pushPreview(entry, resolved.kind);
				return;
			}

			const external = target?.closest('a.external-link');
			const href = external?.getAttribute('href');
			if (href) {
				event.preventDefault();
				event.stopPropagation();
				this.options.openExternalLink?.(href);
			}
		});
	}

	/** 解析结果 → 条目：优先复用快照里现成的一条（标题口径一致），否则就地造。 */
	private toEntry(path: string): TaskLinkEntry | null {
		const snapshot = this.snapshot;
		if (!snapshot) {
			return null;
		}

		for (const parent of snapshot.parents) {
			if (parent.path === path) {
				return parent;
			}
		}
		for (const category of TASK_LINK_CATEGORIES) {
			for (const entry of snapshot.sections[category] ?? []) {
				if (entry.path === path) {
					return entry;
				}
			}
		}

		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			return null;
		}
		return {
			path: file.path,
			title: file.basename,
			subPath: file.path.replace(/\.md$/i, ''),
		};
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
