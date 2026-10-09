/**
 * 卡片选择态键位路由：Enter 编辑 / ↑↓ 移动选择 / Delete·Backspace 删除 /
 * Tab·Shift+Tab 缩进 / Shift+Enter 建同级 / 待删除确认瞬态优先。
 *
 * 从 `render-note.ts` 的 `renderChecklistGroup` 闭包中抽出（Phase 2），
 * 纯事件处理，零行为变更——原闭包体原样搬入 `attachCardKeydownHandler`。
 */

import type { NoteChecklistItem } from '../../tasks-center/note-structure';
import { isOverlayFocusTarget } from './embedded-editor';
import { resolveDeleteConfirmKey } from './delete-confirm';
import {
	collectCardLines,
	pickAdjacentLine,
	pickEdgeLine,
} from './card-navigation';
import type { TaskNoteEditing } from './render-note-types';

/**
 * 「主修饰键」：Mac 的 Command 与 Win/Linux 的 Ctrl。
 * 与核心「Cmd/Ctrl+Enter 切换勾选」的口径一致，故两者同义，不做平台分支
 * （[[Plan-20261003-222709]] §四.2b）。
 */
function hasCommandModifier(event: MouseEvent | KeyboardEvent): boolean {
	return event.metaKey || event.ctrlKey;
}

/**
 * 选择态键位：Enter 编辑 / ↑↓ 移动选择 / Delete·Backspace 删除
 * （[[Plan-20261003-194909]] §5.2d）。只读态不挂。
 */
export function attachCardKeydownHandler(
	cardEl: HTMLElement,
	item: NoteChecklistItem,
	editing: TaskNoteEditing,
): void {
	cardEl.addEventListener('keydown', (event) => {
		// IME 组字中一律放行，否则中文候选确认会误触发删除
		if (event.isComposing) {
			return;
		}
		// 浮层（条目控制 Modal / 建议器）抢焦点期间不吞键
		if (isOverlayFocusTarget(activeDocument.activeElement)) {
			return;
		}
		const target = event.target as HTMLElement | null;
		// 编辑器是卡片的**后代**，keydown 会冒泡上来；不守卫则编辑态输入
		// Enter / Backspace 会同时触发卡片分支（[[Plan-20261003-194909]] §6.3）。
		if (
			target?.closest('.ioto-task-view__card-editor') ||
			target?.closest('.ioto-task-view__continuation-editor')
		) {
			return;
		}
		// 只有卡片本体真正持有焦点时才响应（点了正文里的其他交互元素时不响应）
		if (target !== cardEl) {
			return;
		}
		// 方案 A（[[Discuss-20261008-173935]]）：放大态 = 单卡编辑面，卡片级键位
		// （↑↓ 导航 / Delete 删除 / Tab 缩进 / Shift+Enter 建同级）整体停用；
		// 编辑器自身键位由内嵌编辑器处理，删除入口须先「缩小」退出放大。
		if (editing.zoomLine === item.line) {
			return;
		}

		// 待删除确认瞬态：优先路由（[[Plan-20261005-141853]] 步骤 5）。
		// 判定抽成纯函数（delete-confirm.ts）覆盖 auto-repeat / 二次 Del / Esc / 导航。
		const pendingAction = resolveDeleteConfirmKey(
			editing.deletePending === true,
			event.key,
			event.repeat,
			{
				shiftKey: event.shiftKey,
				commandModifier: hasCommandModifier(event),
				altKey: event.altKey,
			},
		);
		if (pendingAction === 'repeat') {
			// 坑 A：长按连发不得走到确认
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (pendingAction === 'confirm') {
			// 二次 Del/Backspace 或纯 Enter → 确认（delete 由 requestDelete 分派）
			editing.delete(item.line);
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (pendingAction === 'cancel') {
			// Q3：Esc 取消
			editing.cancelDelete?.();
			event.preventDefault();
			event.stopPropagation();
			return;
		}
		if (pendingAction === 'fallthrough') {
			// 其余键（↑↓ / Shift+Enter / Cmd+Enter 等）：先取消 pending，再走常规分支
			editing.cancelDelete?.();
		}

		const order = collectCardLines(
			cardEl.closest('.ioto-task-view__scroll') ?? activeDocument.body,
		);
		switch (event.key) {
			case 'Enter': {
				// Mod+Enter（macOS Command / 其它平台 Ctrl）切换完成态**已移交
				// Obsidian Scope**（`select-mode-scope.ts`）：核心 Keymap 挂在
				// `window` 上的捕获监听会抢先吃掉这个组合，DOM 层根本收不到
				// （Windows 上 Ctrl+Enter 完全无效、macOS 只有 Ctrl+Enter 能用，
				// 就是这个原因）。
				// 这里只留兜底：万一事件仍冒泡进来，按原条件吞掉，**绝不**
				// 当作普通 Enter 落进编辑态（否则会与 scope 的写回交错）。
				if (
					hasCommandModifier(event) &&
					!event.shiftKey &&
					!event.altKey
				) {
					break;
				}
				// Shift+Enter：在选中卡片下方新建一张同级空卡并直接开编；
				// 纯修饰键排除，避免抢占 Ctrl/Cmd/Alt+Shift+Enter 等组合。
				if (
					event.shiftKey &&
					!hasCommandModifier(event) &&
					!event.altKey
				) {
					editing.insertSibling(item.line);
					break;
				}
				editing.beginEdit(item.line);
				break;
			}
			case 'ArrowUp': {
				// Cmd/Ctrl+↑：跳到第一张可见卡
				const jump =
					hasCommandModifier(event) &&
					!event.shiftKey &&
					!event.altKey;
				const prev = jump
					? pickEdgeLine(order, 'first')
					: pickAdjacentLine(order, item.line, -1);
				if (prev !== null) {
					editing.select(prev);
				}
				break;
			}
			case 'ArrowDown': {
				// Cmd/Ctrl+↓：跳到最后一张可见卡
				const jump =
					hasCommandModifier(event) &&
					!event.shiftKey &&
					!event.altKey;
				const next = jump
					? pickEdgeLine(order, 'last')
					: pickAdjacentLine(order, item.line, 1);
				if (next !== null) {
					editing.select(next);
				}
				break;
			}
			case 'Delete':
			case 'Backspace': {
				editing.delete(item.line);
				break;
			}
			case 'Tab': {
				// Tab / Shift+Tab 缩进选中卡（[[Plan-20261003-073911]] §3c）。
				// 纯修饰键组合（Cmd/Ctrl/Alt+Tab）交还系统 / 核心，不做缩进。
				if (hasCommandModifier(event) || event.altKey) {
					return;
				}
				editing.indent(item.line, event.shiftKey ? -1 : 1);
				break;
			}
			default:
				return;
		}
		event.preventDefault();
		event.stopPropagation();
	});
}
