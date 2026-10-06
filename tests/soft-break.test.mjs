import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { insertSoftBreak, replaceTaskBody, SOFT_BREAK } = await jiti.import(
	'../src/tasks-center/note-structure.ts',
);

test('SOFT_BREAK 是不带自闭合斜杠的字面 <br>', () => {
	assert.equal(SOFT_BREAK, '<br>');
});

test('光标在中间插入（空选区）', () => {
	assert.deepEqual(insertSoftBreak('abc', 1, 1), {
		value: 'a<br>bc',
		cursor: 5,
	});
});

test('光标在末尾插入', () => {
	assert.deepEqual(insertSoftBreak('abc', 3, 3), {
		value: 'abc<br>',
		cursor: 7,
	});
});

test('光标在开头插入', () => {
	assert.deepEqual(insertSoftBreak('abc', 0, 0), {
		value: '<br>abc',
		cursor: 4,
	});
});

test('选区非空 → 整段替换为单个 <br>，光标落到其后', () => {
	assert.deepEqual(insertSoftBreak('abcdef', 1, 4), {
		value: 'a<br>ef',
		cursor: 5,
	});
});

test('from 为负数 → 钳到 0', () => {
	assert.deepEqual(insertSoftBreak('abc', -5, 1), {
		value: '<br>bc',
		cursor: 4,
	});
});

test('to < from → 视作空选区，落在 from 处', () => {
	assert.deepEqual(insertSoftBreak('abcdef', 4, 2), {
		value: 'abcd<br>ef',
		cursor: 8,
	});
});

test('to 越界 → 钳到字符串长度', () => {
	assert.deepEqual(insertSoftBreak('abc', 1, 99), {
		value: 'a<br>',
		cursor: 5,
	});
});

test('空串插入', () => {
	assert.deepEqual(insertSoftBreak('', 0, 0), {
		value: '<br>',
		cursor: 4,
	});
});

test('回归：replaceTaskBody 放行不含换行的 <br>，仍拒绝裸 \\n', () => {
	assert.notEqual(replaceTaskBody('- [ ] a', 'a<br>b'), null);
	assert.equal(replaceTaskBody('- [ ] a', 'a\nb'), null);
});
