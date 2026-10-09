import { t } from '../../lang/helpter';
import { setIcon } from 'obsidian';
import type { TaskViewHost } from './task-view-host';
import { hasLiveEditor, isCardEditing } from './task-view-editing-state';
import { queryCard } from './task-view-helpers';

export function toggleZoomCard(view: TaskViewHost, line: number): void {
	if (view.zoomLine === line) {
		view.exitZoom();
	} else {
		void view.enterZoom(line);
	}
}

/**
 * 放大（[[Discuss-20261008-173935]] 方案 A）：**放大 ≡ 常驻编辑态**——
 * 先把编辑器确保挂到该卡上，再套放大类；放大卡恒为「单卡编辑面」，不再有选中态。
 * 编辑器挂不上（不支持内联编辑 / 目标卡缺失 / 挂载降级）则放弃放大，不留半程状态。
 */
export async function enterZoom(view: TaskViewHost, line: number): Promise<void> {
	// 🔴 放大 ≡ 单卡编辑面：只在「尚无编辑器」或「卡片级编辑」下成立
	//（`isCardEditing`）。续行 / Section 编辑态下放大语义未定，直接放弃，
	// 不留「放大但编辑面不是该卡」的半程状态（[[Plan-20261010-070400]] B5）。
	if (hasLiveEditor(view.editingKind) && !isCardEditing(view.editingKind)) {
		view.zoomLine = null;
		return;
	}
	if (!view.supportsInlineEdit() || !queryCard(view, line)) {
		return;
	}
	// 先置真源：`applySelection` 读到 `zoomLine` 才不会给放大卡补 `.is-selected`
	view.zoomLine = line;
	if (view.editingLine !== line || !view.editingHandle) {
		await view.beginEdit(line);
	}
	if (view.editingLine !== line) {
		// 编辑器挂不上（降级）：宁可退出，也不留「放大但只读」
		view.zoomLine = null;
		return;
	}
	applyZoomDom(view, line);
}

/**
 * 放大态纯 DOM：隐藏其余 Section / 分组 / 卡片，抬高当前卡（不重建、不抢焦点）。
 * 单独抽出，供 `enterZoom`（先确保编辑）与重绘回填复用。
 */
export function applyZoomDom(view: TaskViewHost, line: number): void {
	const cardEl = queryCard(view, line);
	const sectionEl =
		cardEl?.closest<HTMLElement>('.ioto-task-view__section') ?? null;
	const groupListEl = cardEl?.parentElement ?? null;
	if (!cardEl || !sectionEl) {
		return;
	}

	// 方案 A：放大期间不出现选中态（清掉可能残留的 `.is-selected`）
	cardEl.removeClass('is-selected');

	// ① 其他顶层 Section 整体隐藏
	view.bodyEl
		?.querySelectorAll<HTMLElement>('.ioto-task-view__section')
		.forEach((sec) => {
			if (sec !== sectionEl) {
				sec.addClass('is-zoom-hidden');
			}
		});

	// ② 本 Section：只留放大卡所在的清单分组；其余分组 / 非任务正文块一并隐藏（Q1）。
	//    标题栏不在 section-body 内，天然保留（Q2）。
	sectionEl
		.querySelector('.ioto-task-view__section-body')
		?.querySelectorAll<HTMLElement>(':scope > *')
		.forEach((child) => {
			if (child !== groupListEl) {
				child.addClass('is-zoom-hidden');
			}
		});

	// ③ 同分组内其他卡隐藏
	groupListEl
		?.querySelectorAll<HTMLElement>(':scope > .ioto-task-view__card')
		.forEach((card) => {
			if (card !== cardEl) {
				card.addClass('is-zoom-hidden');
			}
		});

	// ④ 抬高输入区（数值由 CSS 决定，见 6.6）
	cardEl.addClass('is-zoomed');

	// ⑤ 按钮就地翻面（点击不重建动作区，见 Discuss-20261008-111641 §2.3-4）
	syncZoomButton(view, cardEl);
}

/**
 * 缩小：删净放大类，与 `enterZoom` 对称；幂等。
 * 方案 A（Q5）：退出放大**不动编辑态**——编辑器仍在、卡片保持 `.is-editing`，
 * 此后再点空白才走常规「失焦提交 → 回落选中」（回到两段式状态机）。
 */
