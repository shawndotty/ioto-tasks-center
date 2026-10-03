import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	collectCardLines,
	pickAdjacentLine,
	pickLineAfterDelete,
} = await jiti.import('../src/views/ioto-task/card-navigation.ts');

function makeCard(line) {
	return {
		getAttribute: (name) => (name === 'data-line' ? String(line) : null),
	};
}

test('collectCardLines：按 DOM 顺序读 data-line', () => {
	const cards = [makeCard(3), makeCard(7), makeCard(11)];
	const root = { querySelectorAll: () => cards };
	assert.deepEqual(collectCardLines(root), [3, 7, 11]);
});

test('collectCardLines：解析失败的卡片被跳过，不影响其余顺序', () => {
	const root = {
		querySelectorAll: () => [
			makeCard(3),
			{ getAttribute: () => null },
			{ getAttribute: () => 'abc' },
			makeCard(9),
		],
	};
	assert.deepEqual(collectCardLines(root), [3, 9]);
});

test('collectCardLines：无容器 / 无卡片 / 无 querySelectorAll 时返回空数组', () => {
	assert.deepEqual(collectCardLines(null), []);
	assert.deepEqual(collectCardLines(undefined), []);
	assert.deepEqual(collectCardLines({}), []);
	assert.deepEqual(collectCardLines({ querySelectorAll: () => null }), []);
	assert.deepEqual(collectCardLines({ querySelectorAll: () => [] }), []);
});

test('pickAdjacentLine：向下 / 向上取相邻卡片', () => {
	const order = [3, 7, 11];
	assert.equal(pickAdjacentLine(order, 3, 1), 7);
	assert.equal(pickAdjacentLine(order, 7, 1), 11);
	assert.equal(pickAdjacentLine(order, 11, -1), 7);
	assert.equal(pickAdjacentLine(order, 7, -1), 3);
});

test('pickAdjacentLine：首尾不循环，停在边界', () => {
	const order = [3, 7, 11];
	assert.equal(pickAdjacentLine(order, 3, -1), null);
	assert.equal(pickAdjacentLine(order, 11, 1), null);
});

test('pickAdjacentLine：current 不在列表里返回 null', () => {
	assert.equal(pickAdjacentLine([3, 7], 99, 1), null);
	assert.equal(pickAdjacentLine([], 3, 1), null);
});

test('pickLineAfterDelete：中间项落到原位置的下一张（行号已前移 1）', () => {
	// 删掉 9 后 [7,8,9,13,14]：原「下一张」是 10，删除后它前移到 9
	assert.equal(pickLineAfterDelete([7, 8, 9, 10, 14, 15], 9), 9);
});

test('pickLineAfterDelete：末位退回上一张（行号不变）', () => {
	// 15 在删除点之前，取 14；14 不会被前移
	assert.equal(pickLineAfterDelete([7, 8, 9, 10, 14, 15], 15), 14);
});

test('pickLineAfterDelete：首位取原来的第二张（行号已前移 1）', () => {
	assert.equal(pickLineAfterDelete([7, 8, 9, 10], 7), 7);
});

test('pickLineAfterDelete：只删一张时选中清空', () => {
	assert.equal(pickLineAfterDelete([5], 5), null);
});

test('pickLineAfterDelete：current 不在列表里返回 null', () => {
	assert.equal(pickLineAfterDelete([3, 7], 99), null);
});

test('pickLineAfterDelete：返回的行号一定落在删除后的集合里', () => {
	// 回归：曾返回删除前的行号，导致选中态丢光（选中一张不存在的卡）。
	// 删除一行会让**其后所有行**整体前移 1（不是把该行从集合里抹掉），
	// 所以「删除后的行号集合」= 之前的行号原样 + 之后的行号 −1。
	const lines = [7, 8, 9, 10, 14, 15];
	for (const current of lines) {
		const after = [
			...lines.filter((l) => l < current),
			...lines.filter((l) => l > current).map((l) => l - 1),
		];
		const picked = pickLineAfterDelete(lines, current);
		assert.ok(
			picked === null || after.includes(picked),
			`删除 ${current} 后选中 ${picked}，但删除后的行号集合是 ${JSON.stringify(after)}`,
		);
	}
});
