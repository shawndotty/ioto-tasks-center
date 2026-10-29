/**
 * 相关链接窗口的「筛选」浮层（[[Plan-20261029-143027]] §4.5）。
 *
 * 为什么不用核心 `Menu`：`MenuItem` 点一次就关，连改两个开关要点两次。
 * 本浮层的唯一差异就是**点单行不关闭**，其余（DOM 手建 + 外点 `mousedown`
 * 捕获关闭 + 定位算式）照抄本插件已验证的 `TaskStatusChecklistPopover`。
 *
 * 定位基准必须是**左栏**（`position: relative`）而不是视口：弹窗高度会随内容
 * 变化，`fixed` + 视口夹取在手机上会被键盘态打断。
 */

import { Platform, setIcon } from 'obsidian';

import { t } from '../lang/helpter';
import type { TaskLinksSearchScope } from '../tasks-center/task-links-index';

export interface TaskLinksFilterState {
	scope: TaskLinksSearchScope;
	caseSensitive: boolean;
	wholeWord: boolean;
}

/** 单行开关产生的补丁；字段名与 `TaskLinksFilterState` 对齐。 */
export interface TaskLinksFilterPatch {
	scope?: TaskLinksSearchScope;
	caseSensitive?: boolean;
	wholeWord?: boolean;
}

export interface TaskLinksFilterPopoverOptions {
	/** 定位锚点 = 搜索行右端的「筛选」按钮。 */
	anchorEl: HTMLElement;
	/** 定位基准 = 左栏（DOM 宿主；定位本身用 fixed + 视口坐标）。 */
	containerEl: HTMLElement;
	/** 插在它之前（= 列表），Tab 顺序才成为「输入框 → 筛选按钮 → 开关 → 列表」。 */
	beforeEl?: HTMLElement | null;
	/** 打开瞬间的初值。 */
	state: TaskLinksFilterState;
	/** 单行开关 → 弹窗的唯一漏斗。 */
	onPatch: (patch: TaskLinksFilterPatch) => void;
	/** 重置：归位三开关（是否关浮层由调用方决定）。 */
	onReset: () => void;
	/** 关闭后的通知（外部要刷入口按钮的 `aria-expanded`）。 */
	onClose?: () => void;
}

type ToggleKey = 'title' | 'body' | 'case' | 'word';

const POPOVER_CLASS = 'ioto-tasks-center__task-links-filter-popover';
const ROW_CLASS = 'ioto-tasks-center__task-links-filter-row';
const CHECK_CLASS = 'ioto-tasks-center__task-links-filter-check';
const ICON_CLASS = 'ioto-tasks-center__task-links-filter-icon';
const LABEL_CLASS = 'ioto-tasks-center__task-links-filter-label';

export class TaskLinksFilterPopover {
	private readonly doc: Document;
	private containerEl: HTMLDivElement | null = null;
	private resetEl: HTMLButtonElement | null = null;
	private readonly rows = new Map<ToggleKey, HTMLButtonElement>();
	private outsideMouseDownHandler: ((event: MouseEvent) => void) | null = null;
	private closeHandler: (() => void) | null = null;
	private anchorEl: HTMLElement | null = null;
	/** 当前状态由 `sync` 维护：行点击必须读它，不能读 `open` 时的快照。 */
	private state: TaskLinksFilterState = {
		scope: 'both',
		caseSensitive: false,
		wholeWord: false,
	};

	constructor(doc: Document) {
		this.doc = doc;
	}

