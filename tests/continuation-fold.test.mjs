import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 续写区折叠的纯逻辑（[[Plan-20261022-232148]] S1）。
// 纯函数零 obsidian / 零 DOM，可 jiti 直接导入单测（`applyContinuationFoldState`
// 只在函数体内触碰 DOM，导入本模块不触发）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { continuationFoldKey, shouldForceExpand } = await jiti.import(
	'../src/views/ioto-task/continuation-fold.ts',
);

test('continuationFoldKey：相同文本 → 相同键', () => {
	assert.equal(continuationFoldKey('hello'), continuationFoldKey('hello'));
	assert.equal(
		continuationFoldKey('第一行\n第二行'),
		continuationFoldKey('第一行\n第二行'),
	);
});

test('continuationFoldKey：差一个字符 / 空格 → 不同键', () => {
	assert.notEqual(continuationFoldKey('hello'), continuationFoldKey('hellp'));
	assert.notEqual(continuationFoldKey('a b'), continuationFoldKey('ab'));
});

test('continuationFoldKey：空串与纯空白稳定且不抛错', () => {
	assert.equal(continuationFoldKey(''), continuationFoldKey(''));
	assert.equal(continuationFoldKey('   '), continuationFoldKey('   '));
	assert.notEqual(continuationFoldKey(''), continuationFoldKey(' '));
});

test('continuationFoldKey：形态固定 c + 8 位十六进制', () => {
	assert.match(continuationFoldKey(''), /^c[0-9a-f]{8}$/);
	assert.match(continuationFoldKey('任意正文 🎯'), /^c[0-9a-f]{8}$/);
});

test('continuationFoldKey：CRLF 与 LF 同键', () => {
	// 渲染层按 /\r?\n/ 切行、续行编辑入口按 '\n' 切行，同一个 CRLF 文件两侧
	// 会差出 \r；不归一则折叠记忆永远对不上。
	assert.equal(continuationFoldKey('a\r\nb'), continuationFoldKey('a\nb'));
	assert.equal(continuationFoldKey('a\rb'), continuationFoldKey('a\nb'));
});

test('shouldForceExpand：命中续写 / 只命中标题 / 空查询 / 空续写', () => {
	assert.equal(
		shouldForceExpand({
			continuation: '这里有关键词 target',
			queryTokens: ['target'],
		}),
		true,
	);
	// 续写里没有该词（只可能命中的是标题）→ 不强制展开
	assert.equal(
		shouldForceExpand({
			continuation: '续写正文',
			queryTokens: ['target'],
		}),
		false,
	);
	assert.equal(
		shouldForceExpand({ continuation: 'target', queryTokens: [] }),
		false,
	);
	assert.equal(
		shouldForceExpand({ continuation: undefined, queryTokens: ['target'] }),
		false,
	);
});

test('shouldForceExpand：多词——任一词命中续行 → 强制展开', () => {
	// 词命中续行（另一词只可能命中标题）→ 强制展开
	assert.equal(
		shouldForceExpand({
			continuation: '续写正文 target',
			queryTokens: ['other', 'target'],
		}),
		true,
	);
	// 两词均不命中续行 → 不强制展开
	assert.equal(
		shouldForceExpand({
			continuation: '续写正文',
			queryTokens: ['other', 'target'],
		}),
		false,
	);
});

test('shouldForceExpand：editing 为真 → 强制展开且无副作用', () => {
	const input = {
		continuation: '正文',
		queryTokens: [],
		editing: true,
	};
	assert.equal(shouldForceExpand(input), true);
	// 纯函数：两次调用结果一致，入参未被改写
	assert.equal(shouldForceExpand(input), true);
	assert.deepEqual(input, {
		continuation: '正文',
		queryTokens: [],
		editing: true,
	});
});
