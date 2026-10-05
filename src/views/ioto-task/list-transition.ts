/**
 * 「最近任务」窗口增删时卡片进出场动效的纯逻辑 + DOM 执行器
 * （[[Plan-20261005-150106]] §2.2；[[Plan-20261005-152203]] §3 拆为 prepare/play）。
 *
 * 执行器分两段：`prepareSwapTransition` 同步定格「起点态」（首帧即起点，消灭闪帧），
 * `SwapTransitionPlan.play()` 在下一帧起播、`cancel()` 立即收尾；`runSwapTransition`
 * 是二者的同步薄封装（兼容无需等待落字的路径与单测）。
 *
 * 零 `obsidian` 依赖；diff / 方向 / 阈值等纯函数可被 jiti 直接单测。
 * 模块顶层**不触碰** `document` / `window`，DOM 执行器只在被调用时读取全局，
 * 因此 jiti 导入安全（测试只喂纯函数 + `reducedMotion` 短路）。
 *
 * 身份 key 用「缩进 + 源码文本」而不是 `data-line`：行号在删/插后会整体漂移，
 * 不能当身份（坑 1）。
 */

/** 一次操作允许的最大进出卡数；超过则降级为不动画（Q8，K=4）。 */
export const TRANSITION_MAX_MOVES = 4;

/** 卡片身份：缩进 + 源码文本。raw key = `${indent}\u0000${text}`。 */
export function buildCardKey(
	indent: string | null,
	text: string | null,
): string {
	return `${indent ?? ''}\u0000${text ?? ''}`;
}

/** 同一 key 多次出现时按文档顺序补 `#序号`，保证一一对应。 */
export function normalizeCardKeys(keys: readonly string[]): string[] {
	const seen = new Map<string, number>();
	const out: string[] = [];
	for (const key of keys) {
		const count = seen.get(key) ?? 0;
		seen.set(key, count + 1);
		out.push(count === 0 ? key : `${key}\u0000#${count}`);
	}
	return out;
}

export interface KeyedDiff {
	/** 旧集索引（未匹配 = 退出的卡） */
	leaving: number[];
	/** 新集索引（未匹配 = 进入的卡） */
	entering: number[];
	/** 旧索引 → 新索引（LCS 保序匹配的幸存卡） */
	surviving: Array<{ from: number; to: number }>;
}

/**
 * 按内容 key 求「退出 / 进入 / 幸存」三组。
 *
 * 用最长公共子序列（LCS）保序匹配，列表规模即屏上卡片数，O(n·m) 无压力。
 */
export function diffCardKeys(
	oldKeys: readonly string[],
	newKeys: readonly string[],
): KeyedDiff {
	const n = oldKeys.length;
	const m = newKeys.length;

	// dp[i][j] = oldKeys[i..] 与 newKeys[j..] 的 LCS 长度
	const dp: number[][] = Array.from({ length: n + 1 }, () =>
		new Array<number>(m + 1).fill(0),
	);
	for (let i = n - 1; i >= 0; i -= 1) {
		const row = dp[i];
		const nextRow = dp[i + 1];
		if (!row || !nextRow) {
			continue;
		}
		for (let j = m - 1; j >= 0; j -= 1) {
			row[j] =
				oldKeys[i] === newKeys[j]
					? (nextRow[j + 1] ?? 0) + 1
					: Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
		}
	}

	const matchedOld = new Array<boolean>(n).fill(false);
	const matchedNew = new Array<boolean>(m).fill(false);
	const surviving: Array<{ from: number; to: number }> = [];

	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (oldKeys[i] === newKeys[j]) {
			surviving.push({ from: i, to: j });
			matchedOld[i] = true;
			matchedNew[j] = true;
			i += 1;
			j += 1;
		} else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
			i += 1;
		} else {
			j += 1;
		}
	}

	const leaving: number[] = [];
	for (let k = 0; k < n; k += 1) {
		if (!matchedOld[k]) {
			leaving.push(k);
		}
	}
	const entering: number[] = [];
	for (let k = 0; k < m; k += 1) {
		if (!matchedNew[k]) {
			entering.push(k);
		}
	}

	return { leaving, entering, surviving };
}

/**
 * 幸存卡位移（`newTop - oldTop`）：整体下移 → 新卡自上方来；整体上移 → 自下方来。
 * 空 / 全 0（无处判断）一律兜底为 `from-bottom`。
 */
