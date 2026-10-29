import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	frontmatterLineCount,
	offsetToLine,
	resolveHitLine,
} = await jiti.import('../src/tasks-center/search-hit-line.ts');

// ------------------------------------------------------------------
// frontmatterLineCount
// ------------------------------------------------------------------

test('frontmatterLineCount: 无 frontmatter → 0', () => {
	assert.equal(frontmatterLineCount('# 标题\n正文'), 0);
});

test('frontmatterLineCount: 含闭合行与其后换行', () => {
	// 3 行被吃掉：开 `---`、属性行、闭 `---`（含其后换行）→ 正文从第 3 行起。
	assert.equal(frontmatterLineCount('---\nProject: x\n---\n# 标题\n'), 3);
});

test('frontmatterLineCount: 闭合在文件末尾（无尾换行）', () => {
	assert.equal(frontmatterLineCount('---\na: 1\n---'), 2);
});

test('frontmatterLineCount: CRLF 换行同口径', () => {
	assert.equal(frontmatterLineCount('---\r\na: 1\r\n---\r\n正文'), 3);
});

test('frontmatterLineCount: 正文中段的 --- 不计', () => {
	assert.equal(frontmatterLineCount('# T\n---\n分隔线'), 0);
});

test('frontmatterLineCount: 未闭合不当作 frontmatter', () => {
	assert.equal(frontmatterLineCount('---\na: 1\n# 标题'), 0);
});

// ------------------------------------------------------------------
// offsetToLine
// ------------------------------------------------------------------

test('offsetToLine: 首行偏移 → 0', () => {
	assert.equal(offsetToLine('abc\ndef', 0), 0);
});

test('offsetToLine: 偏移落在第二行内 → 1', () => {
	assert.equal(offsetToLine('abc\ndef', 5), 1);
});

test('offsetToLine: 末行偏移', () => {
	const text = 'a\nb\nc';
	assert.equal(offsetToLine(text, text.length - 1), 2);
});

test('offsetToLine: 偏移恰在行首（换行符之后）', () => {
	assert.equal(offsetToLine('abc\ndef', 4), 1);
});

test('offsetToLine: 越界偏移夹取到文本末端', () => {
	const text = 'a\nb';
	assert.equal(offsetToLine(text, 999), 1);
	assert.equal(offsetToLine(text, -5), 0);
});

// ------------------------------------------------------------------
// resolveHitLine
// ------------------------------------------------------------------

const OPTS = { caseSensitive: false, wholeWord: false };

test('resolveHitLine: 单词多命中取第 N 个', () => {
	const raw = '第一行 笔记\n第二行\n第三行 笔记\n第四行';
	// 正文里「笔记」第 2 处（hitIndex=1）在第 2 行（正文 0 基第 2 行）。
	assert.equal(
		resolveHitLine({ raw, tokens: ['笔记'], options: OPTS, hitIndex: 1 }),
		2,
	);
});

test('resolveHitLine: frontmatter 行数补偿', () => {
	const raw = '---\nProject: x\nSubject: y\n---\n命中在这\n下一行';
	// 正文 0 基第 0 行 + frontmatter 4 行 = 全文第 4 行。
	assert.equal(
		resolveHitLine({ raw, tokens: ['命中'], options: OPTS, hitIndex: 0 }),
		4,
	);
});

test('resolveHitLine: 多词区间合并后序号仍对齐', () => {
	// 「登录」与「问题」在「登录问题」上重叠 → 合并成一个区间。
	const raw = '登录问题在第一行\n登录\n再谈登录问题';
	// 合并后区间：[0,4)（登录问题）、[7,9)（登录）、[12,16)（登录问题）。
	// hitIndex=1 → 第二个区间起点在第 1 行。
	assert.equal(
		resolveHitLine({
			raw,
			tokens: ['登录', '问题'],
			options: OPTS,
			hitIndex: 1,
		}),
		1,
	);
	// hitIndex=2 → 第三个区间在第 2 行。
	assert.equal(
		resolveHitLine({
			raw,
			tokens: ['登录', '问题'],
			options: OPTS,
			hitIndex: 2,
		}),
		2,
	);
});

test('resolveHitLine: hitIndex 越界 clamp 到最后一个区间', () => {
	const raw = 'a 命中\nb\nc 命中';
	assert.equal(
		resolveHitLine({ raw, tokens: ['命中'], options: OPTS, hitIndex: 99 }),
		2,
	);
});

test('resolveHitLine: hitIndex < 0 → null', () => {
	assert.equal(
		resolveHitLine({ raw: '命中', tokens: ['命中'], options: OPTS, hitIndex: -1 }),
		null,
	);
});

test('resolveHitLine: 无 tokens → null', () => {
	assert.equal(
		resolveHitLine({ raw: '命中', tokens: [], options: OPTS, hitIndex: 0 }),
		null,
	);
});

test('resolveHitLine: 无命中 → null', () => {
	assert.equal(
		resolveHitLine({ raw: '没有', tokens: ['命中'], options: OPTS, hitIndex: 0 }),
		null,
	);
});

test('resolveHitLine: caseSensitive 透传一致', () => {
	const raw = 'Note 在第一行\nnote 在第二行';
	assert.equal(
		resolveHitLine({
			raw,
			tokens: ['note'],
			options: { caseSensitive: true, wholeWord: false },
			hitIndex: 0,
		}),
		1,
	);
});

test('resolveHitLine: wholeWord 透传一致', () => {
	const raw = 'footnotes 第一行\nnote 第二行';
	// 全词口径下「footnotes」里的 note 不是命中，唯一命中在第 1 行。
	assert.equal(
		resolveHitLine({
			raw,
			tokens: ['note'],
			options: { caseSensitive: false, wholeWord: true },
			hitIndex: 0,
		}),
		1,
	);
	// 非全词口径下第一处命中（footnotes 内）在第 0 行。
	assert.equal(
		resolveHitLine({
			raw,
			tokens: ['note'],
			options: { caseSensitive: false, wholeWord: false },
			hitIndex: 0,
		}),
		0,
	);
});
