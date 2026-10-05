import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 「最近任务」增删进出场动效的纯逻辑（[[Plan-20261005-150106]] §2.2 / §5.1）。
// 零 obsidian 依赖，可 jiti 直接导入单测。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	TRANSITION_MAX_MOVES,
	buildCardKey,
	normalizeCardKeys,
	diffCardKeys,
	pickEnterDirection,
	shouldAnimateSwap,
	captureCardSnapshots,
	prepareSwapTransition,
	runSwapTransition,
} = await jiti.import('../src/views/ioto-task/list-transition.ts');

/** 便捷：old/new 序列 → 归一化后的 diff（与 runSwapTransition 内部同口径）。 */
function diffOf(oldKeys, newKeys) {
	return diffCardKeys(normalizeCardKeys(oldKeys), normalizeCardKeys(newKeys));
}

test('新增窗口：old [A,B,C] → new [B,C,D]', () => {
	const diff = diffOf(['A', 'B', 'C'], ['B', 'C', 'D']);
	assert.deepEqual(diff.leaving, [0]);
	assert.deepEqual(diff.entering, [2]);
	assert.deepEqual(diff.surviving, [
		{ from: 1, to: 0 },
		{ from: 2, to: 1 },
	]);
});

test('删除窗口：old [B,C,D] → new [A,B,D]', () => {
	const diff = diffOf(['B', 'C', 'D'], ['A', 'B', 'D']);
	assert.deepEqual(diff.leaving, [1]);
	assert.deepEqual(diff.entering, [0]);
	assert.deepEqual(diff.surviving, [
		{ from: 0, to: 1 },
		{ from: 2, to: 2 },
	]);
});

test('无变化：无进出（surviving 全量匹配），runSwapTransition 返回 null', () => {
	const diff = diffOf(['A', 'B'], ['A', 'B']);
	assert.deepEqual(diff.leaving, []);
	assert.deepEqual(diff.entering, []);
	assert.deepEqual(diff.surviving, [
		{ from: 0, to: 0 },
		{ from: 1, to: 1 },
	]);
	assert.equal(shouldAnimateSwap(diff), true);

	// 无进出：即便有 DOM 环境也直接返回 null（stub 出 document/window 以走到该分支）。
	const restore = stubDom();
	try {
		const result = runSwapTransition({
			scrollEl: {},
			oldSnapshots: [],
			newSnapshots: [],
			reducedMotion: false,
		});
		assert.equal(result, null);
	} finally {
		restore();
	}
});

test('重复文案：old [X,X] → new [X]（归一化按文档顺序补序号）', () => {
	const diff = diffOf(['X', 'X'], ['X']);
	assert.deepEqual(diff.leaving, [1]);
	assert.deepEqual(diff.entering, []);
	assert.deepEqual(diff.surviving, [{ from: 0, to: 0 }]);
});

test('buildCardKey：缩进 + 文本共同决定身份', () => {
	assert.equal(buildCardKey('0', 'hello'), '0\u0000hello');
	assert.equal(buildCardKey(null, null), '\u0000');
	assert.notEqual(buildCardKey('0', 'x'), buildCardKey('1', 'x'));
});

test('方向推导：全正 → from-top；全负 / 空 / 全 0 → from-bottom', () => {
	assert.equal(pickEnterDirection([10, 20]), 'from-top');
	assert.equal(pickEnterDirection([-10, -20]), 'from-bottom');
	assert.equal(pickEnterDirection([-30, 5]), 'from-bottom');
	assert.equal(pickEnterDirection([]), 'from-bottom');
	assert.equal(pickEnterDirection([0, 0]), 'from-bottom');
});

test('阈值 K：leaves+enters=4 → true；=5 → false', () => {
	assert.equal(TRANSITION_MAX_MOVES, 4);
	const four = diffOf(['A', 'B', 'C', 'D'], []);
	assert.equal(four.leaving.length + four.entering.length, 4);
	assert.equal(shouldAnimateSwap(four), true);

	const five = diffOf(['A', 'B', 'C', 'D', 'E'], []);
	assert.equal(five.leaving.length + five.entering.length, 5);
	assert.equal(shouldAnimateSwap(five), false);
});

test('reduce-motion：reducedMotion=true ⇒ runSwapTransition 返回 null（不触 DOM）', () => {
	const snapshots = [
		{ el: {}, key: 'k', left: 0, top: 0, width: 0, height: 0 },
	];
	const result = runSwapTransition({
		scrollEl: {},
		oldSnapshots: snapshots,
		newSnapshots: [],
		reducedMotion: true,
	});
	assert.equal(result, null);
});

