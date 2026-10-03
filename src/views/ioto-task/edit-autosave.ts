/**
 * 编辑态自动落盘的节流器（[[Plan-20261003-233605]] §三）。
 *
 * 与核心 `TextFileView.requestSave = debounce(save, 2000)` 同口径：
 * **截止期不随新输入后移** —— 持续输入时最多每 `intervalMs` 落盘一次，
 * 而不是「停手 intervalMs 才写」（纯 debounce 会让长句永远不落盘）。
 * 最后一次变更与落盘之间的空档，由退出编辑时的 `commitEdit()` 兜底。
 *
 * 不 import obsidian、不触 DOM，可被 jiti 直接单测。
 */

/**
 * 定时器宿主：插件里用 `window.*`（弹窗兼容，见 obsidianmd/prefer-window-timers）；
 * `node --test` 没有 `window` → 退回全局定时器，保证节流语义可被单测直接断言。
 */
const timers: Window =
	// eslint-disable-next-line obsidianmd/no-global-this -- node --test 无 window，只能退回全局定时器
	typeof window === 'undefined' ? (globalThis as unknown as Window) : window;

export interface AutosaveScheduler {
	/** 有变更时调用；已在等待中则忽略（不后移截止期） */
	schedule(): void;
	/** 取消待写（blur 提交前调用，避免紧接着重复写一次） */
	cancel(): void;
	/** 停止并释放定时器（视图卸载 / 编辑器销毁） */
	dispose(): void;
	/** 是否有待写的定时器（单测与真机断言用） */
	readonly pending: boolean;
}

export function createAutosaveScheduler(
	run: () => void,
	intervalMs: number,
): AutosaveScheduler {
	let timer: ReturnType<Window['setTimeout']> | null = null;
	let disposed = false;

	const clear = () => {
		if (timer !== null) {
			timers.clearTimeout(timer);
			timer = null;
		}
	};

	return {
		get pending() {
			return timer !== null;
		},
		schedule() {
			if (disposed || timer !== null) {
				return;
			}
			timer = timers.setTimeout(() => {
				timer = null;
				run();
			}, intervalMs);
		},
		cancel: clear,
		dispose() {
			disposed = true;
			clear();
		},
	};
}