export function exitZoom(view: TaskViewHost): void {
	// 先记住放大行号：清类后 `.is-zoomed` 即消失，用行号定位才可靠
	// （重绘产出的新 DOM 不带放大类，按类找会落空、按钮不翻面 → [[Research-20261008-210807]]）。
	const line = view.zoomLine;
	view.zoomLine = null;
	view.bodyEl
		?.querySelectorAll<HTMLElement>('.is-zoom-hidden, .is-zoomed')
		.forEach((el) => {
			el.removeClass('is-zoom-hidden');
			el.removeClass('is-zoomed');
		});
	// 用行号定位放大卡（而非 `.is-zoomed`）：任何时刻都自洽，供按钮翻面与滚入用。
	const cardEl = line !== null ? queryCard(view, line) : null;
	syncZoomButton(view, cardEl);

	// 摘类后内容恢复完整高度，但 scrollTop 仍停在放大期被夹取的小值，
	// 目标卡可能落到视口外 → 复调既有「必要时才滚」的滚入（[[Plan-20261008-181508]]）。
	if (cardEl) {
		view.scrollCardIntoView(cardEl);
	}
}

/**
 * 整树重建后回填放大态（[[Discuss-20261008-171512]] 方案 A 步骤 1）。
 *
 * 方案 A（[[Discuss-20261008-173935]]）叠加：放大 **≡** 编辑。`bodyEl.empty()` 已把
 * 编辑器 DOM 摘除（`editingHandle` 悬空），故这里先有序回收悬空句柄、再由 `enterZoom`
 * 重挂编辑器——否则会出现「`.is-editing` 在、编辑器没了」的空壳。目标卡不存在则
 * 兜底退出并一并收口编辑态。
 */
export function restoreZoom(view: TaskViewHost): void {
	const line = view.zoomLine;
	if (line === null) {
		return;
	}
	if (!queryCard(view, line)) {
		// 卡片被删 / 行漂移落空 / 被折叠：宁可不放大，也不放大错卡（Q3）
		view.zoomLine = null;
		view.destroyActiveEditor();
		view.editingLine = null;
		view.editingOriginalLine = '';
		return;
	}
	// 重绘必然摘除编辑器 DOM：句柄悬空即回收，交由 enterZoom 重挂（保持「放大 ≡ 编辑」）
	if (view.editingHandle) {
		view.destroyActiveEditor();
		view.editingLine = null;
		view.editingOriginalLine = '';
	}
	void view.enterZoom(line);
}

/**
 * 就地同步放大按钮的图标与文案：点击切换是纯 DOM 开关，不会重建动作区，
 * 故须手动翻面（否则点了放大图标仍停在「放大」）。
 */
export function syncZoomButton(
	view: TaskViewHost,
	cardEl: HTMLElement | null,
): void {
	if (!cardEl) {
		return;
	}
	const btn = cardEl.querySelector<HTMLElement>(
		'.ioto-task-view__card-action-btn[data-action="toggle-zoom"]',
	);
	if (!btn) {
		return;
	}
	const zoomed = view.zoomLine !== null;
	const label = t(
		zoomed
			? 'view.iotoTaskView.cardActions.zoomOut'
			: 'view.iotoTaskView.cardActions.zoomIn',
	);
	setIcon(btn, zoomed ? 'minimize-2' : 'maximize-2');
	btn.setAttribute('aria-label', label);
	btn.setAttribute('title', label);
}

/**
 * 放大态失焦 / `Esc` 的落盘（[[Discuss-20261008-173935]] 方案 A Q1/Q4）：
 * **只写盘、不退出编辑态**——复用 `autosaveEdit`（不 `destroy`、不 `clear editingLine`、
 * 不 `refreshCard`），卡片保持 `.is-editing`，不会回落选中态。幂等：无变更 / 无编辑器时短路。
 */
export async function flushZoomEdit(view: TaskViewHost): Promise<void> {
	if (view.zoomLine === null) {
		return;
	}
	await view.autosaveEdit();
}

/**
 * 放大态点击卡片：把焦点交还内嵌编辑器（方案 A）。
 * 编辑器已在则仅 `focus()`；若因整树重绘瞬时缺位，则幂等重挂（`enterZoom`）。
 */
export function focusZoomEditor(view: TaskViewHost, line: number): void {
	if (view.zoomLine !== line) {
		return;
	}
	if (view.editingLine === line && view.editingHandle) {
		view.editingHandle.focus();
		return;
	}
	void view.enterZoom(line);
}
