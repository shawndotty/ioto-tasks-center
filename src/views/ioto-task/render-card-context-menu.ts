/**
 * 任务卡右键菜单（[[Plan-20261023-104335]] §4.6，批量语义见 [[Plan-20261104-060428]] C5）。
 *
 * 五项：固定任务 / 取消固定 → 标记为重复任务 / 取消重复 → 分隔线
 * → 创建任务副本 → 移动到… → 删除（顺序由 Johnny 拍板，[[Research-20261023-090756]] §八 #3 /
 * [[Plan-20261023-145916]] §二 #4）。
 *
 * 作用对象是**目标行集合** `targets`：长度 1 = 既有单选语义（文案逐字不变），
 * ≥2 = 批量（文案带条数，动作一次落盘）。构造（`buildCardContextMenu`）与弹出
 * （`showCardContextMenu`）拆开，前者纯逻辑可直接单测。
 *
 * 只吃 `TaskNoteEditing` 级别的回调，**不碰 `TaskViewHost`**：渲染层拿不到 host
 * （`render-note.ts` → `render-sections.ts` → `render-checklist-card.ts` 全程只透传
 * `editing`，且 `render-note-types.ts` 是零业务出边的叶子模块）。回调缺省 = 该项
 * 置灰，与 `insertOutgoingLink?` / `toggleZoom?` 同一口径。
 */

import { Menu } from 'obsidian';

import { t } from '../../lang/helpter';

// 与 `views/tasks-center/menus.ts:42` 同因：菜单项点击后同步移除浮层会让本次点按
// 「穿透」到下方元素，且写入触发的 modify 会销毁作为锚点的卡片元素 → 浮层卸不掉。
// 三项统一走这条延迟（M7），50ms 对用户无感。
const MENU_ACTION_DEFER_DELAY_MS = 50;

export interface CardContextMenuOptions {
	/** 目标行集合（DOM 顺序、可见、含被右键那张）；长度 = 1 走单选文案 */
	targets: readonly number[];
	/** 渲染期从 `item.controls` 读的快照：卡片每次写回都整树重建，快照在一次渲染周期内恒真 */
	pinned: boolean;
	repeated: boolean;
	/** 可写（`editing.enabled`）；false → 全部置灰（Johnny 拍板 #2） */
	writable: boolean;
	/**
	 * 方向由本层给出（`!pinned` / `!repeated`）：文案说「取消固定」，动作就必须是取消。
	 * 🔴 不能在写回函数里逐行取反——混合态会被翻转成错的那一半（[[Plan-20261104-060428]] A4）。
	 */
	onPin: (lines: readonly number[], pinned: boolean) => void;
	onRepeat: (lines: readonly number[], repeated: boolean) => void;
	/** 标记为完成（仅多选注入；单向，反向入口是卡片 checkbox） */
	onMarkDone: (lines: readonly number[]) => void;
	onDuplicate: (lines: readonly number[]) => void;
	/** 跨任务文件搬运（[[Plan-20261031-205655]] §四.8）：显式行号，不依赖选中态。 */
	onMoveToFile: (lines: readonly number[]) => void;
	onDelete: (lines: readonly number[]) => void;
}

/**
 * 纯构造：不 `new Menu`、不 `show`，供单测直接断言条目 / 文案 / 置灰 / 顺序。
 *
 * 文案随 `targets.length` 二态：1 → 既有单条键（逐字不变）；≥2 → 带条数的批量键。
 * 删除项多点时复用工具栏的 `toolbar.deleteTasks`（`删除 {0} 项`），与批量删除弹窗同一句。
 */
