import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 关键词搜索的渲染期过滤纯逻辑（[[Plan-20261006-161121]] §2.8）。
// 零 obsidian / 零 DOM 依赖，可 jiti 直接导入单测。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { normalizeQuery, matchesTaskQuery, isCardVisible } = await jiti.import(
	'../src/views/ioto-task/task-query-filter.ts',
);

test('normalizeQuery：去首尾空白 + 小写；纯空白归一为「不过滤」', () => {
	assert.equal(normalizeQuery('  Hello  '), 'hello');
	assert.equal(normalizeQuery('ABC'), 'abc');
	assert.equal(normalizeQuery('   '), '');
	assert.equal(normalizeQuery(''), '');
});

test('matchesTaskQuery：大小写不敏感 + 中文包含', () => {
	assert.equal(matchesTaskQuery('Fix Login Bug', undefined, 'login'), true);
	assert.equal(matchesTaskQuery('修复登录问题', undefined, '登录'), true);
	assert.equal(matchesTaskQuery('abc', undefined, 'xyz'), false);
});

test('matchesTaskQuery：空查询恒 true（不过滤）', () => {
	assert.equal(matchesTaskQuery('任意内容', undefined, ''), true);
	assert.equal(matchesTaskQuery('', '', ''), true);
});

test('matchesTaskQuery：命中续行也算命中', () => {
	assert.equal(matchesTaskQuery('标题', '这里有补充说明', '补充'), true);
	assert.equal(matchesTaskQuery('标题', undefined, '补充'), false);
});

test('isCardVisible：recentLines 未命中 → false', () => {
	const ctx = {
		recentLines: new Set([1, 2]),
		onlyPending: false,
		normalizedQuery: '',
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
		normalizedQuery: '',
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
		normalizedQuery: 'no-hit',
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
		normalizedQuery: 'login',
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

test('isCardVisible：四层取交集（任一层否 → false）', () => {
	const ctx = {
		recentLines: new Set([10]),
		onlyPending: true,
		normalizedQuery: 'hit',
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
