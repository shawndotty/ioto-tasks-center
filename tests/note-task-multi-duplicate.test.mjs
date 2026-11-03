import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 批量创建副本纯逻辑单测（[[Plan-20261104-060428]] §6.2）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildMultiDuplicatePlan } = await jiti.import(
	'../src/tasks-center/note-task-multi-duplicate.ts',
);

function plan(content, lines, options = { includeContinuation: true }) {
	return buildMultiDuplicatePlan(content, lines, options);
}

test('相邻两块：nextLines = A, A′, B, B′，duplicateLines 是副本任务行的绝对行号', () => {
	const content = '- [ ] 甲\n- [ ] 乙';
	const result = plan(content, [0, 1]);

	assert.deepEqual(result.edit.nextLines, [
		'- [ ] 甲',
		'- [ ] 甲',
		'- [ ] 乙',
		'- [ ] 乙',
	]);
	assert.deepEqual(result.duplicateLines, [1, 3]);
	assert.deepEqual(result.blocks, [
		{ startLine: 0, endLine: 0 },
		{ startLine: 1, endLine: 1 },
	]);
	assert.equal(result.edit.startLine, 0);
	assert.equal(result.edit.endLine, 1);
});

test('中间夹散文的两块：窗口覆盖全程、散文原样留在原位、偏移正确', () => {
	const content = ['- [ ] 甲', '', '散文', '', '- [ ] 乙'].join('\n');
	const result = plan(content, [0, 4]);

	assert.deepEqual(result.edit.nextLines, [
		'- [ ] 甲',
		'- [ ] 甲',
		'',
		'散文',
		'',
		'- [ ] 乙',
		'- [ ] 乙',
	]);
	assert.deepEqual(result.duplicateLines, [1, 6]);
});

test('父子同选：只复制最外层一次（blocks.length === 1）', () => {
	const content = ['- [ ] 甲', '  - [ ] 子'].join('\n');
	const result = plan(content, [0, 1]);

	assert.equal(result.blocks.length, 1);
	assert.deepEqual(result.duplicateLines, [2]);
	assert.deepEqual(result.edit.nextLines, [
		'- [ ] 甲',
		'  - [ ] 子',
		'- [ ] 甲',
		'  - [ ] 子',
	]);
});

test('includeContinuation:false → 副本丢本卡续行，子树原样', () => {
	const content = ['- [ ] 甲', '      续写', '- [ ] 乙'].join('\n');
	const result = plan(content, [0], { includeContinuation: false });

	assert.equal(result.ownContinuationCount, 1);
	// 窗口 = 首块首行 … 末块末行（0..1），块外的下一张任务不进 edit
	assert.deepEqual(result.edit.nextLines, [
		'- [ ] 甲',
		'      续写',
		'- [ ] 甲',
	]);
	assert.deepEqual(result.duplicateLines, [2]);
});

test('副本无 #ioto/pin / #ioto/repeat，勾选位为 [ ]', () => {
	const content = '- [x] 甲 #ioto/pin #ioto/repeat';
	const result = plan(content, [0]);

	assert.deepEqual(result.edit.nextLines, [
		'- [x] 甲 #ioto/pin #ioto/repeat',
		'- [ ] 甲',
	]);
});

test('ownContinuationCount = 组内求和（供批量弹窗文案）', () => {
	const content = [
		'- [ ] 甲',
		'      甲续一',
		'- [ ] 乙',
		'      乙续一',
		'      乙续二',
	].join('\n');
	const result = plan(content, [0, 2]);

	assert.equal(result.ownContinuationCount, 3);
});

test('窗口不在文件首：duplicateLines 是**绝对**行号（含前置标题 / 空行）', () => {
	// 回归：曾直接把「窗口内下标」当绝对行号，导致回填选中落到 walk 之前的行
	const content = ['# 任务', '', '- [ ] 甲', '- [ ] 乙'].join('\n');
	const result = plan(content, [2, 3]);

	assert.equal(result.edit.startLine, 2);
	assert.deepEqual(result.duplicateLines, [3, 5]);
	assert.deepEqual(result.edit.nextLines, [
		'- [ ] 甲',
		'- [ ] 甲',
		'- [ ] 乙',
		'- [ ] 乙',
	]);
});

test('空 lines / 无命中 → null', () => {
	assert.equal(plan('- [ ] 甲', []), null);
	assert.equal(plan('- [ ] 甲', [99]), null);
});