test('captureCardSnapshots：内容坐标 = rect.top - scrollRect.top + scrollTop，且排除 is-leaving', () => {
	const scrollEl = {
		scrollTop: 900,
		getBoundingClientRect: () => ({
			top: 40,
			left: 120,
			width: 800,
			height: 600,
		}),
		querySelectorAll: () => [
			makeCard({
				indent: '0',
				text: 'A',
				rect: { top: 76, left: 140, width: 400, height: 40 },
			}),
			makeCard({
				indent: '0',
				text: 'B',
				rect: { top: 132, left: 140, width: 400, height: 40 },
				leaving: true,
			}),
		],
	};

	const snapshots = captureCardSnapshots(scrollEl, '.ioto-task-view__card');
	assert.equal(snapshots.length, 1);
	assert.equal(snapshots[0].key, '0\u0000A');
	assert.equal(snapshots[0].left, 20);
	assert.equal(snapshots[0].top, 936); // 76 - 40 + 900
	assert.equal(snapshots[0].width, 400);
	assert.equal(snapshots[0].height, 40);
});

/** 造一个卡片 stub（只实现 captureCardSnapshots 用到的接口）。 */
function makeCard({ indent, text, rect, leaving = false }) {
	return {
		getAttribute: (name) => {
			if (name === 'data-indent') return indent;
			if (name === 'data-task-key') return text;
			return null;
		},
		getBoundingClientRect: () => rect,
		classList: { contains: (cls) => leaving && cls === 'is-leaving' },
	};
}

/** 临时 stub activeDocument/window，返回 restore 函数（供「有 DOM 环境但不触布局」的分支）。 */
function stubDom() {
	const prevDoc = globalThis.activeDocument;
	const prevWin = globalThis.window;
	globalThis.activeDocument = {};
	globalThis.window = {
		setTimeout: () => 0,
		clearTimeout: () => {},
	};
	return () => {
		if (prevDoc === undefined) delete globalThis.activeDocument;
		else globalThis.activeDocument = prevDoc;
		if (prevWin === undefined) delete globalThis.window;
		else globalThis.window = prevWin;
	};
}

/* ------------------------------------------------------------------ *
 * prepare / play / cancel（[[Plan-20261005-152203]] §8.1）
 * ------------------------------------------------------------------ */

/** 造一个足以驱动 prepare/play 的卡片 / 浮层 stub（含 transform 感知的矩形）。 */
function makeEl({
	indent = '0',
	text = 'k',
	top = 0,
	left = 0,
	width = 100,
	height = 40,
	leaving = false,
} = {}) {
	const classes = new Set(leaving ? ['is-leaving'] : []);
	const props = {};
	const cssLog = [];
	const children = [];
	const el = {
		_props: props,
		_cssLog: cssLog,
		_classes: classes,
		_children: children,
		base: { top, left, width, height },
		removed: false,
		classList: {
			add: (...cs) => cs.forEach((c) => classes.add(c)),
			remove: (...cs) => cs.forEach((c) => classes.delete(c)),
			contains: (c) => classes.has(c),
		},
		setCssProps: (obj) => {
			Object.assign(props, obj);
			cssLog.push({ ...obj });
		},
		getAttribute: (n) =>
			n === 'data-indent' ? indent : n === 'data-task-key' ? text : null,
		getBoundingClientRect: () => ({
			top: el.base.top + translateYOf(props.transform),
			left: el.base.left,
			width: el.base.width,
			height: el.base.height,
		}),
		appendChild: (child) => {
			children.push(child);
		},
		remove: () => {
			el.removed = true;
		},
	};
	return el;
}

function translateYOf(transform) {
	if (typeof transform !== 'string') return 0;
	const m = /translateY\((-?\d+(?:\.\d+)?)px\)/.exec(transform);
	return m ? Number(m[1]) : 0;
}

/** 造一个滚动容器 stub（浮层定位上下文 + 内容坐标基准）。 */
function makeScroll({ top = 0, left = 0, scrollTop = 0 } = {}) {
	const classes = new Set();
	const children = [];
	return {
		scrollTop,
		_classes: classes,
		_children: children,
		classList: {
			add: (...cs) => cs.forEach((c) => classes.add(c)),
			remove: (...cs) => cs.forEach((c) => classes.delete(c)),
			contains: (c) => classes.has(c),
		},
		appendChild: (child) => {
			children.push(child);
		},
		getBoundingClientRect: () => ({ top, left, width: 800, height: 600 }),
	};
}

function snap(el, key, top) {
	return { el, key, left: 0, top, width: 100, height: 40 };
}