export function pickEnterDirection(
	shifts: readonly number[],
): 'from-top' | 'from-bottom' {
	let sum = 0;
	for (const shift of shifts) {
		sum += shift;
	}
	return sum > 0 ? 'from-top' : 'from-bottom';
}

/**
 * 规模是否在可动画阈值内（Q8）。
 *
 * 只判上限：无进出的 diff（0 ≤ K）也返回 `true`，由 `runSwapTransition`
 * 的「无进出直接 return null」兜底（测试 3 的口径）。
 */
export function shouldAnimateSwap(
	diff: KeyedDiff,
	maxMoves = TRANSITION_MAX_MOVES,
): boolean {
	return diff.leaving.length + diff.entering.length <= maxMoves;
}

export interface CardSnapshot {
	/** 节点引用（`empty()` 后仍在内存，可直接复用，无需 `cloneNode`）。 */
	el: HTMLElement;
	key: string;
	/** 相对滚动容器视口（水平无滚动）。 */
	left: number;
	/** 滚动内容坐标 = `rect.top - scrollRect.top + scrollTop`。 */
	top: number;
	width: number;
	height: number;
}

/**
 * 采集 `scrollEl` 内全部卡片的快照（含节点引用与内容坐标）。
 * 排除浮层里正在退出的卡（`.is-leaving`），避免连续动画时被重复计入。
 */
export function captureCardSnapshots(
	scrollEl: HTMLElement,
	cardSelector: string,
): CardSnapshot[] {
	if (!scrollEl || typeof scrollEl.getBoundingClientRect !== 'function') {
		return [];
	}

	const scrollRect = scrollEl.getBoundingClientRect();
	const scrollTop = scrollEl.scrollTop;
	const snapshots: CardSnapshot[] = [];
	// 显式给类型参数以命中 `querySelectorAll<E>(selectors: string)` 重载，
	// 否则 TS 会解析到 `HTMLElementDeprecatedTagNameMap` 的 `@deprecated` 重载。
	const nodes = scrollEl.querySelectorAll<HTMLElement>(cardSelector);
	for (const el of Array.from(nodes)) {
		if (el.classList?.contains('is-leaving')) {
			continue;
		}
		const rect = el.getBoundingClientRect();
		snapshots.push({
			el,
			key: buildCardKey(
				el.getAttribute('data-indent'),
				el.getAttribute('data-task-key'),
			),
			left: rect.left - scrollRect.left,
			top: rect.top - scrollRect.top + scrollTop,
			width: rect.width,
			height: rect.height,
		});
	}

	return snapshots;
}

export interface RunSwapTransitionOptions {
	scrollEl: HTMLElement;
	oldSnapshots: readonly CardSnapshot[];
	newSnapshots: readonly CardSnapshot[];
	reducedMotion: boolean;
	maxMoves?: number;
	/** 进入 / 退出的位移幅度（px），默认 10（[[Plan-20261005-152203]] §4.1）。 */
	offsetPx?: number;
	durationMs?: { enter: number; leave: number; flip: number };
	/** 各段起播延迟（ms）；默认 `enter 40 / leave 0 / flip 0`（§4.1 stagger）。 */
	delayMs?: { enter: number; leave: number; flip: number };
	/** 退出卡微移模式：`scale`（默认，淡出 + 微缩，无方向歧义）或 `slide`（方向反号微移）。 */
	leaveMode?: 'scale' | 'slide';
}

/**
 * `prepareSwapTransition` 返回的动画计划。
 *
 * 调用方在下一帧调 `play()` 起播；取消 / 新渲染时调 `cancel()` 立即收尾。两者均幂等。
 */
export interface SwapTransitionPlan {
	/** 施加目标态 + transition（起播）。幂等。 */
	play(): void;
	/** 立即收尾：移除浮层、清状态类与 inline 样式（取消 / 新渲染时调用）。幂等。 */
	cancel(): void;
}

const DEFAULT_DURATION = { enter: 240, leave: 180, flip: 300 };
const DEFAULT_DELAY = { enter: 40, leave: 0, flip: 0 };
const DEFAULT_OFFSET_PX = 10;
/** 强减速（easeOutQuint 类、无过冲）：让位 / 出现的「落定」感（§4.1）。 */
const EASING_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
/** 对称缓出：退出淡出，去掉 `ease-in` 的起步迟滞（§4.1）。 */
const EASING_IN_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)';
/** 透明度相对位移动提前收敛的比例（进入前 60% / 退出前 70%，§4.3）。 */
const ENTER_OPACITY_RATIO = 0.6;
const LEAVE_OPACITY_RATIO = 0.7;
/** `scale` 退场模式的终点缩放（§4.2）。 */
const LEAVE_SCALE = 0.98;

