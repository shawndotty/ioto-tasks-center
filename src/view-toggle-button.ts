/**
 * 视图切换悬浮按钮（[[Plan-20261019-190001]] §3.7）。
 *
 * 每叶子在自己 `view.containerEl`（`.workspace-leaf-content`）右下角挂一枚低调按钮，
 * 点击按**该叶子**切换 Markdown / IOTO 任务视图。
 *
 * 两道闸门：
 * - 设置 `showViewToggleButton`：DOM 层增删，**不用 CSS 隐藏**——关闭后不留
 *   可被 Tab 聚焦的残骸；
 * - 叶子高度（[[Research-20261020-111403]]）：`ResizeObserver` 观察容器，
 *   过矮（键盘弹出 / 窄窗格）时打 `data-collapsed` 由 CSS 收起，DOM 保留。
 */
import {
	type App,
	setIcon,
	type Workspace,
	type WorkspaceLeaf,
} from 'obsidian';
import { t } from './lang/helpter';
import { resolveTaskViewToggleDirection } from './task-view-routing';
import {
	describeToggle,
	isViewTooShortForToggle,
	type ToggleDescriptor,
	TOGGLE_SHOW_DELAY_MS,
} from './view-toggle-model';

const TOGGLE_CLASS = 'ioto-view-toggle';
/** 高度闸门收起态：样式里据此 `display: none`（见 styles.css）。 */
const COLLAPSED_ATTR = 'data-collapsed';

/** 登记 live 按钮，供「关闭开关立即全窗口清场」覆盖 popout 叶子。 */
const liveToggleButtons = new Set<HTMLButtonElement>();

/** containerEl → 观察它的 RO（按叶子去重；内置浏览器 / popout 叶子也能覆盖）。 */
const containerObservers = new Map<HTMLElement, ResizeObserver>();

/** 待恢复的定时器（按钮被销毁即自然回收）。 */
const showTimers = new WeakMap<HTMLButtonElement, number>();

export interface FloatingToggleHost {
	app: App;
	getTasksRootPath(): string;
	/** 设置开关：false 时不产生按钮，并清掉已存在的。 */
	isViewToggleVisible(): boolean;
	/** 点击回调：由 main 转给 toggleTaskViewForLeaf */
	onToggle(leaf: WorkspaceLeaf): void;
}

/**
 * 幂等扫描：命中即更新、不符合即移除。
 * `workspace` 默认主窗口，popout 由 `window-open` 传入自己的 workspace。
 */
export function syncFloatingToggles(
	host: FloatingToggleHost,
	workspace: Workspace = host.app.workspace,
): void {
	// 设置关闭：全量清场后直接返回，不解析方向、不碰 DOM 结构。
	if (!host.isViewToggleVisible()) {
		removeFloatingToggles(host.app);
		return;
	}

	const root = host.getTasksRootPath();

	// 剪枝：叶子容器被整体替换时，旧按钮已脱离文档。
	for (const btn of liveToggleButtons) {
		if (!btn.isConnected) {
			liveToggleButtons.delete(btn);
		}
	}
	for (const container of containerObservers.keys()) {
		if (!container.isConnected) {
			unwatchContainer(container);
		}
	}

	workspace.iterateAllLeaves((leaf) => {
		const container = leaf.view?.containerEl;
		if (!container) return;

		const descriptor = describeToggle(
			resolveTaskViewToggleDirection(leaf, root),
		);
		const existing = container.querySelector<HTMLButtonElement>(
			`:scope > .${TOGGLE_CLASS}`,
		);

		if (!descriptor) {
			unwatchContainer(container);
			if (existing) {
				liveToggleButtons.delete(existing);
				existing.remove();
			}
			return;
		}

		const btn = existing ?? createToggleButton(host, leaf, container);
		updateToggleButton(btn, descriptor);
	});
}

export function removeFloatingToggles(app: App): void {
	// 主窗口兜底：即使登记表因热重载丢失，也能按类名清掉。
	app.workspace.iterateAllLeaves((leaf) => {
		leaf.view?.containerEl
			?.querySelectorAll<HTMLElement>(`:scope > .${TOGGLE_CLASS}`)
			.forEach((el) => el.remove());
	});

	// 登记表覆盖 popout：popout 的叶子不在 app.workspace.iterateAllLeaves 里。
	for (const btn of liveToggleButtons) {
		btn.remove();
	}
	liveToggleButtons.clear();

	for (const observer of containerObservers.values()) observer.disconnect();
	containerObservers.clear();
}