/** stub 出 activeDocument.createElement + window.setTimeout/clearTimeout。 */
function stubEnv() {
	const prevDoc = globalThis.activeDocument;
	const prevWin = globalThis.window;
	globalThis.activeDocument = {
		createElement: () => makeEl({ text: '', top: 0 }),
	};
	globalThis.window = {
		setTimeout: () => 1,
		clearTimeout: () => {},
	};
	return () => {
		if (prevDoc === undefined) delete globalThis.activeDocument;
		else globalThis.activeDocument = prevDoc;
		if (prevWin === undefined) delete globalThis.window;
		else globalThis.window = prevWin;
	};
}

test('prepare 门控：reduced-motion ⇒ null（不触 DOM）', () => {
	const restore = stubEnv();
	try {
		assert.equal(
			prepareSwapTransition({
				scrollEl: makeScroll(),
				oldSnapshots: [],
				newSnapshots: [],
				reducedMotion: true,
			}),
			null,
		);
	} finally {
		restore();
	}
});

test('prepare 门控：无进出 / 超出 K ⇒ null（有 DOM 环境）', () => {
	const restore = stubEnv();
	try {
		// 无进出：old [A] → new [A]
		assert.equal(
			prepareSwapTransition({
				scrollEl: makeScroll(),
				oldSnapshots: [snap(makeEl({ text: 'A' }), 'A', 0)],
				newSnapshots: [snap(makeEl({ text: 'A' }), 'A', 0)],
				reducedMotion: false,
			}),
			null,
		);

		// 超出 K=4：5 张全部退出
		const olds = ['A', 'B', 'C', 'D', 'E'].map((k, i) =>
			snap(makeEl({ text: k, top: i }), k, i),
		);
		assert.equal(
			prepareSwapTransition({
				scrollEl: makeScroll(),
				oldSnapshots: olds,
				newSnapshots: [],
				reducedMotion: false,
			}),
			null,
		);
	} finally {
		restore();
	}
});

test('prepare 只定格起点态（不强加目标态）；play 施加目标态（新增窗口）', () => {
	const restore = stubEnv();
	try {
		const scroll = makeScroll({ top: 0, scrollTop: 0 });
		const aOld = makeEl({ text: 'A', top: 0 });
		const bOld = makeEl({ text: 'B', top: 50 });
		const bNew = makeEl({ text: 'B', top: 0 });
		const cNew = makeEl({ text: 'C', top: 50 });

		const plan = prepareSwapTransition({
			scrollEl: scroll,
			oldSnapshots: [snap(aOld, 'A', 0), snap(bOld, 'B', 50)],
			newSnapshots: [snap(bNew, 'B', 0), snap(cNew, 'C', 50)],
			reducedMotion: false,
		});
		assert.ok(plan);

		// ① 退出卡进浮层 + 起点态（原位、不透明、不缩放）
		const layer = scroll._children[0];
		assert.ok(layer, '应建浮层');
		assert.ok(layer._children.includes(aOld), '退出卡应在浮层里');
		assert.ok(aOld._classes.has('is-leaving'));
		assert.equal(aOld._props.opacity, '1');
		assert.equal(aOld._props.transform, 'none');

		// ② 幸存卡 FLIP：反位移到旧位 translateY(旧-新) = +50
		assert.ok(bNew._classes.has('is-flipping'));
		assert.equal(bNew._props.transition, 'none');
		assert.equal(bNew._props.transform, 'translateY(50px)');

		// ③ 进入卡：shifts=[-50] → from-bottom → translateY(+10)、透明
		assert.ok(cNew._classes.has('is-entering'));
		assert.equal(cNew._props.opacity, '0');
		assert.equal(cNew._props.transform, 'translateY(10px)');

		// 起点态已定格、未起播（进入卡仍透明、幸存卡仍非零位移）
		assert.equal(cNew._props.opacity, '0');
		assert.notEqual(bNew._props.transform, '');
		// 动画期间抑制 hover（is-animating）
		assert.ok(scroll._classes.has('is-animating'));

		plan.play();

		// 退出卡：淡出 + 微缩（scale），opacity 时长 0.7×180=126ms
		assert.equal(aOld._props.opacity, '0');
		assert.equal(aOld._props.transform, 'scale(0.98)');
		assert.match(aOld._props.transition, /opacity 126ms/);
		assert.match(aOld._props.transition, /cubic-bezier\(0\.4, 0, 0\.2, 1\)/);

		// 幸存卡：归 0；flip 300ms + 强减速
		assert.equal(bNew._props.transform, 'translateY(0)');
		assert.match(bNew._props.transition, /transform 300ms/);
		assert.match(bNew._props.transition, /cubic-bezier\(0\.22, 1, 0\.36, 1\)/);

		// 进入卡：归位淡入；enter 240ms + delay 40ms，opacity 0.6×240=144ms
		assert.equal(cNew._props.opacity, '1');
		assert.equal(cNew._props.transform, 'translateY(0)');
		assert.match(cNew._props.transition, /opacity 144ms/);
		assert.match(cNew._props.transition, /240ms/);
		assert.match(cNew._props.transition, /40ms/);

		// cancel 幂等：清类 + 清 inline + 移除浮层 + 撤销 is-animating
		plan.cancel();
		plan.cancel();
		assert.ok(aOld.removed);
		assert.ok(layer.removed);
		assert.ok(!bNew._classes.has('is-flipping'));
		assert.ok(!cNew._classes.has('is-entering'));
		assert.equal(bNew._props.transform, '');
		assert.equal(cNew._props.transform, '');
		assert.ok(!scroll._classes.has('is-animating'));
	} finally {
		restore();
	}
});

