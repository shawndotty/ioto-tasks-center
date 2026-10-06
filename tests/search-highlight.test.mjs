import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 搜索命中高亮的区间计算 / 切段纯逻辑（[[Discuss-20261006-183552]] §七）。
// 纯函数零 obsidian / 零 DOM，可 jiti 直接导入单测（`applySearchHighlight` 只在
// 函数体内触碰 DOM，导入本模块不触发）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { findMatchRanges, splitByQuery } = await jiti.import(
	'../src/views/ioto-task/search-highlight.ts',
);

test('findMatchRanges：大小写不敏感', () => {
	assert.deepEqual(findMatchRanges('Fix Login Bug', 'login'), [
		{ start: 4, end: 9 },
	]);
});

test('findMatchRanges：中文命中', () => {
	assert.deepEqual(findMatchRanges('修复登录问题', '登录'), [
		{ start: 2, end: 4 },
	]);
});

test('findMatchRanges：多次出现全部返回（不重叠）', () => {
	const ranges = findMatchRanges('aaa', 'aa');
	// 非重叠：`aa` 只命中 [0,2)，尾巴单 `a` 不再重叠命中
	assert.deepEqual(ranges, [{ start: 0, end: 2 }]);
	assert.deepEqual(findMatchRanges('abABab', 'ab'), [
		{ start: 0, end: 2 },
		{ start: 2, end: 4 },
		{ start: 4, end: 6 },
	]);
});

test('findMatchRanges：正则元字符按字面处理', () => {
	// 查询 `a.b` 应只命中字面 "a.b"，不把 `.` 当通配（否则会命中 "axb"）
	assert.deepEqual(findMatchRanges('xa.by', 'a.b'), [{ start: 1, end: 4 }]);
	assert.deepEqual(findMatchRanges('xaXby', 'a.b'), []);
	// 圆括号 / 加号等同样按字面，不抛错
	assert.deepEqual(findMatchRanges('c++ 手册', 'c++'), [
		{ start: 0, end: 3 },
	]);
	assert.deepEqual(findMatchRanges('f(x)', '(x)'), [{ start: 1, end: 4 }]);
});

test('findMatchRanges：空查询 / 空文本 → []', () => {
	assert.deepEqual(findMatchRanges('任意内容', ''), []);
	assert.deepEqual(findMatchRanges('', 'x'), []);
});

test('splitByQuery：可还原性（切段不丢字）', () => {
	const samples = [
		['Fix Login Bug', 'login'],
		['修复登录问题，请登录', '登录'],
		['abABab', 'ab'],
		['无命中内容', 'zzz'],
		['', 'x'],
		['全命中', '全命中'],
	];
	for (const [text, query] of samples) {
		const parts = splitByQuery(text, query);
		assert.equal(
			parts.map((p) => p.text).join(''),
			text,
			`还原失败：${text} / ${query}`,
		);
	}
});

test('splitByQuery：命中段 / 非命中段交替且标记正确', () => {
	assert.deepEqual(splitByQuery('aXbXc', 'x'), [
		{ text: 'a', hit: false },
		{ text: 'X', hit: true },
		{ text: 'b', hit: false },
		{ text: 'X', hit: true },
		{ text: 'c', hit: false },
	]);
	// 全段命中
	assert.deepEqual(splitByQuery('hit', 'hit'), [{ text: 'hit', hit: true }]);
	// 无命中：整段普通文本
	assert.deepEqual(splitByQuery('abc', 'z'), [{ text: 'abc', hit: false }]);
});

test('splitByQuery：空查询 → 整段普通文本；空文本 → []', () => {
	assert.deepEqual(splitByQuery('abc', ''), [{ text: 'abc', hit: false }]);
	assert.deepEqual(splitByQuery('', ''), []);
});
