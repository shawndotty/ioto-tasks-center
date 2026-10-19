/**
 * 视图切换悬浮按钮（[[Plan-20261019-190001]] §3.7）。
 *
 * 每叶子在自己 `view.containerEl`（`.workspace-leaf-content`）右下角挂一枚低调按钮，
 * 点击按**该叶子**切换 Markdown / IOTO 任务视图。显示与否由设置
 * `showViewToggleButton` 在 DOM 层闸门控制，**不用 CSS 隐藏**——关闭后不留
 * 可被 Tab 聚焦的残骸。
 */
import {
	type App,
	setIcon,
	type Workspace,
	type WorkspaceLeaf,
} from 'obsidian';
import { t } from './lang/helpter';
import { resolveTaskViewToggleDirection } from './task-view-routing';
import { describeToggle, type ToggleDescriptor } from './view-toggle-model';

const TOGGLE_CLASS = 'ioto-view-toggle';

/** 登记 live 按钮，供「关闭开关立即全窗口清场」覆盖 popout 叶子。 */
const liveToggleButtons = new Set<HTMLButtonElement>();

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

	return btn;
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
