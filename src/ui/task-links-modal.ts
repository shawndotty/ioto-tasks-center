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
	applySearchHighlight,
	collectSearchHits,
	stepHitIndex,
} from '../tasks-center/search-highlight';
import {
	TASK_LINK_CATEGORIES,
	filterTaskLinks,
	type TaskLinksFilterResult,
} from '../tasks-center/task-links-index';
import type {
	TaskLinkCategory,
	TaskLinkEntry,
	TaskLinkEntryKind,
	TaskLinksSnapshot,
} from '../tasks-center/types';

/** 唯一判据：能当正文渲染的只有 Markdown。非 md 一律走嵌入分支。 */
function isMarkdownPath(app: App, path: string): boolean {
	const file = app.vault.getAbstractFileByPath(path);
	return file instanceof TFile && file.extension.toLowerCase() === 'md';
}

/** 正文预读并发：列表通常只有个位数到几十条，8 足够且不打满磁盘。 */
const BODY_READ_CONCURRENCY = 8;

/**
 * 预览正文的命中 span 类名（与 Task View 的 `ioto-task-view__search-hit` 分开）：
 * 两个容器可能同时存在，类名分开才能各自 unwrap / 计数，互不拆台。
 */
const TASK_LINKS_HIT_CLASS = 'ioto-tasks-center__task-links-hit';

/** 当前定位命中的加重类（对应 `--text-selection`）。 */
const HIT_CURRENT_CLASS = 'is-current';

/** pdf 预览态的 bodyEl 状态类（CSS 靠它把 .pdf-embed 撑满）。 */
const PDF_EMBED_STATE_CLASS = 'is-pdf-embed';

/** 核心嵌入组件的最小形状（`embedRegistry` 无 d.ts，只声明用到的那几项）。 */
interface CoreEmbed extends Component {
	loadFile(): void;
}

/** 核心嵌入工厂的入参：`displayMode: false` 才会走连续滚动而不是单页快照。 */
interface CoreEmbedContext {
	app: App;
	containerEl: HTMLElement;
	linktext: string;
	sourcePath: string;
	displayMode: boolean;
	showInline: boolean;
	depth: number;
}

type CoreEmbedCreator = (
	context: CoreEmbedContext,
	file: TFile,
	subpath: string,
) => CoreEmbed | null;

const TAB_LABEL_KEYS: Record<TaskLinkCategory, TranslationKey> = {
	subtask: 'taskLinks.tabs.subtask',
	input: 'taskLinks.tabs.input',
	output: 'taskLinks.tabs.output',
	outcome: 'taskLinks.tabs.outcome',
	other: 'taskLinks.tabs.other',
};

const EMPTY_KEYS: Record<TaskLinkCategory, TranslationKey> = {
	subtask: 'taskLinks.empty.subtask',
	input: 'taskLinks.empty.input',
	output: 'taskLinks.empty.output',
	outcome: 'taskLinks.empty.outcome',
	other: 'taskLinks.empty.other',
};

