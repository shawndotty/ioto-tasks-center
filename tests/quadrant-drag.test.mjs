import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 优先级四象限拖拽纯逻辑单测（[[Plan-20261116-112945]] §7.1）。
// 模块零 obsidian 运行时依赖，照 `quadrant-model.test.mjs` 的 jiti 直载范式。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	isSameQuadrantDrop,
	priorityForQuadrantDrop,
	resolveQuadrantDragIntent,
} = await jiti.import('../src/tasks-center/quadrant-drag.ts');

test('priorityForQuadrantDrop 把 p0~p3 映射为 0~3', () => {
	assert.equal(priorityForQuadrantDrop('p0'), 0);
	assert.equal(priorityForQuadrantDrop('p1'), 1);
	assert.equal(priorityForQuadrantDrop('p2'), 2);
	assert.equal(priorityForQuadrantDrop('p3'), 3);
});

test('priorityForQuadrantDrop 对 unlabeled 返回 undefined（删除 Priority）', () => {
	assert.equal(priorityForQuadrantDrop('unlabeled'), undefined);
});

test('isSameQuadrantDrop 仅同桶为 true', () => {
	assert.equal(isSameQuadrantDrop('p1', 'p1'), true);
	assert.equal(isSameQuadrantDrop('unlabeled', 'unlabeled'), true);
	assert.equal(isSameQuadrantDrop('p1', 'p2'), false);
	assert.equal(isSameQuadrantDrop(undefined, 'p1'), false);
});

test('鼠标位移未到阈值保持 pending，超过阈值进入 drag', () => {
	assert.equal(
		resolveQuadrantDragIntent({
			pointerType: 'mouse',
			longPressFired: false,
			dragStarted: false,
			distance: 3,
		}),
		'pending',
	);
	assert.equal(
		resolveQuadrantDragIntent({
			pointerType: 'mouse',
			longPressFired: false,
			dragStarted: false,
			distance: 9,
		}),
		'drag',
	);
});

test('触屏未长按就滑动 → scroll-abort（交还原生滚动）', () => {
	assert.equal(
		resolveQuadrantDragIntent({
			pointerType: 'touch',
			longPressFired: false,
			dragStarted: false,
			distance: 9,
		}),
		'scroll-abort',
	);
});

test('触屏已长按：未移动够仍 pending，移动够才 drag', () => {
	assert.equal(
		resolveQuadrantDragIntent({
			pointerType: 'touch',
			longPressFired: true,
			dragStarted: false,
			distance: 3,
		}),
		'pending',
	);
	assert.equal(
		resolveQuadrantDragIntent({
			pointerType: 'touch',
			longPressFired: true,
			dragStarted: false,
			distance: 9,
		}),
		'drag',
	);
});

test('dragStarted 为 true 时恒为 drag', () => {
	assert.equal(
		resolveQuadrantDragIntent({
			pointerType: 'touch',
			longPressFired: false,
			dragStarted: true,
			distance: 0,
		}),
		'drag',
	);
});

test('moveThreshold 可覆盖默认 8', () => {
	assert.equal(
		resolveQuadrantDragIntent({
			pointerType: 'mouse',
			longPressFired: false,
			dragStarted: false,
			distance: 5,
			moveThreshold: 4,
		}),
		'drag',
	);
});
