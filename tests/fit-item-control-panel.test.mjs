import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 只锁纯几何（[[Plan-20261003-165927]] §6.1）：面板高度已知后的
// 「下方优先 / 放不下翻上方 / 上下都放不下夹取 / 超高贴顶 / 水平夹取」。
// DOM 包装（fitItemControlPanel）的真机行为必须真机验证，见 §6.2。

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { computePanelPlacement } = await jiti.import(
	'../src/views/ioto-task/fit-item-control-panel.ts',
);

/** 所有必填项都给默认值，用例只覆盖关心的那几项。 */
function placement(overrides = {}) {
	return computePanelPlacement({
		anchorTop: 60,
		anchorBottom: 100,
		anchorLeft: 300,
		panelHeight: 200,
		panelWidth: 560,
		viewportHeight: 833,
		viewportWidth: 1481,
		...overrides,
	});
}

/* ------------------------------------------------------------------ *
 * 分支 1：下方放得下 → 与现状逐值一致
 * ------------------------------------------------------------------ */

test('下方放得下：top = anchorBottom + gap，flipped = false', () => {
	const r = placement({ anchorBottom: 100, panelHeight: 200, viewportHeight: 833 });
	assert.equal(r.top, 108); // 100 + 8
	assert.equal(r.flipped, false);
});

/* ------------------------------------------------------------------ *
 * 分支 2：下方放不下、上方放得下 → 翻转
 * ------------------------------------------------------------------ */

test('下方放不下 → 翻到卡片上方，flipped = true 且与卡片不重叠', () => {
	// 复刻 Research §五真机数值：末卡 top=717 / bottom=766，面板 h=362，窗口 833。
	const r = placement({
		anchorTop: 717,
		anchorBottom: 766,
		panelHeight: 362,
		viewportHeight: 833,
	});
	assert.equal(r.top, 347); // 717 - 8 - 362
	assert.equal(r.flipped, true);
	assert.ok(r.top + 362 <= 833 - 8); // 完整落在视口内
	assert.ok(r.top + 362 <= 717 - 8); // 且不压住卡片
});

/* ------------------------------------------------------------------ *
 * 分支 3：上下都放不下 → 夹到视口内
 * ------------------------------------------------------------------ */

test('上下都放不下 → 夹取（保证顶部可见），flipped = false', () => {
	const r = placement({
		anchorTop: 200,
		anchorBottom: 500,
		panelHeight: 362,
		viewportHeight: 833,
	});
	assert.equal(r.top, 463); // 833 - 8 - 362
	assert.equal(r.flipped, false);
	assert.equal(r.top + 362, 825); // vh - margin
});

/* ------------------------------------------------------------------ *
 * 分支 4：面板比视口还高 → 贴顶（配合内部滚动）
 * ------------------------------------------------------------------ */

test('面板超高（h > vh）→ top = margin，不返回负值', () => {
	const r = placement({
		anchorBottom: 100,
		panelHeight: 900,
		viewportHeight: 833,
	});
	assert.equal(r.top, 8);
	assert.equal(r.flipped, false);
});

/* ------------------------------------------------------------------ *
 * 水平夹取：复刻 ioto-settings 口径
 * ------------------------------------------------------------------ */

test('水平夹取：右侧越界 → vw - w - edgeGap；左侧越界 → margin；常规 → anchorLeft', () => {
	assert.equal(
		placement({ anchorLeft: 2000, panelWidth: 560, viewportWidth: 1481 }).left,
		905, // 1481 - 560 - 16
	);
	assert.equal(
		placement({ anchorLeft: 2, panelWidth: 560, viewportWidth: 1481 }).left,
		8,
	);
	assert.equal(
		placement({ anchorLeft: 300, panelWidth: 560, viewportWidth: 1481 }).left,
		300,
	);
});

test('水平夹取：面板比视口还宽时退到 margin，不返回负值', () => {
	const r = placement({ anchorLeft: 300, panelWidth: 2000, viewportWidth: 1481 });
	assert.equal(r.left, 8);
});

/* ------------------------------------------------------------------ *
 * 缺省参数与恒等 / 边界
 * ------------------------------------------------------------------ */

test('缺省 margin / gap / edgeGap 等价于 8 / 8 / 16', () => {
	const base = {
		anchorTop: 60,
		anchorBottom: 100,
		anchorLeft: 2000,
		panelHeight: 200,
		panelWidth: 560,
		viewportHeight: 833,
		viewportWidth: 1481,
	};
	const withDefaults = computePanelPlacement({ ...base });
	const explicit = computePanelPlacement({
		...base,
		margin: 8,
		gap: 8,
		edgeGap: 16,
	});
	assert.deepEqual(withDefaults, explicit);
	assert.equal(withDefaults.top, 108); // gap = 8
	assert.equal(withDefaults.left, 905); // edgeGap = 16
});

test('边界：vh 极小不返回负值、不抛错；同输入两次结果相等（幂等）', () => {
	const input = {
		anchorTop: 5,
		anchorBottom: 10,
		anchorLeft: 5,
		panelHeight: 362,
		panelWidth: 560,
		viewportHeight: 20,
		viewportWidth: 100,
	};
	const a = computePanelPlacement(input);
	const b = computePanelPlacement(input);
	assert.deepEqual(a, b);
	assert.ok(a.top >= 0);
	assert.ok(a.left >= 0);
	assert.equal(a.top, 8); // max(margin, 20 - 8 - 362) → 8
});