export type { TaskLinkEntryKind } from '../tasks-center/types';

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
	/** 「查看笔记 / 打开文件」按钮：文案随预览的是 md 还是附件切换。 */
	private previewOpenEl: HTMLButtonElement | null = null;
	/** 当前预览是「附件嵌入」而不是渲染出的正文（决定 `.file-embed` 的点击要不要接管）。 */
	private previewIsEmbed = false;
	/** 盯着 `.pdf-embed` 内联高度的观察器：核心缩放 / 窗口变化时会重算页高。 */
	private pdfHeightObserver: MutationObserver | null = null;
	/** 预览正文的命中集合：只由 `refreshPreviewHits` 一次算出，染色与计数共用。 */
	private hitEls: HTMLElement[] = [];
	private hitIndex = -1;
	private activeHitEl: HTMLElement | null = null;
	private hitBarEl: HTMLElement | null = null;
	private hitCountEl: HTMLElement | null = null;
	private hitPrevEl: HTMLButtonElement | null = null;
	private hitNextEl: HTMLButtonElement | null = null;

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
		this.previewOpenEl = null;
		this.previewSourcePath = '';
		this.previewIsEmbed = false;
		this.query = '';
		this.hitEls = [];
		this.hitIndex = -1;
		this.activeHitEl = null;
		this.hitBarEl = null;
		this.hitCountEl = null;
		this.hitPrevEl = null;
		this.hitNextEl = null;
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

				if (!isMarkdownPath(this.app, path)) {
					return; // 🔴 二进制不预读：cachedRead 对 pdf 会返回 6.9MB 乱码且不报错
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

		// 同 readBodies 的白名单：二进制绝不进 `bodies`（`renderPreview` 已在
		// 此之前把非 md 分流到嵌入分支，这里是第二道保险）。
		if (!isMarkdownPath(this.app, path)) {
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
		// Enter / Shift+Enter 走「下一个 / 上一个匹配」：与列表条目的 Enter（打开）
		// 不冲突，因为只在预览已开时接管（[[Plan-20261028-221530]] §三 S3）。
		searchEl.addEventListener('keydown', (event) => {
			if (event.isComposing) {
				return; // IME 组字中的 Enter 是选词，不是跳转
			}
			if (event.key !== 'Enter') {
				return;
			}
			if (this.previewStack.length === 0) {
				return; // 列表态不替用户选第一条
			}
			event.preventDefault();
			this.stepHit(event.shiftKey ? -1 : 1);
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
		this.previewOpenEl = openEl;
		openEl.addEventListener('click', () => {
			const top = this.previewStack[this.previewStack.length - 1];
			if (top) {
				this.openEntry(top.entry, top.kind);
			}
		});

		// 定位细条：常驻 DOM、只在「有查询 + 预览开」时显示，避免正文随输入跳动。
		const hitsEl = this.previewEl.createDiv({
			cls: 'ioto-tasks-center__task-links-preview-hits is-hidden',
		});
		this.hitPrevEl = createHitButton(
			hitsEl,
			'chevron-up',
			t('taskLinks.preview.matchPrev'),
			() => {
				this.stepHit(-1);
			},
		);
		this.hitNextEl = createHitButton(
			hitsEl,
			'chevron-down',
			t('taskLinks.preview.matchNext'),
			() => {
				this.stepHit(1);
			},
		);
		this.hitCountEl = hitsEl.createSpan({
			cls: 'ioto-tasks-center__task-links-hit-count',
		});
		this.hitBarEl = hitsEl;

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
		// 预览已开时查询变化 = 就地重扫正文，并跳到新查询的第一处命中。
		this.refreshPreviewHits({ resetIndex: true, locate: true });
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
					this.openEntry(entry, entry.kind);
					return;
				}
				this.previewFromList(entry, entry.kind);
			});
			itemEl.addEventListener('keydown', (event) => {
				if (event.key !== 'Enter') {
					return;
				}
				// 挡掉按钮把 Enter 合成 click（那会走单选预览）。
				event.preventDefault();
				this.openEntry(entry, entry.kind);
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
		this.clearPdfEmbedState(this.previewBodyEl);
		this.previewSourcePath = '';
		this.previewIsEmbed = false;
		// 命中集合随正文一起作废（细条按 previewStack 为空自动隐藏）。
		this.resetPreviewHits();
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
		this.previewOpenEl?.setText(
			t(
				isMarkdownPath(this.app, top.entry.path)
					? 'taskLinks.preview.openNote'
					: 'taskLinks.preview.openFile',
			),
		);

		// 非 md：整件事交给核心 embedRegistry，必须在 `cached` 判断之前分流，
		// 否则会先落「正在加载…」再落乱码。
		if (!isMarkdownPath(this.app, top.entry.path)) {
			this.paintEmbedPreview(top, component);
			return;
		}

		const cached = this.bodies.get(top.entry.path);
		if (cached === undefined) {
			bodyEl.empty();
			// 加载态没有正文：计数必须归零，否则上一篇的 N 会挂在新页上。
			this.resetPreviewHits();
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
		// 页高观察器挂在上一个宿主管子上，跟它一起作废。
		this.disposePdfHeightObserver();
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
		// pdf 切回 md：`empty()` 不清类名与内联高度，残留会让 pdf 的撑满规则与
		// 「一页高」基准继续挂在正文上。
		this.clearPdfEmbedState(bodyEl);
		// 先归零再渲染：MarkdownRenderer 的基础 DOM 同步 append，异步补齐的图片只撑高。
		bodyEl.scrollTop = 0;
		this.previewIsEmbed = false;
		if (raw === null) {
			bodyEl.createDiv({
				cls: 'ioto-tasks-center__task-links-empty',
				text: t('taskLinks.preview.missing'),
			});
			this.resetPreviewHits();
			return;
		}

		void MarkdownRenderer.render(
			this.app,
			stripFrontmatter(raw),
			bodyEl,
			this.previewSourcePath,
			component,
		);
		// 🔴 同步阶段立即染色：核心的基础 DOM 已经 append 完毕；塞进 `.then` 会等
		// 数学 / mermaid 后处理器，那时再切文本反而会踩坏渲染结果。
		this.refreshPreviewHits({ resetIndex: true, locate: true });
	}

	/**
	 * 非 md 预览：整件事交给核心 embedRegistry 分派（pdf / 图片 / 音视频 / canvas /
	 * 未知类型降级），插件不写类型分支。`sourcePath` 传条目自身路径，让核心按相对
	 * 路径解析这个全路径嵌入串。
	 */
	private paintEmbedPreview(frame: PreviewFrame, component: Component): void {
		const bodyEl = this.previewBodyEl;
		if (!bodyEl) {
			return;
		}

		this.previewIsEmbed = true;
		bodyEl.empty();
		this.clearPdfEmbedState(bodyEl);
		bodyEl.scrollTop = 0;
		// 细条按「有查询」才显示；嵌入分支没有可染色的文本，必须显式归零否则挂 0/0。
		this.resetPreviewHits();

		// pdf 单独一支：核心的 MarkdownRenderer 会给内嵌传 displayMode: true，
		// 那条路是「单页快照」——页面滚不动（[[Plan-20261029-061938]] §三）。
		if (this.paintPdfPreview(frame, component)) {
			return;
		}

		void MarkdownRenderer.render(
			this.app,
			`![[${frame.entry.path}]]`,
			bodyEl,
			frame.entry.path,
			component,
		);
	}

	/**
	 * pdf：向核心 embedRegistry 要同一个 creator，但把 `displayMode` 压成 false，
	 * 拿到普通 pdf.js 视图（`.pdf-viewer-container` 内部连续滚动）。
	 * 返回 false = 没接住（非 pdf / creator 取不到 / 抛错），调用方回落到整篇嵌入。
	 */
	private paintPdfPreview(frame: PreviewFrame, component: Component): boolean {
		const bodyEl = this.previewBodyEl;
		if (!bodyEl) {
			return false;
		}

		const file = this.app.vault.getAbstractFileByPath(frame.entry.path);
		if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'pdf') {
			return false;
		}

		// `embedRegistry` 不在公共 d.ts；与本插件 embedded-editor.ts 同一口径取内部 API。
		// 这里只声明用到的那一小块形状，避免把整个 app 退化成 any。
		const registry = (
			this.app as unknown as {
				embedRegistry?: {
					getEmbedCreator?: (target: TFile) => CoreEmbedCreator | undefined;
				};
			}
		).embedRegistry;
		const creator = registry?.getEmbedCreator?.(file);
		if (typeof creator !== 'function') {
			return false;
		}

		try {
			// 宿主必须是自己建的 div：MarkdownRenderer 会把嵌入包进 <p>，
			// `<p>` 的上下 margin 会让预览体多出几十 px 外层滚动。
			const hostEl = bodyEl.createDiv();
			const embed = creator(
				{
					app: this.app,
					containerEl: hostEl,
					linktext: frame.entry.path,
					sourcePath: frame.entry.path,
					displayMode: false,
					showInline: false,
					depth: 1,
				},
				file,
				'',
			);
			if (!embed) {
				hostEl.remove();
				return false;
			}

			component.addChild(embed);
			void embed.loadFile();
			bodyEl.addClass(PDF_EMBED_STATE_CLASS);
			this.syncPdfBodyHeight(hostEl, bodyEl);
			return true;
		} catch (error) {
			console.error('[IOTO Task Center] pdf 嵌入失败，回落整篇嵌入', error);
			bodyEl.empty();
			this.clearPdfEmbedState(bodyEl);
			return false;
		}
	}

	/**
	 * 把「一页高」交给预览体当高度基准（[[Report-20261029-063733]]）。
	 *
	 * 一页高只能问核心：`displayMode: false` 的 pdf 嵌入会把 pdf.js 按当前宽度算出
	 * 的「页高 + 工具栏」写进自己的内联 `height`（宿主 div 就是 `.pdf-embed`）。
	 * 把这个值写到预览体上之后，预览体的 flex-basis = 一页高：
	 * - 屏幕够高 → 弹窗长到一页高，整页可见；
	 * - 屏幕不够高 → `.modal` 的 `max-height` 兜底，预览体被 flex 收缩到可用高度。
	 *
	 * 之前的写法只靠 `.pdf-embed { height: 100% }`，预览体没有高度基准，整列高度被
	 * 左栏（链接列表）的行数决定，pdf 只剩两百多 px。
	 *
	 * 页高会随缩放 / 窗口宽度变，所以跟着内联样式同步，不缓存成常量。
	 */
	private syncPdfBodyHeight(hostEl: HTMLElement, bodyEl: HTMLElement): void {
		const sync = (): void => {
			const pageHeight = Number.parseFloat(hostEl.style.height);
			// 核心还没算出页高：留给下一次 style 变更回调。
			if (!Number.isFinite(pageHeight) || pageHeight <= 0) {
				return;
			}
			bodyEl.style.height = `${pageHeight}px`;
		};

		sync();
		this.disposePdfHeightObserver();
		const observer = new MutationObserver(sync);
		observer.observe(hostEl, {
			attributes: true,
			attributeFilter: ['style'],
		});
		this.pdfHeightObserver = observer;
	}

	/** pdf 态的两项副作用（状态类 + 预览体高度基准）总是一起收，漏一个就会带回旧高度。 */
	private clearPdfEmbedState(bodyEl: HTMLElement | null): void {
		this.disposePdfHeightObserver();
		if (!bodyEl) {
			return;
		}

		bodyEl.removeClass(PDF_EMBED_STATE_CLASS);
		bodyEl.style.height = '';
	}

	private disposePdfHeightObserver(): void {
		this.pdfHeightObserver?.disconnect();
		this.pdfHeightObserver = null;
	}

	// ---------------------------------------------------------------
	// 预览命中高亮与定位（[[Plan-20261028-221530]] §三 S2 / S3）
	// ---------------------------------------------------------------

	/** 与 `filterTaskLinks` 的判据逐字一致——注意不是 `toLocaleLowerCase`。 */
	private normalizedQuery(): string {
		return this.query.trim().toLowerCase();
	}

	/** 重扫的唯一入口：染色 → 收集合 → 定 index → 刷细条 → 按需定位。 */
	private refreshPreviewHits(options: {
		resetIndex: boolean;
		locate: boolean;
	}): void {
		const body = this.previewBodyEl;
		const query = this.normalizedQuery();
		// `previewIsEmbed` 一并拦：pdf 的文本层是真文本，扫进去会染色 pdf.js 自己的
		// DOM 并让细条挂出 `N/176`（[[Report-20261029-060022]] 验收 6）。
		if (!body || this.previewStack.length === 0 || this.previewIsEmbed) {
			this.resetPreviewHits();
			return;
		}

		applySearchHighlight(body, query, TASK_LINKS_HIT_CLASS);
		this.activeHitEl?.classList.remove(HIT_CURRENT_CLASS);
		this.activeHitEl = null;
		// 计数只取这一个数组：再跑一遍正则就会出现「计数与画面不一致」。
		this.hitEls = query ? collectSearchHits(body, TASK_LINKS_HIT_CLASS) : [];
		if (options.resetIndex) {
			this.hitIndex = this.hitEls.length > 0 ? 0 : -1;
		}
		if (this.hitIndex >= this.hitEls.length) {
			this.hitIndex = this.hitEls.length > 0 ? this.hitEls.length - 1 : -1;
		}
		this.syncActiveHit();
		this.refreshHitBar();
		if (options.locate && this.hitIndex >= 0) {
			const hit = this.hitEls[this.hitIndex];
			if (hit) {
				this.scrollHitIntoView(hit);
			}
		}
	}

	private resetPreviewHits(): void {
		this.activeHitEl?.classList.remove(HIT_CURRENT_CLASS);
		this.activeHitEl = null;
		this.hitEls = [];
		this.hitIndex = -1;
		this.refreshHitBar();
	}

	/** 细条：有预览且有查询才出现；计数/禁用态一律从 `hitEls` 推。 */
	private refreshHitBar(): void {
		const barEl = this.hitBarEl;
		if (!barEl) {
			return;
		}

		const visible =
			this.previewStack.length > 0 &&
			!this.previewIsEmbed &&
			this.normalizedQuery() !== '';
		barEl.toggleClass('is-hidden', !visible);

		const total = this.hitEls.length;
		const position = this.hitIndex >= 0 ? this.hitIndex + 1 : 0;
		const args = [String(position), String(total)];
		this.hitCountEl?.setText(t('taskLinks.preview.matchCount', args));
		this.hitCountEl?.setAttribute(
			'aria-label',
			t('taskLinks.preview.matchCountLabel', args),
		);
		const disabled = total === 0;
		if (this.hitPrevEl) {
			this.hitPrevEl.disabled = disabled;
		}
		if (this.hitNextEl) {
			this.hitNextEl.disabled = disabled;
		}
	}

	/** 只换 `is-current`：不做 querySelectorAll 全表改类名。 */
	private stepHit(delta: number): void {
		const next = stepHitIndex(this.hitIndex, this.hitEls.length, delta);
		if (next < 0 || next === this.hitIndex) {
			return;
		}
		this.hitIndex = next;
		this.syncActiveHit();
		this.refreshHitBar();
		const hit = this.hitEls[next];
		if (hit) {
			this.scrollHitIntoView(hit);
		}
	}

	/** 只摘旧节点 / 加新节点两个动作。 */
	private syncActiveHit(): void {
		this.activeHitEl?.classList.remove(HIT_CURRENT_CLASS);
		const next =
			this.hitIndex >= 0 ? (this.hitEls[this.hitIndex] ?? null) : null;
		next?.classList.add(HIT_CURRENT_CLASS);
		this.activeHitEl = next;
	}

	/**
	 * 手算 `scrollTop`：命中垂直居中，滚动只发生在 `preview-body` 上
	 * （`scrollIntoView` 会连带滚 `.modal` / 整页，实测把标题栏顶走）。
	 */
	private scrollHitIntoView(hit: HTMLElement): void {
		const body = this.previewBodyEl;
		if (!body) {
			return;
		}
		const bodyRect = body.getBoundingClientRect();
		const hitRect = hit.getBoundingClientRect();
		const delta =
			hitRect.top - bodyRect.top - (body.clientHeight - hitRect.height) / 2;
		const max = Math.max(0, body.scrollHeight - body.clientHeight);
		body.scrollTop = Math.max(0, Math.min(max, body.scrollTop + delta));
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
				const entry = this.toEntry(resolved.path, resolved.kind);
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

		/**
		 * 未知类型（zip/docx…）由核心降级成 .file-embed（图标+文件名），它自己的点击
		 * 走 openLinkText → 文件会开在弹窗背后的标签页。核心的监听挂在卡片/内层节点上，
		 * 冒泡阶段拦不住，只能用捕获阶段抢先。
		 */
		rootEl.addEventListener(
			'click',
			(event) => {
				if (!this.previewIsEmbed) {
					return; // 只在「预览的就是这个附件」时才接管，正文里嵌别的附件不拦
				}
				const target =
					event.target instanceof HTMLElement ? event.target : null;
				if (!target?.closest('.file-embed')) {
					return;
				}
				const top = this.previewStack[this.previewStack.length - 1];
				if (!top) {
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				this.openEntry(top.entry, top.kind);
			},
			{ capture: true },
		);
	}

	/** 解析结果 → 条目：优先复用快照里现成的一条（标题口径一致），否则就地造。 */
	private toEntry(
		path: string,
		kind: TaskLinkEntryKind,
	): TaskLinkEntry | null {
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
			kind,
		};
	}

	/** 先关窗再打开：Modal 是浮层，不关就会把刚点开的笔记挡在背后。 */
	private openEntry(entry: TaskLinkEntry, kind: TaskLinkEntryKind): void {
		this.close();
		this.options.onOpenEntry(entry, kind);
	}
}

/**
 * 命中定位图标按钮：与 Task View 搜索条同口径（`clickable-icon` + `setIcon` +
 * `aria-label`）。用 `clickable-icon` 还能豁免核心 `.is-tablet button:not(.clickable-icon)`
 * 的 padding 覆盖，否则定宽按钮会被撑成胶囊。
 *
 * 只是本文件内的私有小工厂：`ui/` 不依赖 `views/`，所以不 import Task View 那个。
 */
function createHitButton(
	parentEl: HTMLElement,
	icon: string,
	label: string,
	onClick: () => void,
): HTMLButtonElement {
	const btn = parentEl.createEl('button', {
		cls: 'clickable-icon',
		attr: {
			type: 'button',
			'aria-label': label,
			title: label,
		},
	});
	setIcon(btn, icon);
	btn.addEventListener('click', (event) => {
		event.preventDefault();
		onClick();
	});
	return btn;
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