/**
 * 同步 phase-1：门控 → diff → 建浮层 → **只施加「起点态」**（退出卡进浮层、
 * 幸存卡反位移到旧位、进入卡透明 + 偏移），并强制一次 reflow 把起点态定格。
 *
 * 因为整段同步执行、且在 `renderNote` 返回前完成，浏览器绘制新列表的**第一帧**
 * 就是起点态——不再先闪最终态再跳回起点（[[Plan-20261005-152203]] RC1）。
 * 返回的 plan 由调用方在下一帧调 `play()` 起播；被门控跳过时返回 `null`。
 */
export function prepareSwapTransition(
	options: RunSwapTransitionOptions,
): SwapTransitionPlan | null {
	const { scrollEl, oldSnapshots, newSnapshots, reducedMotion } = options;

	// 顺序固定：reduced-motion → 无 DOM → 无进出 → 规模阈值。
	if (reducedMotion) {
		return null;
	}
	if (
		!scrollEl ||
		typeof scrollEl.getBoundingClientRect !== 'function' ||
		typeof activeDocument === 'undefined' ||
		typeof window === 'undefined'
	) {
		return null;
	}

	const oldKeys = normalizeCardKeys(oldSnapshots.map((s) => s.key));
	const newKeys = normalizeCardKeys(newSnapshots.map((s) => s.key));
	const diff = diffCardKeys(oldKeys, newKeys);
	if (diff.leaving.length === 0 && diff.entering.length === 0) {
		return null;
	}
	if (!shouldAnimateSwap(diff, options.maxMoves ?? TRANSITION_MAX_MOVES)) {
		return null;
	}

	const duration = { ...DEFAULT_DURATION, ...options.durationMs };
	const delay = { ...DEFAULT_DELAY, ...options.delayMs };
	const offset = options.offsetPx ?? DEFAULT_OFFSET_PX;
	const leaveMode = options.leaveMode ?? 'scale';

	const layer = activeDocument.createElement('div');
	layer.className = 'ioto-task-view__transition-layer';
	scrollEl.appendChild(layer);
	// 动画期间抑制卡片 hover 位移（§4.5），收尾时移除。
	scrollEl.classList.add('is-animating');

	const leavingEls: HTMLElement[] = [];
	const animatedEls: HTMLElement[] = [];
	const timers: number[] = [];

	// ① 退出的卡：旧节点（已被 empty()/remove() 摘除）进浮层，只施加起点态。
	for (const index of diff.leaving) {
		const snapshot = oldSnapshots[index];
		if (!snapshot) {
			continue;
		}
		const el = snapshot.el;
		el.classList.add('is-leaving');
		// 一律用 setCssProps 写 inline（inline 赢过 `.is-glass` 基过渡的高特异性类规则）。
		el.setCssProps({
			position: 'absolute',
			margin: '0',
			left: `${snapshot.left}px`,
			top: `${snapshot.top}px`,
			width: `${snapshot.width}px`,
			height: `${snapshot.height}px`,
			transition: 'none',
			opacity: '1',
			transform: 'none',
		});
		layer.appendChild(el);
		leavingEls.push(el);
	}

	// ② 幸存的卡：FLIP。反位移 = 旧位 - 新位（先回到旧位，play 时归 0）。
	// 注意：② 就地移除路径里幸存卡与新集是**同一节点**，必须照做 FLIP，不能跳过。
	const shifts: number[] = [];
	const flipTargets: Array<{
		el: HTMLElement;
		oldTop: number;
		startTranslate: number;
	}> = [];
	for (const pair of diff.surviving) {
		const oldSnap = oldSnapshots[pair.from];
		const newSnap = newSnapshots[pair.to];
		if (!oldSnap || !newSnap) {
			continue;
		}
		// 位移口径：新位 - 旧位（>0 表示整体下移，供方向推导）。
		const shift = newSnap.top - oldSnap.top;
		shifts.push(shift);
		const el = newSnap.el;
		const startTranslate = -shift;
		el.classList.add('is-flipping');
		el.setCssProps({
			transition: 'none',
			transform: `translateY(${startTranslate}px)`,
		});
		flipTargets.push({ el, oldTop: oldSnap.top, startTranslate });
		animatedEls.push(el);
	}

	// ③ 进入的卡：方向由幸存卡位移推导，初始偏移 + 透明，play 时归位淡入。
	const direction = pickEnterDirection(shifts);
	const startY = direction === 'from-top' ? -offset : offset;
	const enterEls: HTMLElement[] = [];
	for (const index of diff.entering) {
		const snapshot = newSnapshots[index];
		if (!snapshot) {
			continue;
		}
		const el = snapshot.el;
		el.classList.add('is-entering');
		el.setCssProps({
			transition: 'none',
			opacity: '0',
			transform: `translateY(${startY}px)`,
		});
		enterEls.push(el);
		animatedEls.push(el);
	}

	// 定格起点态：强制一次 reflow，让上面的初始状态被浏览器接纳。
	void scrollEl.getBoundingClientRect();

	let cleaned = false;
	let started = false;

	const cancel = (): void => {
		if (cleaned) {
			return;
		}
		cleaned = true;
		started = true;
		for (const timer of timers) {
			window.clearTimeout(timer);
		}
		timers.length = 0;
		for (const el of leavingEls) {
			el.remove();
		}
		for (const el of animatedEls) {
			el.classList.remove('is-entering', 'is-flipping');
			el.setCssProps({ transition: '', opacity: '', transform: '' });
		}
		scrollEl.classList.remove('is-animating');
		layer.remove();
	};

	const play = (): void => {
		if (cleaned || started) {
			return;
		}
		started = true;

		// §3.3：起播前重采几何，把异步落字导致的高度漂移吸收进起点态
		//（此时仍是 `transition:none` 的起点态，改动不会被看到）。
		let corrected = false;
		if (flipTargets.length > 0) {
			const scrollRect = scrollEl.getBoundingClientRect();
			const scrollTop = scrollEl.scrollTop;
			for (const target of flipTargets) {
				const rect = target.el.getBoundingClientRect();
				const currentTop = rect.top - scrollRect.top + scrollTop;
				// 目标：视觉仍停在旧位；反解出（漂移后的）起始反位移。
				const desired =
					target.oldTop - currentTop + target.startTranslate;
				if (Math.abs(desired - target.startTranslate) > 0.5) {
					target.el.setCssProps({
						transform: `translateY(${desired}px)`,
					});
					target.startTranslate = desired;
					corrected = true;
				}
			}
			if (corrected) {
				void scrollEl.getBoundingClientRect();
			}
		}

		const leaveTranslate = direction === 'from-top' ? offset : -offset;
		for (const el of leavingEls) {
			el.setCssProps({
				transition: `opacity ${Math.round(
					duration.leave * LEAVE_OPACITY_RATIO,
				)}ms ${EASING_IN_OUT} ${delay.leave}ms, transform ${duration.leave}ms ${EASING_IN_OUT} ${delay.leave}ms`,
				opacity: '0',
				transform:
					leaveMode === 'scale'
						? `scale(${LEAVE_SCALE})`
						: `translateY(${leaveTranslate}px)`,
			});
		}
		for (const target of flipTargets) {
			if (Math.abs(target.startTranslate) <= 0.5) {
				// 重采后确认「没动」：撤掉状态类，不做无意义动画。
				target.el.classList.remove('is-flipping');
				target.el.setCssProps({ transition: '', transform: '' });
				continue;
			}
			target.el.setCssProps({
				transition: `transform ${duration.flip}ms ${EASING_OUT} ${delay.flip}ms`,
				transform: 'translateY(0)',
			});
		}
		for (const el of enterEls) {
			el.setCssProps({
				transition: `opacity ${Math.round(
					duration.enter * ENTER_OPACITY_RATIO,
				)}ms ${EASING_OUT} ${delay.enter}ms, transform ${duration.enter}ms ${EASING_OUT} ${delay.enter}ms`,
				opacity: '1',
				transform: 'translateY(0)',
			});
		}

		const maxDuration = Math.max(
			duration.leave + delay.leave,
			duration.enter + delay.enter,
			duration.flip + delay.flip,
		);
		timers.push(window.setTimeout(cancel, maxDuration + 40));
	};

	return { play, cancel };
}

/**
 * 一体化薄封装：`prepare` + 立即 `play`（② 就地移除等无需等待落字的路径复用）。
 * 返回「立即收尾」清理函数；被门控跳过时返回 `null`。
 */
export function runSwapTransition(
	options: RunSwapTransitionOptions,
): (() => void) | null {
	const plan = prepareSwapTransition(options);
	if (!plan) {
		return null;
	}
	plan.play();
	return () => plan.cancel();
}
