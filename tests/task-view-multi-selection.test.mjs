import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	collapseMulti,
	extendMultiTo,
	mapMultiState,
	pruneMembers,
	rangeBetween,
	remapMultiFields,
	resolveMultiMembers,
	toggleMultiMember,
} = await jiti.import(
	'../src/views/ioto-task/task-view-multi-selection.ts',
);

/** 构造多选态：`anchor` + 成员（顺序即 DOM 顺序）。 */
function state(anchor, members = []) {
	return { anchor, members };
}

/** DOM 顺序（可见卡行号，升序即 DOM 顺序）。 */
const ORDER = [10, 20, 30, 40, 50];

test('1 无锚点时 ⌘+点击：该卡成为锚点，集合为空（等价单选）', () => {
	assert.deepEqual(toggleMultiMember(state(null), 20, ORDER), state(20, []));
});

test('2 单选时 ⌘+点击另一张：旧锚点转入集合，新卡成为锚点', () => {
	assert.deepEqual(
		toggleMultiMember(state(10), 30, ORDER),
		state(30, [10]),
	);
});

test('3 多选时 ⌘+点击集合内成员：从集合移除，锚点不变', () => {
	assert.deepEqual(
		toggleMultiMember(state(30, [10, 20]), 10, ORDER),
		state(30, [20]),
	);
	// 移除最后一个成员 → 回到纯单选
	assert.deepEqual(
		toggleMultiMember(state(30, [20]), 20, ORDER),
		state(30, []),
	);
});

test('4 多选时 ⌘+点击锚点本身：锚点顺延到 DOM 顺序第一个成员', () => {
	assert.deepEqual(
		toggleMultiMember(state(10, [20, 30, 40]), 10, ORDER),
		state(20, [30, 40]),
	);
});

test('5 单选时 ⌘+点击锚点：no-op（不允许清成 0 选中）', () => {
	const before = state(10);
	assert.equal(toggleMultiMember(before, 10, ORDER), before);
});

test('6 旧锚点转入集合后按 DOM 顺序排列（点在第一个成员之前）', () => {
	// 锚点 40，成员 [50]；⌘+点 10 → 10 成锚点，成员应为 [40, 50]（DOM 顺序）
	assert.deepEqual(
		toggleMultiMember(state(40, [50]), 10, ORDER),
		state(10, [40, 50]),
	);
});

test('7 加入成员时保持 DOM 顺序（点在中间）', () => {
	// 锚点 20，成员 [50]；⌘+点 40 → 锚点 40，成员 [20, 50]
	assert.deepEqual(
		toggleMultiMember(state(20, [50]), 40, ORDER),
		state(40, [20, 50]),
	);
});

test('8 resolveMultiMembers：锚点在集合外（锚点已漂走）→ 收窄为空', () => {
	assert.deepEqual(resolveMultiMembers(99, 10, new Set([20, 30])), []);
	assert.deepEqual(resolveMultiMembers(null, 10, new Set([20, 30])), []);
	assert.deepEqual(resolveMultiMembers(10, null, new Set([20, 30])), []);
});

test('9 resolveMultiMembers：锚点一致 → 返回成员（剔除混进集合的锚点）', () => {
	assert.deepEqual(resolveMultiMembers(10, 10, new Set([20, 30])), [20, 30]);
	assert.deepEqual(resolveMultiMembers(10, 10, new Set([10, 20])), [20]);
	assert.deepEqual(resolveMultiMembers(10, 10, new Set()), []);
});

test('10 pruneMembers：隐藏成员被清掉，锚点保留', () => {
	assert.deepEqual(
		pruneMembers(state(10, [20, 40, 50]), [10, 20, 40]),
		state(10, [20, 40]),
	);
	// 无变化时返回同一引用（避免无意义 commit）
	const before = state(10, [20]);
	assert.equal(pruneMembers(before, [10, 20]), before);
});

test('11 collapseMulti：收窄为锚点单选（已单选则原样返回）', () => {
	assert.deepEqual(collapseMulti(state(10, [20, 30])), state(10, []));
	const single = state(10);
	assert.equal(collapseMulti(single), single);
	// 无锚点时同样安全
	assert.deepEqual(collapseMulti(state(null, [20])), state(null, []));
});

test('12 空集合 / 单成员锚点顺延退化：顺延后无成员即纯单选', () => {
	assert.deepEqual(toggleMultiMember(state(10, [20]), 10, ORDER), state(20, []));
	// 成员不在可见顺序里也不崩（排到最后）
	assert.deepEqual(
		toggleMultiMember(state(10), 999, ORDER),
		state(999, [10]),
	);
});

