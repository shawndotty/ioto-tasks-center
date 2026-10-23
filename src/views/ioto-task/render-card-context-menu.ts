/**
 * 任务卡右键菜单（[[Plan-20261023-104335]] §4.6）。
 *
 * 四项：固定任务 / 取消固定 → 标记为重复任务 / 取消重复 → 分隔线
 * → 创建任务副本 → 删除任务（顺序由 Johnny 拍板，[[Research-20261023-090756]] §八 #3 /
 * [[Plan-20261023-145916]] §二 #4）。
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
	line: number;
	/** 渲染期从 `item.controls` 读的快照：卡片每次写回都整树重建，快照在一次渲染周期内恒真 */
	pinned: boolean;
	repeated: boolean;
	/** 可写（`editing.enabled`）；false → 四项全部置灰（Johnny 拍板 #2） */
	writable: boolean;
	onPin: (line: number) => void;
	onRepeat: (line: number) => void;
	onDuplicate: (line: number) => void;
	onDelete: (line: number) => void;
}

export function showCardContextMenu(
	event: MouseEvent,
	options: CardContextMenuOptions,
): void {
	const { line, pinned, repeated, writable } = options;
	const menu = new Menu();
	const defer = (run: () => void): void => {
		window.setTimeout(run, MENU_ACTION_DEFER_DELAY_MS);
	};

	// ① 固定任务 / 取消固定
	menu.addItem((item) =>
		item
			.setTitle(
				t(
					pinned
						? 'view.iotoTaskView.contextMenu.unpinTask'
						: 'view.iotoTaskView.contextMenu.pinTask',
				),
			)
			.setIcon(pinned ? 'pin-off' : 'pin')
			.setDisabled(!writable)
			.onClick(() => defer(() => options.onPin(line))),
	);

	// ② 标记为重复任务 / 取消重复
	menu.addItem((item) =>
		item
			.setTitle(
				t(
					repeated
						? 'view.iotoTaskView.contextMenu.unrepeatTask'
						: 'view.iotoTaskView.contextMenu.repeatTask',
				),
			)
			.setIcon(repeated ? 'repeat-2' : 'repeat')
			.setDisabled(!writable)
			.onClick(() => defer(() => options.onRepeat(line))),
	);

	// ③ 分隔线（删除放最后且与前两项隔开）
	menu.addSeparator();

	// ④ 创建任务副本（Johnny 拍板：分隔线之后、删除之前）
	menu.addItem((item) =>
		item
			.setTitle(t('view.iotoTaskView.contextMenu.duplicateTask'))
			.setIcon('copy')
			.setDisabled(!writable)
			.onClick(() => defer(() => options.onDuplicate(line))),
	);

	// ⑤ 删除任务（复用既有文案键；走 requestDelete 的二次确认链，不直接 deleteSelected）
	menu.addItem((item) =>
		item
			.setTitle(t('view.iotoTaskView.cardActions.deleteTask'))
			.setIcon('trash-2')
			.setDisabled(!writable)
			.onClick(() => defer(() => options.onDelete(line))),
	);

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
