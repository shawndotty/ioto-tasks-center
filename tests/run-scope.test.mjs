import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

/**
 * 运行范围开放契约的纯函数（Plan-20261029-184123 §S7）。
 *
 * 视图 getter 自身（`zoomLine → lineAt` 的接线）按本插件既定分层走真机；
 * 这里只锁「什么情况下声明范围 / 什么情况下拒绝声明」。
 */
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildRunScope } = await jiti.import(
	'../src/views/ioto-task/task-view-run-scope.ts',
);

const file = { path: '3-任务/IOTO Task Center/x.md' };

test('放大（zoomLine 为 0-based 行号）→ 原样声明范围', () => {
	assert.deepEqual(buildRunScope(7, file, '- [ ] 放大这条'), {
		file,
		line: 7,
		text: '- [ ] 放大这条',
	});
	// 行号 0 是合法值，不能被 truthy 判据吃掉
	assert.equal(buildRunScope(0, file, '- [ ] 第 1 行')?.line, 0);
});

test('未放大（zoomLine = null）→ null', () => {
	assert.equal(buildRunScope(null, file, '- [ ] x'), null);
});

test('行号非法（负数）→ null', () => {
	assert.equal(buildRunScope(-1, file, '- [ ] x'), null);
});

test('行已失效（lineText 为空 / 空串）→ null（保守：宁可整份，不跑错条）', () => {
	assert.equal(buildRunScope(3, file, null), null);
	assert.equal(buildRunScope(3, file, ''), null);
});

test('无 file → null', () => {
	assert.equal(buildRunScope(3, null, '- [ ] x'), null);
});
