import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 「创建任务副本」纯逻辑单测（[[Plan-20261023-145916]] §6）。
// 零 obsidian / 零 DOM，jiti 直导源码（范式同 note-task-swap.test.mjs）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildTaskDuplicatePlan, buildDuplicateTaskLine } = await jiti.import(
	'../src/tasks-center/note-task-duplicate.ts',
);
const { parseChecklistItems } = await jiti.import(
	'../src/tasks-center/note-checklist.ts',
);

/** 便捷构造：内容 → 条目 + 指定行 → 计划。 */
function plan(content, line, options) {
	const items = parseChecklistItems(content, { includeEmpty: true });
	return buildTaskDuplicatePlan(content, items, line, options);
}

/* ------------------------------------------------------------------ *
 * 1. 无续写区、无子树
 * ------------------------------------------------------------------ */

test('无续写区、无子树：副本紧跟原行，副本为 [ ]', () => {
	const content = '- [ ] 甲\n- [ ] 乙';
	const result = plan(content, 0, { includeContinuation: true });

	assert.deepEqual(result.nextLines, ['- [ ] 甲', '- [ ] 甲']);
	assert.equal(result.duplicateLine, 1);
	assert.equal(result.start, 0);
	assert.equal(result.end, 0);
	assert.deepEqual(result.originalLines, ['- [ ] 甲']);
});

/* ------------------------------------------------------------------ *
 * 2 / 3. 续写区：带 / 不带
 * ------------------------------------------------------------------ */

const WITH_CONTINUATION = [
	'- [ ] 甲',
	'      续写一',
	'      续写二',
	'- [ ] 乙',
].join('\n');

test('includeContinuation: false → 副本只带任务行，原件续写完好', () => {
	const result = plan(WITH_CONTINUATION, 0, { includeContinuation: false });

	assert.deepEqual(result.nextLines, [
		'- [ ] 甲',
		'      续写一',
		'      续写二',
		'- [ ] 甲',
	]);
	assert.equal(result.duplicateLine, 3);
});

test('includeContinuation: true → 副本带续行且缩进逐字节一致', () => {
	const result = plan(WITH_CONTINUATION, 0, { includeContinuation: true });

	assert.deepEqual(result.nextLines, [
		'- [ ] 甲',
		'      续写一',
		'      续写二',
		'- [ ] 甲',
		'      续写一',
		'      续写二',
	]);
	assert.equal(result.duplicateLine, 3);
});

/* ------------------------------------------------------------------ *
 * 4 / 5. 子树
 * ------------------------------------------------------------------ */

test('有子树：副本落在子树之后，子树行原样出现在副本内', () => {
	const content = ['- [ ] 甲', '  - [ ] 子', '- [ ] 乙'].join('\n');
	const result = plan(content, 0, { includeContinuation: true });

	assert.deepEqual(result.nextLines, [
		'- [ ] 甲',
		'  - [ ] 子',
		'- [ ] 甲',
		'  - [ ] 子',
	]);
	assert.equal(result.duplicateLine, 2);
	assert.equal(result.end, 1);
});

test('子树 + 原卡续写（false）：丢原卡续写、保留子树自己的续写', () => {
	const content = [
		'- [ ] 甲',
		'      甲续写',
		'  - [ ] 子',
		'      子续写',
	].join('\n');
	const result = plan(content, 0, { includeContinuation: false });

	assert.deepEqual(result.nextLines, [
		'- [ ] 甲',
		'      甲续写',
		'  - [ ] 子',
		'      子续写',
		'- [ ] 甲',
		'  - [ ] 子',
		'      子续写',
	]);
	assert.equal(result.duplicateLine, 4);
});

/* ------------------------------------------------------------------ *
 * 6 / 7. 缩进形态与 CRLF
 * ------------------------------------------------------------------ */

test('Tab 缩进：副本仍是 Tab，不被规整成空格', () => {
	const content = ['\t- [ ] 甲', '\t\t续写'].join('\n');
	const result = plan(content, 0, { includeContinuation: true });

	assert.equal(result.nextLines[2], '\t- [ ] 甲');
	assert.equal(result.nextLines[3], '\t\t续写');
});

test('CRLF：行尾 \\r 逐字节保留', () => {
	const content = '- [ ] 甲\r\n- [ ] 乙\r\n';
	const result = plan(content, 0, { includeContinuation: true });

	assert.equal(result.nextLines[1], '- [ ] 甲\r');
});

/* ------------------------------------------------------------------ *
 * 8. 勾选态重置
 * ------------------------------------------------------------------ */

test('原件已勾选 x / X → 副本一律 [ ]', () => {
	assert.equal(buildDuplicateTaskLine('- [x] 甲'), '- [ ] 甲');
	assert.equal(buildDuplicateTaskLine('- [X] 甲'), '- [ ] 甲');
});

/* ------------------------------------------------------------------ *
 * 9 / 10 / 11. 控制项剥离
 * ------------------------------------------------------------------ */

test('副本剥离 #ioto/pin 与 #ioto/repeat，执行参数保留', () => {
	const content =
		'- [ ] 甲 #ioto/pin #ioto/repeat #ioto/agent/x #ioto/turns/3';
	const result = plan(content, 0, { includeContinuation: true });

	assert.equal(
		result.nextLines[1],
		'- [ ] 甲 #ioto/agent/x #ioto/turns/3',
	);
});

test('子树里的 #ioto/repeat 在副本中同样被剥离', () => {
	const content = ['- [ ] 甲', '  - [ ] 子 #ioto/repeat'].join('\n');
	const result = plan(content, 0, { includeContinuation: true });

	assert.equal(result.nextLines[2], '- [ ] 甲');
	assert.equal(result.nextLines[3], '  - [ ] 子');
});

test('dropViewControls: false → 控制项逐字节保留（仅重置勾选位）', () => {
	const content = '- [x] 甲 #ioto/pin #ioto/repeat';
	const result = plan(content, 0, {
		includeContinuation: true,
		dropViewControls: false,
	});

	assert.equal(result.nextLines[1], '- [ ] 甲 #ioto/pin #ioto/repeat');
});

/* ------------------------------------------------------------------ *
 * 12. 有序列表不重排序号
 * ------------------------------------------------------------------ */

test('有序列表 3. → 副本同样是 3.（不重排序号）', () => {
	const content = '3. [ ] 甲';
	const result = plan(content, 0, { includeContinuation: true });

	assert.equal(result.nextLines[1], '3. [ ] 甲');
});

/* ------------------------------------------------------------------ *
 * 13. 无效入口
 * ------------------------------------------------------------------ */

test('line 不在 items / 非任务行 → null', () => {
	assert.equal(plan('- [ ] 甲', 5, { includeContinuation: true }), null);
	assert.equal(plan('普通正文\n- [ ] 甲', 0, { includeContinuation: true }), null);
	assert.equal(buildDuplicateTaskLine('普通正文'), null);
});

/* ------------------------------------------------------------------ *
 * 14. 空行隔断
 * ------------------------------------------------------------------ */

test('空行隔断：空行不算续行，副本只带任务行', () => {
	const content = ['- [ ] 甲', '', '  续写'].join('\n');
	const result = plan(content, 0, { includeContinuation: true });

	assert.deepEqual(result.nextLines, ['- [ ] 甲', '- [ ] 甲']);
	assert.equal(result.duplicateLine, 1);
});
