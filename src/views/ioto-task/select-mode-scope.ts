/**
 * IOTOTask 视图「选中态」的 Mod+Enter 键位桥接。
 *
 * ## 为什么不能在卡片 DOM 上监听
 *
 * 卡片监听器（`render-note.ts` 的 `cardEl.addEventListener('keydown', …)`）挂在
 * **冒泡阶段**，而 Obsidian 核心 `Keymap` 在 app 初始化时（早于任何插件）就把
 * keydown **capture** 监听挂在了 `window` 上。`window` 是 DOM 根，事件在那里
 * 就被处理完；`Mod+Enter`（macOS = Command，其它平台 = Ctrl）正是核心默认热键，
 * 于是被 `preventDefault` 并被吞掉，根本降不到卡片元素：
 *
 * - Windows：`Ctrl+Enter` 撞核心（Mod = Ctrl）→ 完全无效；
 * - macOS：`Command+Enter` 撞核心，只有不撞的 `Ctrl+Enter` 能穿过 → 能用。
 *
 * 把卡片监听改成 capture **也无效**：同一元素同一阶段按注册顺序 FIFO，
 * 核心永远在前；`stopImmediatePropagation` 同理拦不住已先执行的监听器。
 *
 * ## 为什么用 Scope
 *
 * 唯一能在核心分发**内部**抢先的入口是 `Scope`：核心处理按键时会先询问当前
 * scope，回调返回 `false` 表示「已处理」，核心自动 `preventDefault` 并抑制它
 * 自己的 Mod+Enter；返回 `undefined` 则原样放行。
 *
 * `Mod` 由核心翻译成各平台的主修饰键（macOS → Command，其它 → Ctrl），
 * 因此这里不需要写 `Platform.isMacOS` 分支，Windows 与 macOS 语义一次到位。
 *
 * 本模块**不 import obsidian 运行时**（`Scope` 由调用方注入），可直接 jiti 单测；
 * scope 的创建 / 压栈 / 卸载在 `main.ts`（生命周期归插件）。
 */

/** 视图侧需要提供的能力：判定 + 执行。 */
export interface ModEnterHost {
	/** 当前是否应由本视图接管这次 Mod+Enter（active 视图 + 有选中卡 + 非编辑态） */
	canToggleSelected(): boolean;
	/** 切换选中卡的完成态 */
	toggleSelected(): void;
}

/** `Scope#register` 所需的最小形状，便于单测传入假对象。 */
export interface ScopeLike {
	register(
		modifiers: string[] | null,
		key: string | null,
		func: () => boolean | undefined,
	): unknown;
}

/** 主修饰键 + Enter：把平台差异交给核心的 `Mod` 语义。 */
export const SELECT_MODE_HOTKEY_MODIFIERS = ['Mod'];
export const SELECT_MODE_HOTKEY_KEY = 'Enter';

/**
 * 构造 scope 回调：
 * - 命中（本视图可接管）→ 执行切换并返回 `false`（抑制核心的 Mod+Enter）；
 * - 未命中 → 返回 `undefined`（原样放行）。
 *
 * 🔴 宿主必须**每次按键时重新解析**：视图实例是后来才创建的，且同一类型可能有
 * 多个 leaf 同时打开，注册时捕获实例会指向错误的视图。
 */
export function createModEnterHandler(
	resolveHost: () => ModEnterHost | null,
): () => boolean | undefined {
	return () => {
		const host = resolveHost();
		if (!host || !host.canToggleSelected()) {
			return undefined;
		}
		host.toggleSelected();
		return false;
	};
}

/** 把 Mod+Enter 处理器挂到给定 scope 上。 */
export function registerModEnterHandler(
	scope: ScopeLike,
	resolveHost: () => ModEnterHost | null,
): void {
	scope.register(
		[...SELECT_MODE_HOTKEY_MODIFIERS],
		SELECT_MODE_HOTKEY_KEY,
		createModEnterHandler(resolveHost),
	);
}
