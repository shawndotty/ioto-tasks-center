import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 批量 pin / repeat 纯逻辑单测（[[Plan-20261104-060428]] §6.1）。
// 零 obsidian / 零 DOM，jiti 直导源码。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildMultiControlEdit } = await jiti.import(
	'../src/tasks-center/note-task-multi-control.ts',
);

const CONTENT = [
	'# 任务',
	'- [ ] 甲',
	'- [ ] 乙',
	'- [ ] 丙',
	'',
	'散文',
	'- [ ] 丁',
].join('\n');

test('分散选中 3 行 + on:true：只改这 3 行，其余逐字节不变', () => {
	const result = buildMultiControlEdit(CONTENT, [3, 1, 6], 'pin', true);

	assert.ok(result);
	assert.deepEqual(result.changedLines, [1, 3, 6]);
	assert.deepEqual(result.edit.nextLines, [
		'- [ ] 甲 #ioto/pin',
		'- [ ] 乙',
		'- [ ] 丙 #ioto/pin',
		'',
		'散文',
		'- [ ] 丁 #ioto/pin',
	]);
	// 窗口 = [min, max]，窗口外（标题行）不进 edit
	assert.equal(result.edit.startLine, 1);
	assert.equal(result.edit.endLine, 6);
});

test('全部已是目标态：changedLines 为空（调用方可短路、不写盘）', () => {
	const content = '- [ ] 甲 #ioto/pin\n- [ ] 乙 #ioto/pin';
	const result = buildMultiControlEdit(content, [0, 1], 'pin', true);

	assert.ok(result);
	assert.deepEqual(result.changedLines, []);
	assert.deepEqual(result.edit.nextLines, content.split('\n'));
});

test('混合态：on:true 拉平为都固定，on:false 拉平为都剥离', () => {
	const content = '- [ ] 甲 #ioto/pin\n- [ ] 乙';

	const pinned = buildMultiControlEdit(content, [0, 1], 'pin', true);
	assert.deepEqual(pinned.changedLines, [1]);
	assert.deepEqual(pinned.edit.nextLines, [
		'- [ ] 甲 #ioto/pin',
		'- [ ] 乙 #ioto/pin',
	]);

	const unpinned = buildMultiControlEdit(content, [0, 1], 'pin', false);
	assert.deepEqual(unpinned.changedLines, [0]);
	assert.deepEqual(unpinned.edit.nextLines, ['- [ ] 甲', '- [ ] 乙']);
});

test('repeat 与 pin 同一口径，互不误伤', () => {
	const content = '- [ ] 甲 #ioto/pin\n- [ ] 乙';
	const result = buildMultiControlEdit(content, [0, 1], 'repeat', true);

	assert.deepEqual(result.changedLines, [0, 1]);
	assert.deepEqual(result.edit.nextLines, [
		'- [ ] 甲 #ioto/pin #ioto/repeat',
		'- [ ] 乙 #ioto/repeat',
	]);
});

test('集合里混入非任务行：该行原样保留、不计入 changedLines', () => {
	const content = '- [ ] 甲\n散文\n- [ ] 乙';
	const result = buildMultiControlEdit(content, [0, 1, 2], 'pin', true);

	assert.deepEqual(result.changedLines, [0, 2]);
	assert.deepEqual(result.edit.nextLines, [
		'- [ ] 甲 #ioto/pin',
		'散文',
		'- [ ] 乙 #ioto/pin',
	]);
});

test('空集合 / 越界 → null', () => {
	assert.equal(buildMultiControlEdit(CONTENT, [], 'pin', true), null);
	assert.equal(buildMultiControlEdit(CONTENT, [0, 99], 'pin', true), null);
	assert.equal(buildMultiControlEdit(CONTENT, [-1, 0], 'pin', true), null);
});

test('CRLF：窗口内 `\\r` 全部保留（除被剥离标签那一处）', () => {
	const content = '- [ ] 甲\r\n      续写\r\n- [ ] 乙\r\n';
	const result = buildMultiControlEdit(content, [0, 2], 'pin', true);

	assert.deepEqual(result.edit.nextLines, [
		'- [ ] 甲 #ioto/pin\r',
		'      续写\r',
		'- [ ] 乙 #ioto/pin\r',
	]);

	// 再加一次（幂等）→ 零改动
	const again = buildMultiControlEdit(
		result.edit.nextLines.join('\n'),
		[0, 2],
		'pin',
		true,
	);
	assert.deepEqual(again.changedLines, []);
});
