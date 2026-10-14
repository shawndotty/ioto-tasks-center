import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 「同级任务互换」纯逻辑单测（[[Plan-20261014-194115]] §6）。
// 零 obsidian / 零 DOM，jiti 直导源码（范式同 commit-block-range.test.mjs）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { taskBlockRange, findSiblingTarget, computeSwapRange } =
	await jiti.import('../src/tasks-center/note-task-swap.ts');

/** 便捷构造：`[line, indentLevel]` 数组 → 条目对象数组（只需这两个字段）。 */
function items(pairs) {
	return pairs.map(([line, indentLevel]) => ({ line, indentLevel }));
}

/* ------------------------------------------------------------------ *
 * findSiblingTarget：同 indentLevel + 同父级 + 同 Section
 * ------------------------------------------------------------------ */

test('基本同级：上 / 下兄弟命中', () => {
	const list = items([
		[0, 0],
		[1, 0],
		[2, 0],
	]);
	assert.equal(findSiblingTarget(list, 1, 'next'), 2);
	assert.equal(findSiblingTarget(list, 1, 'prev'), 0);
});

test('跨级：更深子树夹在中间时仍命中真正的同级兄弟', () => {
	const list = items([
		[0, 0],
		[1, 1],
		[2, 2],
		[3, 1],
		[4, 0],
	]);
	assert.equal(findSiblingTarget(list, 0, 'next'), 4);
	assert.equal(findSiblingTarget(list, 4, 'prev'), 0);
});

test('跨父级：不同父级下的同级子任务不互为兄弟', () => {
	// 父A / 子A1 / 父B / 子B1
	const list = items([
		[0, 0],
		[1, 1],
		[2, 0],
		[3, 1],
	]);
	assert.equal(findSiblingTarget(list, 1, 'next'), null); // 往后先遇 父B(0) < 1
	assert.equal(findSiblingTarget(list, 1, 'prev'), null); // 往前先遇 父A(0) < 1
	assert.equal(findSiblingTarget(list, 3, 'prev'), null); // 子B1 往前先遇 父B(0) < 1
	assert.equal(findSiblingTarget(list, 0, 'next'), 2); // 父A ↔ 父B 同级
});

test('越父级：更深的子任务往前扫不会命中更浅的父级', () => {
	const list = items([
		[0, 0],
		[1, 1],
		[2, 1],
		[3, 0],
	]);
	assert.equal(findSiblingTarget(list, 1, 'prev'), null);
	assert.equal(findSiblingTarget(list, 2, 'prev'), 1);
	assert.equal(findSiblingTarget(list, 1, 'next'), 2);
});

test('首 / 末条：返回 null', () => {
	const list = items([
		[0, 0],
		[1, 0],
		[2, 0],
	]);
	assert.equal(findSiblingTarget(list, 0, 'prev'), null);
	assert.equal(findSiblingTarget(list, 2, 'next'), null);
});

test('前导孤儿缩进项（块首即 >0）作为兜底边界', () => {
	const list = items([
		[0, 1],
		[1, 1],
		[2, 1],
	]);
	assert.equal(findSiblingTarget(list, 0, 'prev'), null);
	assert.equal(findSiblingTarget(list, 1, 'prev'), 0);
	assert.equal(findSiblingTarget(list, 1, 'next'), 2);
});

test('行不在条目里：返回 null', () => {
	const list = items([
		[0, 0],
		[1, 0],
	]);
	assert.equal(findSiblingTarget(list, 9, 'next'), null);
	assert.equal(findSiblingTarget(list, 9, 'prev'), null);
});

/* ------------------------------------------------------------------ *
 * taskBlockRange：任务行 + 续写区 + 整棵子树
 * ------------------------------------------------------------------ */

test('纯任务行：区间即单行', () => {
	const lines = ['- [ ] A', '- [ ] B'];
	assert.deepEqual(taskBlockRange(items([[0, 0], [1, 0]]), lines, 0), {
		start: 0,
		end: 0,
	});
});

test('带续写区：吞掉其后连续续行', () => {
	const lines = ['- [ ] A', '  续写一', '  续写二', '- [ ] B'];
	const list = items([
		[0, 0],
		[3, 0],
	]);
	assert.deepEqual(taskBlockRange(list, lines, 0), { start: 0, end: 2 });
});

test('带整棵子树：子 / 孙多级 + 末节点续行一并吞下', () => {
	const lines = [
		'- [ ] A',
		'  - [ ] A1',
		'    - [ ] A1a',
		'      续行',
		'- [ ] B',
	];
	const list = items([
		[0, 0],
		[1, 1],
		[2, 2],
		[4, 0],
	]);
	assert.deepEqual(taskBlockRange(list, lines, 0), { start: 0, end: 3 });
	assert.deepEqual(taskBlockRange(list, lines, 3), { start: 4, end: 4 });
});