test('13 mapMultiState / remapMultiFields：锚点与成员各自按映射位移', () => {
	const shift = (line) => line + 2;
	assert.deepEqual(
		mapMultiState(state(10, [20, 30]), shift),
		state(12, [22, 32]),
	);

	// 视图侧：只写 multiAnchor / multiLines，不碰 selectedLine
	const view = { selectedLine: 10, multiAnchor: 10, multiLines: new Set([20, 30]) };
	remapMultiFields(view, shift);
	assert.equal(view.selectedLine, 10);
	assert.equal(view.multiAnchor, 12);
	assert.deepEqual([...view.multiLines], [22, 32]);
});

test('14 mapMultiState：成员映射为 null → 丢弃；锚点为 null → 整组作废', () => {
	const dropOdd = (line) => (line % 20 === 0 ? line : null);
	assert.deepEqual(mapMultiState(state(20, [30, 40]), dropOdd), state(20, [40]));
	// 锚点没了 → 整组作废（连成员一起清）
	assert.deepEqual(
		mapMultiState(state(30, [40]), dropOdd),
		{ anchor: null, members: [] },
	);
});

test('15 空态幂等：无锚点 / 无成员时映射不改写任何字段', () => {
	const identity = (line) => line;
	assert.deepEqual(mapMultiState(state(null), identity), state(null));

	// 视图侧：全空时不写字段（避免把 0 条写入记到白名单上）
	const view = { selectedLine: null, multiAnchor: null, multiLines: new Set() };
	remapMultiFields(view, identity);
	assert.equal(view.multiAnchor, null);
	assert.equal(view.multiLines.size, 0);
});

/* ------------------------------------------------------------------ *
 * 16–25：Shift+点击连选（[[Plan-20261101-073024]] §四.步骤 1 / §四.6a）
 * ------------------------------------------------------------------ */

test('16 rangeBetween 正向：10→40 得到闭区间', () => {
	assert.deepEqual(rangeBetween(ORDER, 10, 40), [10, 20, 30, 40]);
});

test('17 rangeBetween 反向：40→10 得到同一序列（DOM 顺序，不反排）', () => {
	assert.deepEqual(rangeBetween(ORDER, 40, 10), [10, 20, 30, 40]);
});

test('18 rangeBetween 同点：30→30 只含它自己', () => {
	assert.deepEqual(rangeBetween(ORDER, 30, 30), [30]);
});

test('19 rangeBetween 端点不可见：任一端点不在 order 里 → null', () => {
	assert.equal(rangeBetween(ORDER, 10, 999), null);
	assert.equal(rangeBetween(ORDER, 999, 10), null);
	assert.equal(rangeBetween(ORDER, 999, 888), null);
});

test('20 extendMultiTo 无锚点：Shift+点哪张，哪张成为锚点且集合为空', () => {
	assert.deepEqual(extendMultiTo(state(null), 30, ORDER), state(30, []));
});

test('21 extendMultiTo 正向：锚点 10 + Shift 点 40 → 成员 20/30/40', () => {
	assert.deepEqual(
		extendMultiTo(state(10), 40, ORDER),
		state(10, [20, 30, 40]),
	);
});

test('22 extendMultiTo 反向：锚点 40 + Shift 点 10 → 成员 10/20/30（锚点仍是 40）', () => {
	assert.deepEqual(
		extendMultiTo(state(40), 10, ORDER),
		state(40, [10, 20, 30]),
	);
});

test('23 extendMultiTo 是「替换」而不是「并集」：⌘ 散点被区间整体覆盖', () => {
	// 原态：锚点 10 + 远端散点 50；Shift 点 20 → 只剩区间内的 20，50 被丢掉
	assert.deepEqual(
		extendMultiTo(state(10, [50]), 20, ORDER),
		state(10, [20]),
	);
});

test('24 extendMultiTo 点锚点本身：区间退化 → 收窄为单选', () => {
	assert.deepEqual(
		extendMultiTo(state(30, [10, 20, 40]), 30, ORDER),
		state(30, []),
	);
});

test('25 extendMultiTo 端点不可见 → null（含「锚点被过滤掉」的场景）', () => {
	// 目标卡不在可见顺序里
	assert.equal(extendMultiTo(state(10), 999, ORDER), null);
	// 锚点被过滤隐藏：锚点不在 order 里，同样不可连选（调用方落回普通点选）
	assert.equal(extendMultiTo(state(999, [20]), 30, ORDER), null);
});
