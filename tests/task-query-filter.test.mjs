import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 关键词搜索的渲染期过滤纯逻辑（[[Plan-20261006-161121]] §2.8）。
// 零 obsidian / 零 DOM 依赖，可 jiti 直接导入单测。
// 多词口径（[[Plan-20261030-090856]]）：词粒度 OR、卡粒度 AND，分词复用 `tokenizeQuery`。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { normalizeQueryTokens, matchesTaskQuery, isCardVisible } =
	await jiti.import('../src/views/ioto-task/task-query-filter.ts');

test('normalizeQueryTokens：空白拆词 + 去重保序', () => {
	assert.deepEqual(normalizeQueryTokens('  login  fix  '), ['login', 'fix']);
	assert.deepEqual(normalizeQueryTokens('登录 登录'), ['登录']);
	assert.deepEqual(normalizeQueryTokens('b a b'), ['b', 'a']);
	assert.deepEqual(normalizeQueryTokens('ABC'), ['ABC']);
});

test('normalizeQueryTokens：全角空格 / Tab / NBSP 均可分词；纯空白 → []', () => {
	assert.deepEqual(normalizeQueryTokens('登录　修复'), ['登录', '修复']);
	assert.deepEqual(normalizeQueryTokens('a\tb'), ['a', 'b']);
	assert.deepEqual(normalizeQueryTokens('a\u00a0b'), ['a', 'b']);
	assert.deepEqual(normalizeQueryTokens('   '), []);
	assert.deepEqual(normalizeQueryTokens(''), []);
});

test('matchesTaskQuery：单词 = 与整串行为等价（回归锚点）', () => {
	assert.equal(matchesTaskQuery('Fix Login Bug', undefined, ['login']), true);
	assert.equal(matchesTaskQuery('修复登录问题', undefined, ['登录']), true);
	assert.equal(matchesTaskQuery('abc', undefined, ['xyz']), false);
});

test('matchesTaskQuery：空词表恒 true（不过滤）', () => {
	assert.equal(matchesTaskQuery('任意内容', undefined, []), true);
	assert.equal(matchesTaskQuery('', '', []), true);
});

test('matchesTaskQuery：AND——两词分布「标题 + 续行」也通过', () => {
	assert.equal(
		matchesTaskQuery('登录流程', undefined, ['登录', '流程']),
		true,
	);
	assert.equal(
		matchesTaskQuery('登录', '这里有补充说明', ['登录', '补充']),
		true,
	);
});

test('matchesTaskQuery：AND——任一词标题与续行均不命中 → false（短路）', () => {
	assert.equal(matchesTaskQuery('登录问题', undefined, ['登录', 'missing']), false);
	assert.equal(
		matchesTaskQuery('登录', '补充说明', ['登录', '补充', 'missing']),
		false,
	);
});

test('matchesTaskQuery：词粒度 OR——词命中「标题或续行任一处」即通过', () => {
	assert.equal(matchesTaskQuery('标题', '补充说明', ['补充']), true);
	assert.equal(matchesTaskQuery('标题', undefined, ['补充']), false);
	assert.equal(matchesTaskQuery('标题', '补充说明', ['标题', '补充']), true);
});

test('matchesTaskQuery：大小写不敏感由 findMatchRanges 的 gi 标志保证', () => {
	assert.equal(matchesTaskQuery('Fix Login Bug', undefined, ['LOGIN']), true);
	assert.equal(matchesTaskQuery('Fix Login Bug', 'abc', ['ABC']), true);
});

test('isCardVisible：recentLines 未命中 → false', () => {
	const ctx = {
		recentLines: new Set([1, 2]),
		onlyPending: false,
		queryTokens: [],
		keepVisibleLine: null,
	};
	assert.equal(
		isCardVisible({ line: 3, done: false, title: 'x' }, ctx),
		false,
	);
	assert.equal(
		isCardVisible({ line: 2, done: false, title: 'x' }, ctx),
		true,
	);
});

test('isCardVisible：onlyPending + done → false', () => {
	const ctx = {
		recentLines: null,
		onlyPending: true,
		queryTokens: [],
		keepVisibleLine: null,
	};
	assert.equal(
		isCardVisible({ line: 1, done: true, title: 'x' }, ctx),
		false,
	);
	assert.equal(
		isCardVisible({ line: 1, done: false, title: 'x' }, ctx),
		true,
	);
});

test('isCardVisible：keepVisibleLine 命中 → 无条件 true（即使不命中关键词）', () => {
	// 隔离关键词维度（resume/onlyPending 均关）：编辑中的卡不因关键词不命中被搜掉。
	const ctx = {
		recentLines: null,
		onlyPending: false,
		queryTokens: ['no-hit'],
		keepVisibleLine: 5,
	};
	assert.equal(
		isCardVisible({ line: 5, done: true, title: '其它' }, ctx),
		true,
	);
});

test('isCardVisible：关键词非空且不命中 → false；命中 → true', () => {
	const ctx = {
		recentLines: null,
		onlyPending: false,
		queryTokens: ['login'],
		keepVisibleLine: null,
	};
	assert.equal(
		isCardVisible({ line: 1, done: false, title: 'Fix Login' }, ctx),
		true,
	);
	assert.equal(
		isCardVisible(
			{ line: 2, done: false, title: '其它', continuation: 'login 流程' },
			ctx,
		),
		true,
	);
	assert.equal(
		isCardVisible({ line: 3, done: false, title: '无关' }, ctx),
		false,
	);
});

test('isCardVisible：多词 AND——全部词命中才可见', () => {
	const ctx = {
		recentLines: null,
		onlyPending: false,
		queryTokens: ['登录', '修复'],
		keepVisibleLine: null,
	};
	// 两词都在标题 → 可见
	assert.equal(
		isCardVisible({ line: 1, done: false, title: '修复登录问题' }, ctx),
		true,
	);
	// 一词在标题、一词在续行 → 可见
	assert.equal(
		isCardVisible(
			{ line: 2, done: false, title: '登录', continuation: '如何修复' },
			ctx,
		),
		true,
	);
	// 只命中一词 → 隐藏
	assert.equal(
		isCardVisible({ line: 3, done: false, title: '登录' }, ctx),
		false,
	);
});

test('isCardVisible：四层取交集（任一层否 → false）', () => {
	const ctx = {
		recentLines: new Set([10]),
		onlyPending: true,
		queryTokens: ['hit'],
		keepVisibleLine: null,
	};
	// 命中关键词但已完成 → false
	assert.equal(
		isCardVisible({ line: 10, done: true, title: 'hit' }, ctx),
		false,
	);
	// 未完成 + 命中关键词但不在 recent → false
	assert.equal(
		isCardVisible({ line: 11, done: false, title: 'hit' }, ctx),
		false,
	);
	// 四层全过 → true
	assert.equal(
		isCardVisible({ line: 10, done: false, title: 'hit' }, ctx),
		true,
	);
});