test('play 前重采几何：吸收异步落字造成的位移漂移（§3.3）', () => {
	const restore = stubEnv();
	try {
		const scroll = makeScroll({ top: 0, scrollTop: 0 });
		const bOld = makeEl({ text: 'B', top: 50 });
		const bNew = makeEl({ text: 'B', top: 0 });

		const plan = prepareSwapTransition({
			scrollEl: scroll,
			oldSnapshots: [
				snap(makeEl({ text: 'A', top: 0 }), 'A', 0),
				snap(bOld, 'B', 50),
			],
			newSnapshots: [
				snap(bNew, 'B', 0),
				snap(makeEl({ text: 'C', top: 50 }), 'C', 50),
			],
			reducedMotion: false,
		});
		assert.ok(plan);
		assert.equal(bNew._props.transform, 'translateY(50px)'); // 起点反位移 = 旧-新 = +50
		bNew._cssLog.length = 0;

		// 模拟异步落字后新集布局整体下移 5px
		bNew.base.top += 5;

		plan.play();

		// 起点态被重采校正：desired = 旧位50 - currentTop55 + start50 = 45
		assert.ok(
			bNew._cssLog.some((p) => p.transform === 'translateY(45px)'),
			'应写入校正后的起点反位移',
		);
		// 校正后仍归 0 起播
		assert.equal(bNew._props.transform, 'translateY(0)');
		plan.cancel();
	} finally {
		restore();
	}
});

test('退出卡 slide 模式：微移方向 = 进入方向反号', () => {
	const restore = stubEnv();
	try {
		const scroll = makeScroll({ top: 0, scrollTop: 0 });
		// old [B,C] → new [A,B]：B 下移 ⇒ 方向 from-top
		const bOld = makeEl({ text: 'B', top: 0 });
		const cOld = makeEl({ text: 'C', top: 50 });
		const aNew = makeEl({ text: 'A', top: 0 });
		const bNew = makeEl({ text: 'B', top: 50 });

		const plan = prepareSwapTransition({
			scrollEl: scroll,
			oldSnapshots: [snap(bOld, 'B', 0), snap(cOld, 'C', 50)],
			newSnapshots: [snap(aNew, 'A', 0), snap(bNew, 'B', 50)],
			reducedMotion: false,
			leaveMode: 'slide',
		});
		assert.ok(plan);

		// 进入卡 A 自上方来：起点 translateY(-10)
		assert.match(aNew._cssLog[0].transform, /translateY\(-10px\)/);

		plan.play();
		// 退出卡 C 方向反号：translateY(+10)
		assert.equal(cOld._props.transform, 'translateY(10px)');
		plan.cancel();
	} finally {
		restore();
	}
});

test('runSwapTransition 薄封装：同步 prepare+play，返回幂等清理函数', () => {
	const restore = stubEnv();
	try {
		const scroll = makeScroll({ top: 0, scrollTop: 0 });
		const aOld = makeEl({ text: 'A', top: 0 });
		const bOld = makeEl({ text: 'B', top: 50 });
		const bNew = makeEl({ text: 'B', top: 0 });
		const cNew = makeEl({ text: 'C', top: 50 });

		const cleanup = runSwapTransition({
			scrollEl: scroll,
			oldSnapshots: [snap(aOld, 'A', 0), snap(bOld, 'B', 50)],
			newSnapshots: [snap(bNew, 'B', 0), snap(cNew, 'C', 50)],
			reducedMotion: false,
		});
		assert.equal(typeof cleanup, 'function');
		// 已同步起播（目标态已施加）
		assert.equal(cNew._props.opacity, '1');
		assert.equal(bNew._props.transform, 'translateY(0)');
		assert.ok(bNew._classes.has('is-flipping'));

		cleanup();
		cleanup();
		assert.ok(!bNew._classes.has('is-flipping'));
		assert.ok(!scroll._classes.has('is-animating'));
	} finally {
		restore();
	}
});