	open(options: TaskLinksFilterPopoverOptions): void {
		// 重开 = 重建：行态与初值一一对应，不做增量对齐（DOM 很小，成本可忽略）。
		this.close();

		const containerEl = this.doc.createElement('div');
		containerEl.className = POPOVER_CLASS;
		containerEl.setAttr('role', 'group');
		containerEl.setAttr('aria-label', t('taskLinks.filter.label'));

		this.rows.clear();
		this.addToggle(containerEl, 'title', t('taskLinks.search.titleOnly'), () => {
			// 再点一次回到「标题+正文」；两个范围互斥，点另一个会直接切换过去。
			options.onPatch({
				scope: this.state.scope === 'title' ? 'both' : 'title',
			});
		});
		this.addToggle(containerEl, 'body', t('taskLinks.search.bodyOnly'), () => {
			options.onPatch({
				scope: this.state.scope === 'body' ? 'both' : 'body',
			});
		});
		this.addToggle(
			containerEl,
			'case',
			t('taskLinks.search.caseSensitive'),
			() => {
				options.onPatch({ caseSensitive: !this.state.caseSensitive });
			},
		);
		this.addToggle(
			containerEl,
			'word',
			t('taskLinks.search.wholeWord'),
			() => {
				options.onPatch({ wholeWord: !this.state.wholeWord });
			},
			// 中文会退化成子串，这条口径必须能被 hover 到。
			t('taskLinks.search.wholeWordHint'),
		);

		containerEl.createDiv({
			cls: 'ioto-tasks-center__task-links-filter-sep',
		});

		const resetEl = containerEl.createEl('button', {
			cls: `${ROW_CLASS} is-reset`,
			attr: { type: 'button' },
		});
		const resetIconEl = resetEl.createSpan({ cls: ICON_CLASS });
		setIcon(resetIconEl, 'rotate-ccw');
		resetEl.createSpan({
			cls: LABEL_CLASS,
			text: t('taskLinks.filter.reset'),
		});
		resetEl.addEventListener('mousedown', (event) => {
			event.preventDefault(); // 不抢输入框焦点
		});
		resetEl.addEventListener('click', (event) => {
			event.preventDefault();
			options.onReset();
		});
		this.resetEl = resetEl;

		this.containerEl = containerEl;
		this.anchorEl = options.anchorEl;
		this.closeHandler = options.onClose ?? null;
		this.state = options.state;
		// 插在列表之前：Tab 顺序 = 视觉顺序（输入框 → 筛选按钮 → 开关 → 列表）。
		const beforeEl = options.beforeEl;
		if (beforeEl && beforeEl.parentElement === options.containerEl) {
			options.containerEl.insertBefore(containerEl, beforeEl);
		} else {
			options.containerEl.appendChild(containerEl);
		}
		if (!this.placeAsSheet()) {
			this.positionAtAnchor(options.anchorEl);
		}
		this.sync(options.state);

		this.outsideMouseDownHandler = (event: MouseEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) {
				return;
			}
			// 点锚点按钮交给它自己的 click 分支（那里会 toggle），这里放手。
			if (
				this.containerEl?.contains(target) ||
				this.anchorEl?.contains(target)
			) {
				return;
			}
			this.close();
		};
		this.doc.addEventListener(
			'mousedown',
			this.outsideMouseDownHandler,
			true,
		);
	}

	isOpen(): boolean {
		return this.containerEl !== null;
	}

	/** 外部改状态（重置 / 关窗回默认 / 空态放宽）时同步行态与重置可用性。 */
	sync(state: TaskLinksFilterState): void {
		this.state = state;
		this.rows.get('title')?.setAttribute(
			'aria-pressed',
			String(state.scope === 'title'),
		);
		this.rows.get('body')?.setAttribute(
			'aria-pressed',
			String(state.scope === 'body'),
		);
		this.rows.get('case')?.setAttribute(
			'aria-pressed',
			String(state.caseSensitive),
		);
		this.rows.get('word')?.setAttribute(
			'aria-pressed',
			String(state.wholeWord),
		);
		if (this.resetEl) {
			this.resetEl.disabled =
				state.scope === 'both' &&
				!state.caseSensitive &&
				!state.wholeWord;
		}
	}

	close(options: { restoreFocus?: boolean } = {}): void {
		if (this.outsideMouseDownHandler) {
			this.doc.removeEventListener(
				'mousedown',
				this.outsideMouseDownHandler,
				true,
			);
			this.outsideMouseDownHandler = null;
		}

		const hadContainer = this.containerEl !== null;
		this.containerEl?.remove();
		this.containerEl = null;
		this.resetEl = null;
		this.rows.clear();

		const anchorEl = this.anchorEl;
		this.anchorEl = null;
		if (options.restoreFocus) {
			anchorEl?.focus();
		}

		const onClose = this.closeHandler;
		this.closeHandler = null;
		if (hadContainer) {
			onClose?.();
		}
	}

	destroy(): void {
		this.close();
	}

	/** 行工厂：`aria-pressed` 承载状态（与本插件既有 toggle 口径一致）。 */
	private addToggle(
		parentEl: HTMLElement,
		key: ToggleKey,
		label: string,
		onClick: () => void,
		title?: string,
	): void {
		const rowEl = parentEl.createEl('button', {
			cls: ROW_CLASS,
			attr: { type: 'button', 'data-filter-key': key },
		});
		const checkEl = rowEl.createSpan({ cls: CHECK_CLASS });
		setIcon(checkEl, 'check');
		rowEl.createSpan({ cls: LABEL_CLASS, text: label });
		if (title) {
			rowEl.setAttribute('title', title);
		}
		// 🔴 点行不关闭浮层（多开关连续调是主场景），也不抢走输入框焦点。
		rowEl.addEventListener('mousedown', (event) => {
			event.preventDefault();
		});
		rowEl.addEventListener('click', (event) => {
			event.preventDefault();
			onClick();
		});
		this.rows.set(key, rowEl);
	}

	/** 手机：底部弹层，JS 不写 left/top，定宽与定位全交给 CSS。 */
	private placeAsSheet(): boolean {
		if (!Platform.isPhone) {
			return false;
		}
		this.containerEl?.addClass('is-sheet');
		return true;
	}

	/**
	 * 右对齐到锚点、下方优先；越界翻到上方，四周各夹 8px。
	 *
	 * 用 `position: fixed` + 视口坐标（不是相对左栏的 absolute）：列表态窗口高度是
	 * `auto`，只有几条链接时左栏可能只剩 ~160px，182px 高的浮层在栏内怎么夹都放不下，
	 * 会被 `.modal-content { overflow: hidden }` 裁掉底部两行（实测裁掉 32px）。
	 * 祖先链上没有任何 transform / filter（实测），fixed 不会被这些 overflow 裁切，
	 * 而 DOM 仍留在左栏内部，Tab 顺序不受影响。
	 */
	private positionAtAnchor(anchorEl: HTMLElement): void {
		const popoverEl = this.containerEl;
		if (!popoverEl) {
			return;
		}

		const anchorRect = anchorEl.getBoundingClientRect();
		const popoverRect = popoverEl.getBoundingClientRect();
		const view = this.doc.defaultView;
		const viewportWidth = view?.innerWidth ?? 0;
		const viewportHeight = view?.innerHeight ?? 0;

		const padding = 8;
		const gap = 6;
		let left = anchorRect.right - popoverRect.width;
		left = Math.max(
			padding,
			Math.min(left, viewportWidth - popoverRect.width - padding),
		);

		let top = anchorRect.bottom + gap;
		if (top + popoverRect.height > viewportHeight - padding) {
			top = anchorRect.top - popoverRect.height - gap;
		}
		top = Math.max(
			padding,
			Math.min(top, viewportHeight - popoverRect.height - padding),
		);

		popoverEl.style.left = `${left}px`;
		popoverEl.style.top = `${top}px`;
	}
}
