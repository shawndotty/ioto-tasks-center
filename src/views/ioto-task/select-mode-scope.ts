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
 * ## 挂在哪：`View.scope`（唯一合法落点）
 *
 * 核心 Workspace 的 scope 是 DeferredScope：每次 keydown 现取
 * `activeLeaf.view.scope`，取不到才回落 root。因此把 Mod+Enter 挂在视图自己的 scope 上，
 * 天然只在「本视图是 activeLeaf」时参与分发：多个 IOTOTask leaf 同时打开时只有 active
 * 的那个接管，也不会吞掉笔记里的 `Cmd+Enter`。
 *
 * 🔴 禁止 `app.keymap.pushScope(...)` 常驻：`pushScope` 把当前栈顶塞进 `prevScopes`，
 * 而 `Scope.handleKey` 只沿 parent 上溯、从不看 `prevScopes`；且它命中「具体键位」后
 * 若回调返回 `undefined` 会**直接 return**（既不执行、也不 preventDefault），
 * 于是核心热键被静默吞掉（[[Research-20261024-181347]] §2.2 / §2.3）。
 *
 * `Mod` 由核心翻译成各平台的主修饰键（macOS → Command，其它 → Ctrl），
 * 因此这里不需要写 `Platform.isMacOS` 分支，Windows 与 macOS 语义一次到位。
 *
 * 本模块**不 import obsidian 运行时**（`Scope` 由调用方注入），可直接 jiti 单测；
 * scope 的创建与赋值在 `IOTOTaskView` 构造函数（`this.scope = scope`）。
 */

/** 视图侧需要提供的能力：判定 + 执行。 */
export interface ModEnterHost {
	/** 当前是否应由本视图接管这次 Mod+Enter（有选中卡 + 非编辑态） */
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
 * 🔴 宿主必须**每次按键时重新解析**：宿主对象每次按键重建（`() => view.modEnterHost()`），
 * 避免视图重建后拿到过期引用；同时同类型可能有多个 leaf 同时打开，注册时捕获实例
 * 会指向错误的视图。
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
