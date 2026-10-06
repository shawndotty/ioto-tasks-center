/**
 * IOTOTask 视图「Ctrl/Cmd+F 唤出关键词搜索条」的键位桥接。
 *
 * ## 为什么不能在视图 DOM 上监听
 *
 * 与 `select-mode-scope.ts` 同一根因：Obsidian 核心 `Keymap` 在 app 初始化时就把
 * keydown **capture** 监听挂在了 `window` 上，`Mod+F` 是核心默认热键，事件在那里
 * 就被 `preventDefault` 吞掉，降不到视图元素。唯一能在核心分发内部抢先的入口是
 * `Scope`：回调返回 `false` 表示「已处理」，核心自动 `preventDefault` 并抑制自己的
 * `Mod+F`；返回 `undefined` 则原样放行。
 *
 * `Mod` 由核心翻译成各平台主修饰键（macOS → Command，其它 → Ctrl），无需平台分支。
 *
 * 本模块**不 import obsidian 运行时**（`Scope` 由调用方注入），可直接 jiti 单测；
 * scope 的创建 / 压栈 / 卸载在 `main.ts`（生命周期归插件）。
 */

/** 视图侧需要提供的能力：判定 + 执行。 */
export interface SearchHost {
	/** 当前是否应由本视图接管这次 Mod+F（active 视图 + 非编辑态） */
	canRevealSearch(): boolean;
	/** 显示搜索条并聚焦输入框 */
	revealSearch(): void;
}

/** `Scope#register` 所需的最小形状，便于单测传入假对象。 */
export interface ScopeLike {
	register(
		modifiers: string[] | null,
		key: string | null,
		func: () => boolean | undefined,
	): unknown;
}

/** 主修饰键 + F：把平台差异交给核心的 `Mod` 语义。 */
export const SEARCH_HOTKEY_MODIFIERS = ['Mod'];
export const SEARCH_HOTKEY_KEY = 'f';

/**
 * 构造 scope 回调：
 * - 命中（本视图可接管）→ 唤出搜索条并返回 `false`（抑制核心的 `Mod+F`）；
 * - 未命中 → 返回 `undefined`（原样放行）。
 *
 * 🔴 宿主必须**每次按键时重新解析**：视图实例后来才创建，且同类型可能有多个 leaf
 * 同时打开，注册时捕获实例会指向错误的视图。
 */
export function createSearchHandler(
	resolveHost: () => SearchHost | null,
): () => boolean | undefined {
	return () => {
		const host = resolveHost();
		if (!host || !host.canRevealSearch()) {
			return undefined; // 放行核心
		}
		host.revealSearch();
		return false; // 已接管
	};
}

/** 把 Mod+F 处理器挂到给定 scope 上。 */
export function registerSearchHandler(
	scope: ScopeLike,
	resolveHost: () => SearchHost | null,
): void {
	scope.register(
		[...SEARCH_HOTKEY_MODIFIERS],
		SEARCH_HOTKEY_KEY,
		createSearchHandler(resolveHost),
	);
}
