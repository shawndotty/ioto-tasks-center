import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { marqueeHits } = await jiti.import(
	'../src/views/ioto-task/task-view-marquee.ts',
);

/** 卡片矩形（内容坐标）：`line` + 轴对齐盒。 */
function rect(line, left, top, width = 200, height = 24) {
	return {
		line,
		left,
		top,
		right: left + width,
		bottom: top + height,
	};
}

const CARDS = [
	rect(10, 0, 0),
	rect(20, 0, 30),
	rect(30, 0, 60),
	rect(40, 0, 90),
];

test('1 部分相交：框住下半截也算选中', () => {
	const hits = marqueeHits(CARDS, { left: 0, top: 20, right: 100, bottom: 40 });
	assert.deepEqual(hits, [10, 20]);
});

test('2 完全包含：整张卡被框住', () => {
	const hits = marqueeHits(CARDS, {
		left: -100,
		top: -100,
		right: 1000,
		bottom: 1000,
	});
	assert.deepEqual(hits, [10, 20, 30, 40]);
});

test('3 只碰边：不算选中（相交判据为严格不等式）', () => {
	// 卡的底边 24 与框顶 24 恰好相接
	assert.deepEqual(
		marqueeHits(CARDS, { left: 0, top: 24, right: 100, bottom: 54 }),
		[20],
	);
	// 框右边 200 与卡左边 200 相接 → 不相交
	const right = [rect(50, 200, 0)];
	assert.deepEqual(
		marqueeHits(right, { left: 0, top: 0, right: 200, bottom: 24 }),
		[],
	);
});

test('4 不相交：框在卡片之外', () => {
	assert.deepEqual(
		marqueeHits(CARDS, { left: 500, top: 500, right: 600, bottom: 600 }),
		[],
	);
});

test('5 零面积矩形跳过（隐藏 / 未布局的卡不入表）', () => {
	const rects = [rect(10, 0, 0, 0, 0), rect(20, 0, 30), rect(30, 0, 60, 0, 24)];
	const hits = marqueeHits(rects, {
		left: -10,
		top: -10,
		right: 500,
		bottom: 500,
	});
	assert.deepEqual(hits, [20]);
});

test('6 多卡顺序：按入参（DOM）顺序返回，不按行号排序', () => {
	const reversed = [rect(40, 0, 90), rect(10, 0, 0), rect(30, 0, 60)];
	const hits = marqueeHits(reversed, {
		left: -10,
		top: -10,
		right: 500,
		bottom: 500,
	});
	assert.deepEqual(hits, [40, 10, 30]);
});

test('7 空框 / 反向拖（left > right）：左右上下归一后判定，零面积框返回空', () => {
	// 零面积框（只点了一下）
	assert.deepEqual(
		marqueeHits(CARDS, { left: 10, top: 10, right: 10, bottom: 10 }),
		[],
	);
	// 反向拖：归一后与正向框等价
	assert.deepEqual(
		marqueeHits(CARDS, { left: 100, top: 40, right: 0, bottom: 20 }),
		[10, 20],
	);
});
