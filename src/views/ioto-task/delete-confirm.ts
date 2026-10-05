/**
 * IOTOTask 视图「选择态 → 待删除确认」瞬态的纯键位决策
 * （[[Plan-20261005-141853]] 步骤 5 / 步骤 10）。
 *
 * 职责单一：把「是否处于 pending + 本次按键 + auto-repeat + 修饰键」翻译成一个
 * 动作枚举，供 `render-note.ts` 的卡片 keydown 顶部路由直接使用。
 *
 * 为什么抽成纯函数：`event.repeat` 守卫、二次 `Delete` 确认、`Enter` 与
 * `Shift+Enter` / `Cmd+Enter` 的区分是全链路最易错的部分，抽出来后可用
 * `node --test` 覆盖，不必启动真机（照 `card-navigation.ts` / `select-mode-scope.ts`
 * 先例，本模块不 import obsidian）。
 *
 * 触发时机：仅当选择态处于「待删除确认」时才会进入本判定；非 pending 时返回
 * `'idle'`（调用方本就不会调用，保留此分支便于单测表达完整语义）。
 */

/** 一次按键在待删除确认语境下的处理动作。 */
export type DeleteConfirmKeyAction =
	/** 非 pending：不属于本语境，交给常规键位分支。 */
	| 'idle'
	/** pending 中的长按连发：吞掉，绝不让它落到「确认」。 */
	| 'repeat'
	/** pending 中确认为删除（二次 Del/Backspace 或纯 Enter）。 */
	| 'confirm'
	/** pending 中取消（Esc）。 */
	| 'cancel'
	/** pending 中其它键：先取消 pending，再放行到常规分支。 */
	| 'fallthrough';

/**
 * 判断本次按键在「待删除确认」瞬态下应做什么。
 *
 * 判定顺序（不可颠倒）：
 * 1. `repeat` 守卫最前——否则长按 `Delete` 的连发会在第二帧直接确认（坑 A）；
 * 2. `Esc` → 取消（Q3）；
 * 3. `Delete` / `Backspace` → 确认（二次 Del）；
 * 4. 纯 `Enter`（无 Shift / 主修饰键 / Alt）→ 确认（与「确认」按钮同义）；
 * 5. 其余（含 `↑↓`、`Shift+Enter`、`Cmd/Ctrl+Enter`）→ fallthrough：先取消再走常规分支。
 *
 * @param pending 是否正处于待删除确认瞬态（非 pending 恒返回 `'idle'`）。
 * @param key `KeyboardEvent.key`
 * @param repeat `KeyboardEvent.repeat`（长按连发）
 * @param opts `Shift` / 主修饰键（Cmd 或 Ctrl）/ `Alt` 的按下状态
 */
export function resolveDeleteConfirmKey(
	pending: boolean,
	key: string,
	repeat: boolean,
	opts?: {
		shiftKey?: boolean;
		commandModifier?: boolean;
		altKey?: boolean;
	},
): DeleteConfirmKeyAction {
	if (!pending) {
		return 'idle';
	}

	// 坑 A：长按连发必须先吞掉，否则「进 pending 的那一按」的第二次 repeat
	// 会在同一帧内直接确认。
	if (repeat) {
		return 'repeat';
	}

	if (key === 'Escape') {
		return 'cancel';
	}

	if (key === 'Delete' || key === 'Backspace') {
		return 'confirm';
	}

	if (
		key === 'Enter' &&
		!opts?.shiftKey &&
		!opts?.commandModifier &&
		!opts?.altKey
	) {
		return 'confirm';
	}

	return 'fallthrough';
}