export function buildCardContextMenu(
	menu: Menu,
	options: CardContextMenuOptions,
): void {
	const { targets, pinned, repeated, writable } = options;
	const count = targets.length;
	const many = count > 1;
	const defer = (run: () => void): void => {
		window.setTimeout(run, MENU_ACTION_DEFER_DELAY_MS);
	};

	// ① 固定任务 / 取消固定
	menu.addItem((item) =>
		item
			.setTitle(
				many
					? t(
							pinned
								? 'view.iotoTaskView.contextMenu.unpinTasks'
								: 'view.iotoTaskView.contextMenu.pinTasks',
							[String(count)],
						)
					: t(
							pinned
								? 'view.iotoTaskView.contextMenu.unpinTask'
								: 'view.iotoTaskView.contextMenu.pinTask',
						),
			)
			.setIcon(pinned ? 'pin-off' : 'pin')
			.setDisabled(!writable)
			.onClick(() => defer(() => options.onPin(targets, !pinned))),
	);

	// ② 标记为重复任务 / 取消重复
	menu.addItem((item) =>
		item
			.setTitle(
				many
					? t(
							repeated
								? 'view.iotoTaskView.contextMenu.unrepeatTasks'
								: 'view.iotoTaskView.contextMenu.repeatTasks',
							[String(count)],
						)
					: t(
							repeated
								? 'view.iotoTaskView.contextMenu.unrepeatTask'
								: 'view.iotoTaskView.contextMenu.repeatTask',
						),
			)
			.setIcon(repeated ? 'repeat-2' : 'repeat')
			.setDisabled(!writable)
			.onClick(() => defer(() => options.onRepeat(targets, !repeated))),
	);

	// ③ 标记为完成（仅多选：单选有卡片 checkbox 原位入口，Q3）
	if (many) {
		menu.addItem((item) =>
			item
				.setTitle(
					t('view.iotoTaskView.contextMenu.doneTasks', [
						String(count),
					]),
				)
				.setIcon('check')
				.setDisabled(!writable)
				.onClick(() => defer(() => options.onMarkDone(targets))),
		);
	}

	// ④ 分隔线（删除放最后且与前两项隔开）
	menu.addSeparator();

	// ⑤ 创建任务副本（Johnny 拍板：分隔线之后、删除之前）
	menu.addItem((item) =>
		item
			.setTitle(
				many
					? t('view.iotoTaskView.contextMenu.duplicateTasks', [
							String(count),
						])
					: t('view.iotoTaskView.contextMenu.duplicateTask'),
			)
			.setIcon('copy')
			.setDisabled(!writable)
			.onClick(() => defer(() => options.onDuplicate(targets))),
	);

	// ⑥ 移动到其他任务文件（跨文件搬运，与命令面板同入口）
	menu.addItem((item) =>
		item
			.setTitle(
				many
					? t('view.iotoTaskView.contextMenu.moveToFiles', [
							String(count),
						])
					: t('view.iotoTaskView.contextMenu.moveToFile'),
			)
			.setIcon('file-input')
			.setDisabled(!writable)
			.onClick(() => defer(() => options.onMoveToFile(targets))),
	);

	// ⑦ 删除任务（复用既有文案键；走 requestDelete 的二次确认链 / 多选批量确认）
	menu.addItem((item) =>
		item
			.setTitle(
				many
					? t('view.iotoTaskView.toolbar.deleteTasks', [String(count)])
					: t('view.iotoTaskView.cardActions.deleteTask'),
			)
			.setIcon('trash-2')
			.setDisabled(!writable)
			.onClick(() => defer(() => options.onDelete(targets))),
	);
}

/** 生产入口：`new Menu` + 构造 + 在鼠标位置弹出（50ms defer 原样保留）。 */
export function showCardContextMenu(
	event: MouseEvent,
	options: CardContextMenuOptions,
): void {
	const menu = new Menu();
	buildCardContextMenu(menu, options);
	menu.showAtMouseEvent(event);
}

/**
 * 右键命中判定：返回 `true` 才弹任务菜单。
 * 与卡片 `click` 的 `closest` 排除表（render-checklist-card.ts:201-251）同口径，
 * **两处刻意不同**：`.card-editor` 放行原生菜单（拼写检查 / 粘贴要用）；
 * 正文里的 `<a>` 与 `.card-continuation` 都**弹任务菜单**——自定义视图里的 `<a>`
 * 没有核心原生菜单，续行块本来就是卡片的一部分。
 */
export function shouldShowCardContextMenu(target: HTMLElement | null): boolean {
	if (!target) return false;
	if (target.closest('.ioto-task-view__card-editor')) return false;
	if (target.closest('.ioto-task-view__delete-confirm')) return false;
	if (target.closest('.ioto-task-view__card-checkbox')) return false;
	if (target.closest('.ioto-task-view__card-drag-handle')) return false;
	if (target.closest('.ioto-task-view__badge')) return false;
	if (target.closest('.ioto-task-view__card-action-btn')) return false;
	return true;
}