test('空行终止续写区：不吞后续正文', () => {
	const lines = ['- [ ] A', '', '段落', '- [ ] B'];
	const list = items([
		[0, 0],
		[3, 0],
	]);
	assert.deepEqual(taskBlockRange(list, lines, 0), { start: 0, end: 0 });
});

/* ------------------------------------------------------------------ *
 * computeSwapRange：A（上）/ B（下）归一化重排
 * ------------------------------------------------------------------ */

test('两块相邻、无中间行：整块对调 + 新行号正确', () => {
	const lines = ['- [ ] A', '- [ ] B'];
	const list = items([
		[0, 0],
		[1, 0],
	]);
	const range = computeSwapRange(lines, list, 0, 1);
	assert.deepEqual(range.originalLines, ['- [ ] A', '- [ ] B']);
	assert.deepEqual(range.nextLines, ['- [ ] B', '- [ ] A']);
	assert.equal(range.start, 0);
	assert.equal(range.end, 1);
	assert.equal(range.aNewLine, 1); // A 交换后落到第 2 行
	assert.equal(range.bNewLine, 0); // B 交换后落到第 1 行
});

test('中间夹非任务正文行：两块对调、中间行原位不动', () => {
	const lines = ['- [ ] A', '', '中间段落', '', '- [ ] B'];
	const list = items([
		[0, 0],
		[4, 0],
	]);
	const range = computeSwapRange(lines, list, 0, 4);
	assert.deepEqual(
		range.nextLines,
		['- [ ] B', '', '中间段落', '', '- [ ] A'],
	);
	assert.equal(range.start, 0);
	assert.equal(range.end, 4);
	assert.equal(range.aNewLine, 4); // highBlock(1) + middle(3) = 4
	assert.equal(range.bNewLine, 0);
});

test('lazy continuation：紧随任务行的正文行随块搬移（属续写区，不是中间行）', () => {
	const lines = ['- [ ] A', '紧跟的正文', '- [ ] B'];
	const list = items([
		[0, 0],
		[2, 0],
	]);
	const range = computeSwapRange(lines, list, 0, 2);
	assert.deepEqual(
		range.nextLines,
		['- [ ] B', '- [ ] A', '紧跟的正文'],
	);
});

test('带续写区 + 带子树：组内逐字节不变地整体搬移', () => {
	const lines = [
		'- [ ] A',
		'  续A',
		'- [ ] B',
		'  - [ ] B1',
		'    续B1',
	];
	const list = items([
		[0, 0],
		[2, 0],
		[3, 1],
	]);
	const range = computeSwapRange(lines, list, 0, 2);
	assert.deepEqual(range.nextLines, [
		'- [ ] B',
		'  - [ ] B1',
		'    续B1',
		'- [ ] A',
		'  续A',
	]);
	assert.equal(range.aNewLine, 3); // A 块（1 行续写 + 1 行任务）落到 B 原位置后
	assert.equal(range.bNewLine, 0);
});

test('反向入参（lineA > lineB）同样归一化', () => {
	const lines = ['- [ ] A', '- [ ] B'];
	const list = items([
		[0, 0],
		[1, 0],
	]);
	const forward = computeSwapRange(lines, list, 0, 1);
	const reversed = computeSwapRange(lines, list, 1, 0);
	assert.deepEqual(reversed, forward);
});

test('行不在条目里 → null', () => {
	const lines = ['- [ ] A', '- [ ] B'];
	const list = items([
		[0, 0],
		[1, 0],
	]);
	assert.equal(computeSwapRange(lines, list, 0, 5), null);
	assert.equal(computeSwapRange(lines, list, 5, 0), null);
});

test('两块重叠（父子） → null', () => {
	const lines = ['- [ ] A', '  - [ ] A1'];
	const list = items([
		[0, 0],
		[1, 1],
	]);
	assert.equal(computeSwapRange(lines, list, 0, 1), null);
	assert.equal(computeSwapRange(lines, list, 1, 0), null);
});

test('CRLF：\\r 随行保留，切片不吞 \\r', () => {
	const lines = ['- [ ] A\r', '- [ ] B\r'];
	const list = items([
		[0, 0],
		[1, 0],
	]);
	const range = computeSwapRange(lines, list, 0, 1);
	assert.deepEqual(range.nextLines, ['- [ ] B\r', '- [ ] A\r']);
	assert.ok(range.nextLines.join('\n').includes('\r\n'));
});
