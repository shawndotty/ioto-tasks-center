/**
 * 角落悬浮按钮：视图切换（右下）+ 快捷键帮助（左下，[[Research-20261028-133749]]）。
 *
 * 每叶子在自己 `view.containerEl`（`.workspace-leaf-content`）挂按钮：
 * - 右下：点击按**该叶子**切换 Markdown / IOTO 任务视图；
 * - 左下：只在桌面端任务视图出现，点击打开键位帮助 modal。
 *
 * 两类按钮共用同一套扫描 / 高度闸门 / 登记表，但**各自独立开关**：
 * 关掉切换按钮不会连坐帮助按钮，反之亦然。
 *
 * 两道闸门：
 * - 设置（`showViewToggleButton` / `showTaskViewShortcutHelpButton`）：DOM 层增删，
 *   **不用 CSS 隐藏**——关闭后不留可被 Tab 聚焦的残骸；
 * - 叶子高度（[[Research-20261020-111403]]）：`ResizeObserver` 观察容器，
 *   过矮（键盘弹出 / 窄窗格）时打 `data-collapsed` 由 CSS 收起，DOM 保留。
 */
import {
	type App,
	Platform,
	setIcon,
	type Workspace,
	type WorkspaceLeaf,
} from 'obsidian';
import { t } from './lang/helpter';
import { resolveTaskViewToggleDirection } from './task-view-routing';
import { openShortcutHelpModal } from './ui/shortcutHelpModal';
import { IOTOTaskView } from './views/iotoTaskView';
import {
	describeToggle,
	isShortcutHelpButtonVisible,
	isViewTooShortForToggle,
	type ToggleDescriptor,
	TOGGLE_SHOW_DELAY_MS,
} from './view-toggle-model';

const TOGGLE_CLASS = 'ioto-view-toggle';
/** 帮助按钮必须独立类名：复用 TOGGLE_CLASS 会被扫描当成切换按钮改图标/被清理连坐。 */
const HELP_CLASS = 'ioto-shortcut-help-btn';
/** 高度闸门收起态：样式里据此 `display: none`（见 styles.css）。 */
const COLLAPSED_ATTR = 'data-collapsed';

/** 登记 live 按钮（两类都记），供「关闭开关立即全窗口清场」覆盖 popout 叶子。 */
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
	/** 帮助按钮的设置开关（**原始设置值**，平台判定留在本模块）。 */
	isShortcutHelpEnabled(): boolean;
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
	// 两个开关必须独立判：任一关闭都不许影响另一个（原整段早退会连坐）。
	const wantToggle = host.isViewToggleVisible();
	const wantHelp = host.isShortcutHelpEnabled() && !Platform.isMobile;
	if (!wantToggle && !wantHelp) {
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

		const direction = resolveTaskViewToggleDirection(leaf, root);
		const descriptor = describeToggle(direction);

		// ① 切换按钮：只在「任务笔记 / 任务视图」两类叶子上
		const toggleEl = container.querySelector<HTMLButtonElement>(
			`:scope > .${TOGGLE_CLASS}`,
		);
		if (!wantToggle || !descriptor) {
			if (toggleEl) {
				liveToggleButtons.delete(toggleEl);
				toggleEl.remove();
			}
		} else {
			const btn = toggleEl ?? createToggleButton(host, leaf, container);
			updateToggleButton(btn, descriptor);
		}

		// ② 帮助按钮：只在任务视图叶子 + 桌面端
		const helpEl = container.querySelector<HTMLButtonElement>(
			`:scope > .${HELP_CLASS}`,
		);
		const showHelp = isShortcutHelpButtonVisible({
			enabled: wantHelp,
			isMobile: false, // 平台已在入口判过
			direction,
		});
		if (!showHelp) {
			if (helpEl) {
				liveToggleButtons.delete(helpEl);
				helpEl.remove();
			}
		} else if (!helpEl) {
			createShortcutHelpButton(host, leaf, container);
		}

		// 两类按钮都没有时退订该容器（原「无方向就 unwatch」搬到这里）。
		if (!hasAnyCornerButton(container)) {
			unwatchContainer(container);
		}
	});
}

function hasAnyCornerButton(container: HTMLElement): boolean {
	return (
		container.querySelector(`:scope > .${TOGGLE_CLASS}`) !== null ||
		container.querySelector(`:scope > .${HELP_CLASS}`) !== null
	);
}


export function removeFloatingToggles(app: App): void {
	// 主窗口兜底：即使登记表因热重载丢失，也能按类名清掉（两类按钮都要清）。
	app.workspace.iterateAllLeaves((leaf) => {
		const container = leaf.view?.containerEl;
		container
			?.querySelectorAll<HTMLElement>(
				`:scope > .${TOGGLE_CLASS}, :scope > .${HELP_CLASS}`,
			)
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

/** 左下角的快捷键帮助按钮：图标固定，只需创建时定一次。 */
function createShortcutHelpButton(
	host: FloatingToggleHost,
	leaf: WorkspaceLeaf,
	container: HTMLElement,
): HTMLButtonElement {
	const label = t('shortcutHelp.button');
	const btn = container.createEl('button', {
		cls: HELP_CLASS,
		attr: { type: 'button', 'aria-label': label, title: label },
	});
	setIcon(btn, 'help-circle');
	liveToggleButtons.add(btn);

	// 与切换按钮同口径：鼠标按下不抢焦点，避免先触发编辑器 blur。
	btn.addEventListener('pointerdown', (event) => {
		if (event.pointerType === 'mouse') event.preventDefault();
	});

	btn.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		// 传视图：按钮路径是唯一能拿到「编辑态/搜索态」的入口（命令面板已夺焦）。
		const view = leaf.view;
		openShortcutHelpModal(
			host.app,
			view instanceof IOTOTaskView ? view : undefined,
		);
	});

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
 *
 * 两类角落按钮共用同一个观察者与同一道闸门（同进同退，不会一个在一个不在）。
 */
function watchContainer(container: HTMLElement): void {
	if (containerObservers.has(container)) return;
	const observer = new ResizeObserver((entries) => {
		for (const entry of entries) {
			const target = entry.target as HTMLElement;
			const buttons = [
				...Array.from(
					target.querySelectorAll<HTMLButtonElement>(
						`:scope > .${TOGGLE_CLASS}`,
					),
				),
				...Array.from(
					target.querySelectorAll<HTMLButtonElement>(
						`:scope > .${HELP_CLASS}`,
					),
				),
			];
			if (buttons.length === 0) {
				// 按钮已被 sync 移除：自行退订，避免悬挂观察。
				unwatchContainer(target);
				return;
			}
			for (const btn of buttons) {
				applyHeightGate(btn, entry.contentRect.height);
			}
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
