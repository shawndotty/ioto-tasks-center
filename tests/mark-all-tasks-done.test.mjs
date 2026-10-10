import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { markTaskLineDone, markAllChecklistItemsDone } = await jiti.import(
	'../src/tasks-center/note-structure.ts',
);

// ---------------------------------------------------------------------------
// markTaskLineDone
// ---------------------------------------------------------------------------

test('未完成任务行 → 勾选为 x', () => {
	assert.equal(markTaskLineDone('- [ ] 写文档'), '- [x] 写文档');
});

test('已勾选 x → 逐字节原样返回', () => {
	const line = '- [x] 写文档';
	assert.equal(markTaskLineDone(line), line);
});

test('已勾选 X → 逐字节原样返回（不改大小写）', () => {
	const line = '- [X] 写文档';
	assert.equal(markTaskLineDone(line), line);
});

test('非任务行 → null', () => {
	assert.equal(markTaskLineDone('普通段落'), null);
	assert.equal(markTaskLineDone('- 普通列表'), null);
});

test('缩进 / 列表符 / 控制项 / CRLF 全保留', () => {
	assert.equal(
		markTaskLineDone('\t1. [ ] 甲 #ioto/turns/200'),
		'\t1. [x] 甲 #ioto/turns/200',
	);
	// 行尾 `\r`（CRLF）落在 trail，逐字节保留。
	assert.equal(markTaskLineDone('- [ ] 乙\r'), '- [x] 乙\r');
});

test('行中控制项与两侧空白保留', () => {
	assert.equal(
		markTaskLineDone('  * [ ] 正文 [model::gpt]  '),
		'  * [x] 正文 [model::gpt]  ',
	);
});

// ---------------------------------------------------------------------------
// markAllChecklistItemsDone
// ---------------------------------------------------------------------------

test('多处未完成只改未完成的，changedLines 行号正确', () => {
	const content = ['# 任务', '- [ ] 甲', '- [x] 乙', '  - [ ] 丙'].join('\n');
	const result = markAllChecklistItemsDone(content);
	assert.equal(
		result.content,
		['# 任务', '- [x] 甲', '- [x] 乙', '  - [x] 丙'].join('\n'),
	);
	assert.deepEqual(result.changedLines, [
		{ line: 1, text: '- [x] 甲' },
		{ line: 3, text: '  - [x] 丙' },
	]);
});

test('围栏代码块内的伪任务不动', () => {
	const content = [
		'- [ ] 真任务',
		'```',
		'- [ ] 代码里的假任务',
		'```',
	].join('\n');
	const result = markAllChecklistItemsDone(content);
	assert.equal(
		result.content,
		['- [x] 真任务', '```', '- [ ] 代码里的假任务', '```'].join('\n'),
	);
	assert.deepEqual(result.changedLines, [{ line: 0, text: '- [x] 真任务' }]);
});

test('注释内的伪任务不动（%%…%% 与 <!-- -->）', () => {
	const content = [
		'%%',
		'- [ ] obsidian 注释里的任务',
		'%%',
		'<!-- - [ ] html 注释里的任务 -->',
		'- [ ] 真任务',
	].join('\n');
	const result = markAllChecklistItemsDone(content);
	assert.equal(result.changedLines.length, 1);
	assert.equal(result.changedLines[0].line, 4);
});

test('空骨架行（- [ ] ）不计入（includeEmpty:false）', () => {
	const content = ['- [ ] ', '- [ ] 有正文'].join('\n');
	const result = markAllChecklistItemsDone(content);
	assert.equal(result.content, ['- [ ] ', '- [x] 有正文'].join('\n'));
	assert.deepEqual(result.changedLines, [{ line: 1, text: '- [x] 有正文' }]);
});

test('全已完成 → changedLines 为空且 content 不变', () => {
	const content = ['- [x] 甲', '- [X] 乙'].join('\n');
	const result = markAllChecklistItemsDone(content);
	assert.deepEqual(result.changedLines, []);
	assert.equal(result.content, content);
});

test('无任务 → changedLines 为空且 content 不变', () => {
	const content = ['# 标题', '纯段落'].join('\n');
	const result = markAllChecklistItemsDone(content);
	assert.deepEqual(result.changedLines, []);
	assert.equal(result.content, content);
});

test('CRLF 正文：行号对齐且 \\r 保留', () => {
	const content = '# 任务\r\n- [ ] 甲\r\n- [x] 乙\r';
	const result = markAllChecklistItemsDone(content);
	assert.equal(result.content, '# 任务\r\n- [x] 甲\r\n- [x] 乙\r');
	assert.deepEqual(result.changedLines, [{ line: 1, text: '- [x] 甲\r' }]);
});
