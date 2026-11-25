import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

/**
 * 润色进行中状态（[[Plan-20261125-212649]] §3.4）。
 *
 * 状态条能否「自动自愈」全靠这张命中判定表；模块本身零 DOM，用普通对象桩即可。
 */
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	setPolishRunning,
	refinePolishTaskKey,
	clearPolishRunning,
	clearAllPolishRunning,
	getPolishTaskKey,
	isPolishRunningFor,
} = await jiti.import('../src/views/ioto-task/task-polish-status.ts');

function host() {
	return { polishPending: new Map() };
}

test('无记录时不命中', () => {
	const h = host();
	assert.equal(isPolishRunningFor(h, 3, '任意正文'), false);
	assert.equal(getPolishTaskKey(h, 3), undefined);
});

test('记录为 null 时按行命中（flush 前窗口）', () => {
	const h = host();
	setPolishRunning(h, 3, null);
	assert.equal(isPolishRunningFor(h, 3, '旧正文'), true);
	assert.equal(isPolishRunningFor(h, 3, '新正文'), true);
});

test('记录具体键时仅同键命中', () => {
	const h = host();
	setPolishRunning(h, 3, '原文');
	assert.equal(isPolishRunningFor(h, 3, '原文'), true);
	assert.equal(isPolishRunningFor(h, 3, '被改过的正文'), false);
});

test('两行并发互不影响', () => {
	const h = host();
	setPolishRunning(h, 3, 'A');
	setPolishRunning(h, 8, null);
	assert.equal(isPolishRunningFor(h, 3, 'A'), true);
	assert.equal(isPolishRunningFor(h, 8, 'B'), true);
	assert.equal(isPolishRunningFor(h, 5, 'A'), false);
});

test('refine 不复活已清理的记录', () => {
	const h = host();
	setPolishRunning(h, 3, null);
	clearPolishRunning(h, 3);
	refinePolishTaskKey(h, 3, '原文');
	assert.equal(getPolishTaskKey(h, 3), undefined);
	assert.equal(isPolishRunningFor(h, 3, '原文'), false);
});

test('refine 覆盖旧指纹，clear 幂等', () => {
	const h = host();
	setPolishRunning(h, 3, null);
	refinePolishTaskKey(h, 3, '原文');
	assert.equal(getPolishTaskKey(h, 3), '原文');
	clearPolishRunning(h, 3);
	clearPolishRunning(h, 3);
	assert.equal(h.polishPending.size, 0);
});

test('clearAll 清空全部记录', () => {
	const h = host();
	setPolishRunning(h, 1, 'A');
	setPolishRunning(h, 2, null);
	clearAllPolishRunning(h);
	assert.equal(h.polishPending.size, 0);
	assert.equal(isPolishRunningFor(h, 1, 'A'), false);
});