import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 批量「标记为完成」纯逻辑单测（[[Plan-20261104-063936]] §6.1）。
// 零 obsidian / 零 DOM，jiti 直导源码。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildMultiDoneEdit } = await jiti.import(
	'../src/tasks-center/note-task-multi-done.ts',
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

test('分散选中 3 行：只改这 3 行，其余逐字节不变', () => {
	const result = buildMultiDoneEdit(CONTENT, [6, 1, 3]);

	assert.ok(result);
	assert.deepEqual(result.changedLines, [1, 3, 6]);
	assert.deepEqual(result.edit.nextLines, [
		'- [x] 甲',
		'- [ ] 乙',
		'- [x] 丙',
		'',
		'散文',
		'- [x] 丁',
	]);
	// 窗口 = [min, max]，窗口外（标题行）不进 edit
	assert.equal(result.edit.startLine, 1);
	assert.equal(result.edit.endLine, 6);
});

test('已是 [x] / [X]：原行返回、不计数；全完成 → changedLines 空', () => {
	const content = '- [x] 甲\n- [X] 乙';
	const result = buildMultiDoneEdit(content, [0, 1]);

	assert.ok(result);
	assert.deepEqual(result.changedLines, []);
	assert.deepEqual(result.repeatLines, []);
	assert.deepEqual(result.edit.nextLines, content.split('\n'));
});

test('窗口内含正文 / 空行：原样透传、不计数、不抛错', () => {
	const content = '- [ ] 甲\n散文\n\n- [ ] 乙';
	const result = buildMultiDoneEdit(content, [0, 1, 2, 3]);

	assert.deepEqual(result.changedLines, [0, 3]);
	assert.deepEqual(result.edit.nextLines, [
		'- [x] 甲',
		'散文',
		'',
		'- [x] 乙',
	]);
});

test('缩进 / 数字列表 / 行尾空白 / 控制项：只换勾选位', () => {
	const content = [
		'  - [ ] 缩进两项',
		'\t1. [ ] Tab 数字列表',
		'- [ ] 行尾空白   ',
		'- [ ] 带固定 #ioto/pin',
	].join('\n');

	const result = buildMultiDoneEdit(content, [0, 1, 2, 3]);

	assert.deepEqual(result.edit.nextLines, [
		'  - [x] 缩进两项',
		'\t1. [x] Tab 数字列表',
		'- [x] 行尾空白   ',
		'- [x] 带固定 #ioto/pin',
	]);
});

test('CRLF：`\\r` 不被吞（窗口内非目标行同样逐字节透传）', () => {
	const content = '- [ ] 甲\r\n      续写\r\n- [ ] 乙\r\n';
	const result = buildMultiDoneEdit(content, [0, 2]);

	assert.deepEqual(result.edit.nextLines, [
		'- [x] 甲\r',
		'      续写\r',
		'- [x] 乙\r',
	]);
	for (const line of result.edit.nextLines) {
		assert.ok(line.endsWith('\r'));
	}

	// 再跑一次（幂等）→ 零改动
	const again = buildMultiDoneEdit(result.edit.nextLines.join('\n'), [0, 2]);
	assert.deepEqual(again.changedLines, []);
});

test('repeatLines：只含实际改动的重复任务行，已完成的重复任务不计', () => {
	const content = [
		'- [ ] 普通任务',
		'- [ ] 重复任务 #ioto/repeat',
		'- [x] 已完成的重复任务 #ioto/repeat',
	].join('\n');

	const result = buildMultiDoneEdit(content, [0, 1, 2]);

	assert.deepEqual(result.changedLines, [0, 1]);
	assert.deepEqual(result.repeatLines, [1]);
});

test('空集 / 越界 → null', () => {
	assert.equal(buildMultiDoneEdit(CONTENT, []), null);
	assert.equal(buildMultiDoneEdit(CONTENT, [0, 99]), null);
	assert.equal(buildMultiDoneEdit(CONTENT, [-1, 0]), null);
});

test('只选父行：子行原样（不级联）', () => {
	// 子行落在窗口内（两个 target 之间），必须透传、不计数
	const content = ['- [ ] 父', '  - [ ] 子', '- [ ] 叔'].join('\n');
	const result = buildMultiDoneEdit(content, [0, 2]);

	assert.deepEqual(result.changedLines, [0, 2]);
	assert.deepEqual(result.edit.nextLines, [
		'- [x] 父',
		'  - [ ] 子',
		'- [x] 叔',
	]);

	// 只选父行时窗口只有父行，子行根本不在 edit 里
	const alone = buildMultiDoneEdit(content, [0]);
	assert.deepEqual(alone.edit.nextLines, ['- [x] 父']);
});
