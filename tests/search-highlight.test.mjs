import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 搜索命中高亮的区间计算 / 切段纯逻辑（[[Discuss-20261006-183552]] §七）。
// 纯函数零 obsidian / 零 DOM，可 jiti 直接导入单测（`applySearchHighlight` 只在
// 函数体内触碰 DOM，导入本模块不触发）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { findMatchRanges, splitByQuery, stepHitIndex } = await jiti.import(
	'../src/tasks-center/search-highlight.ts',
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

// 匹配选项（[[Plan-20261029-083909]] §三 S1 / §四 S6）：默认参数必须等于旧语义，
// 大小写只靠正则的 i 标志，全词靠「左右邻不是词字符」的后置过滤（不用 \b）。
test('findMatchRanges：默认 = 大小写不敏感子串（回归钉子）', () => {
	assert.deepEqual(findMatchRanges('Fix Login Bug', 'login'), [
		{ start: 4, end: 9 },
	]);
	assert.deepEqual(
		findMatchRanges('Fix Login Bug', 'login', { caseSensitive: false }),
		[{ start: 4, end: 9 }],
	);
});

test('findMatchRanges：caseSensitive 区分大小写', () => {
	assert.deepEqual(
		findMatchRanges('Fix Login Bug', 'login', { caseSensitive: true }),
		[],
	);
	assert.deepEqual(
		findMatchRanges('Fix Login Bug', 'Login', { caseSensitive: true }),
		[{ start: 4, end: 9 }],
	);
});

test('findMatchRanges：wholeWord 不跨词字符边界', () => {
	assert.deepEqual(findMatchRanges('foobar', 'foo', { wholeWord: true }), []);
	assert.deepEqual(
		findMatchRanges('中文foo中文', 'foo', { wholeWord: true }),
		[{ start: 2, end: 5 }],
	);
	assert.deepEqual(
		findMatchRanges('foobar foo', 'foo', { wholeWord: true }),
		[{ start: 7, end: 10 }],
	);
});

test('findMatchRanges：wholeWord 下中文退化为子串（防 \\b 复发的钉子）', () => {
	// \b笔记\b 在纯中文里恒为 false —— 这条用例专门钉住「不要用 \b」
	assert.deepEqual(
		findMatchRanges('卡片笔记-2026', '笔记', { wholeWord: true }),
		[{ start: 2, end: 4 }],
	);
});

test('findMatchRanges：wholeWord 下标点结尾不参与边界', () => {
	// \bc\+\+\b 在「c++ 手册」里恒为 false
	assert.deepEqual(
		findMatchRanges('c++ 手册', 'c++', { wholeWord: true }),
		[{ start: 0, end: 3 }],
	);
});

test('findMatchRanges：大小写 + 全词可同时生效', () => {
	assert.deepEqual(
		findMatchRanges('Foo foo', 'Foo', {
			caseSensitive: true,
			wholeWord: true,
		}),
		[{ start: 0, end: 3 }],
	);
	assert.deepEqual(
		findMatchRanges('Foobar foo', 'foo', {
			caseSensitive: true,
			wholeWord: true,
		}),
		[{ start: 7, end: 10 }],
	);
});

test('splitByQuery：带选项时仍可还原', () => {
	const samples = [
		['Fix Login Bug', 'login', { caseSensitive: true }],
		['foobar foo', 'foo', { wholeWord: true }],
		['卡片笔记-2026', '笔记', { wholeWord: true }],
		['abc', 'z', { wholeWord: true }],
	];
	for (const [text, query, options] of samples) {
		const parts = splitByQuery(text, query, options);
		assert.equal(parts.map((p) => p.text).join(''), text, text);
	}

	assert.deepEqual(splitByQuery('foobar foo', 'foo', { wholeWord: true }), [
		{ text: 'foobar ', hit: false },
		{ text: 'foo', hit: true },
	]);
	assert.deepEqual(
		splitByQuery('Fix Login Bug', 'login', { caseSensitive: true }),
		[{ text: 'Fix Login Bug', hit: false }],
	);
});

// 命中索引步进（[[Plan-20261028-221530]] §三 S3）：「上一个 / 下一个」共用一套环绕规则。
test('stepHitIndex：无命中 → -1', () => {
	assert.equal(stepHitIndex(-1, 0, 1), -1);
	assert.equal(stepHitIndex(-1, 0, -1), -1);
	assert.equal(stepHitIndex(0, 0, 1), -1);
});

test('stepHitIndex：未定位时按方向落到首/末', () => {
	assert.equal(stepHitIndex(-1, 7, 1), 0);
	assert.equal(stepHitIndex(-1, 7, -1), 6);
});

test('stepHitIndex：末位 +1 回 0，首位 -1 回末（环绕）', () => {
	assert.equal(stepHitIndex(6, 7, 1), 0);
	assert.equal(stepHitIndex(0, 7, -1), 6);
	assert.equal(stepHitIndex(3, 7, 1), 4);
	assert.equal(stepHitIndex(3, 7, -1), 2);
});

test('stepHitIndex：delta=0 原地；单条命中恒为 0', () => {
	assert.equal(stepHitIndex(2, 7, 0), 2);
	assert.equal(stepHitIndex(0, 1, 1), 0);
	assert.equal(stepHitIndex(0, 1, -1), 0);
});