function createToggleButton(
	host: FloatingToggleHost,
	leaf: WorkspaceLeaf,
	container: HTMLElement,
): HTMLButtonElement {
	const btn = container.createEl('button', {
		cls: TOGGLE_CLASS,
		attr: { type: 'button' },
	});
	liveToggleButtons.add(btn);

	// 鼠标按下不抢焦点，避免先触发编辑器 blur（触屏不拦，防止影响 click 合成）
	btn.addEventListener('pointerdown', (event) => {
		if (event.pointerType === 'mouse') event.preventDefault();
	});

	btn.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		host.onToggle(leaf);
	});

	// 创建即定态，避免先亮后收（后台标签的 clientHeight 为 0 → 直接收起）。
	watchContainer(container);
	applyHeightGate(btn, container.clientHeight);

	return btn;
}

/**
 * 按叶子挂一个 ResizeObserver（[[Research-20261020-111403]] §4.2）。
 *
 * 键盘弹出 / 分栏拖动都不会触发 workspace 的 layout-change，只有 RO 能覆盖；
 * 核心键盘态是把 `.app-container` 的 max-height 压给 `100vh - --keyboard-height`，
 * 所以叶子高度天然是「键盘是否弹出」的可靠代理。
 */
function watchContainer(container: HTMLElement): void {
	if (containerObservers.has(container)) return;
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const host = entry.target as HTMLElement;
			const btn = host.querySelector<HTMLButtonElement>(
				`:scope > .${TOGGLE_CLASS}`,
			);
			if (!btn) {
				// 按钮已被 sync 移除：自行退订，避免悬挂观察。
				unwatchContainer(host);
				return;
			}
			applyHeightGate(btn, entry.contentRect.height);
		}
	});
	containerObservers.set(container, observer);
	observer.observe(container);
}

function unwatchContainer(container: HTMLElement): void {
	containerObservers.get(container)?.disconnect();
	containerObservers.delete(container);
}

/**
 * 高度闸门：收起立刻生效，恢复延迟 `TOGGLE_SHOW_DELAY_MS`。
 *
 * 键盘动画期核心会给 body 加 `keyboard-animating` 并临时放开 max-height，
 * 高度会先回全高再收缩，不延迟就会闪一下。
 */
function applyHeightGate(btn: HTMLButtonElement, height: number): void {
	const win = btn.ownerDocument.defaultView ?? window;
	const pending = showTimers.get(btn);

	if (isViewTooShortForToggle(height)) {
		if (pending !== undefined) {
			win.clearTimeout(pending);
			showTimers.delete(btn);
		}
		setToggleCollapsed(btn, true);
		return;
	}

	// 已经可见，或已在等待恢复：不再排队。
	if (
		btn.getAttribute(COLLAPSED_ATTR) !== 'true' ||
		pending !== undefined
	) {
		return;
	}

	showTimers.set(
		btn,
		win.setTimeout(() => {
			showTimers.delete(btn);
			if (!btn.isConnected) return;
			const next = btn.parentElement?.clientHeight ?? 0;
			if (isViewTooShortForToggle(next)) return; // 仍矮：保持收起
			setToggleCollapsed(btn, false);
		}, TOGGLE_SHOW_DELAY_MS),
	);
}

function setToggleCollapsed(btn: HTMLButtonElement, collapsed: boolean): void {
	if (collapsed) {
		if (btn.getAttribute(COLLAPSED_ATTR) !== 'true') {
			btn.setAttribute(COLLAPSED_ATTR, 'true');
		}
		return;
	}
	btn.removeAttribute(COLLAPSED_ATTR);
}

function updateToggleButton(
	btn: HTMLButtonElement,
	descriptor: ToggleDescriptor,
): void {
	if (btn.dataset.direction === descriptor.direction) return; // 只做必要变更
	btn.dataset.direction = descriptor.direction;
	const label = t(descriptor.labelKey);
	btn.setAttribute('aria-label', label);
	btn.setAttribute('title', label);
	setIcon(btn, descriptor.icon);
}
