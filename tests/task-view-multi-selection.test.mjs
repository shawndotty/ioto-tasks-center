import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	collapseMulti,
	pruneMembers,
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
