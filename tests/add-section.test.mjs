import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { appendSectionHeading, parseSections } = await jiti.import(
	'../src/tasks-center/note-structure.ts',
);

const TITLE = 'New section';

test('空内容 → 仅一级标题，headingLine=0，level=1', () => {
	const result = appendSectionHeading('', TITLE);
	assert.equal(result.content, '# New section');
	assert.equal(result.level, 1);
	assert.equal(result.headingLine, 0);
});

test('末行非空 → 恰好一个空行分隔的一级标题', () => {
	const content = ['# 任务', '- [ ] 甲'].join('\n');
	const result = appendSectionHeading(content, TITLE);
	assert.equal(
		result.content,
		['# 任务', '- [ ] 甲', '', '# New section'].join('\n'),
	);
	assert.equal(result.level, 1);
	assert.equal(result.headingLine, 3);
});

test('末行已是空串 → 复用该空行，不产生双空行', () => {
	const content = ['# 任务', '- [ ] 甲', ''].join('\n');
	const result = appendSectionHeading(content, TITLE);
	assert.equal(
		result.content,
		['# 任务', '- [ ] 甲', '', '# New section'].join('\n'),
	);
	assert.equal(result.headingLine, 3);
});

test('末行是纯空白 → 同样直接追加', () => {
	const content = '# 任务\n   \t ';
	const result = appendSectionHeading(content, TITLE);
	assert.equal(result.content, '# 任务\n   \t \n# New section');
	assert.equal(result.headingLine, 2);
});

test('文档只有二级顶层块 → 新块同为二级（##）', () => {
	const content = ['## 甲', '- [ ] a', '', '## 乙', '- [ ] b'].join('\n');
	const result = appendSectionHeading(content, TITLE);
	assert.equal(
		result.content,
		['## 甲', '- [ ] a', '', '## 乙', '- [ ] b', '', '## New section'].join(
			'\n',
		),
	);
	assert.equal(result.level, 2);
	assert.equal(result.headingLine, 6);
});

test('一级块内含二级嵌套标题 → 新块跟随一级，不跟随嵌套标题', () => {
	const content = ['# 甲', '## 子块', '- [ ] a'].join('\n');
	const result = appendSectionHeading(content, TITLE);
	assert.equal(
		result.content,
		['# 甲', '## 子块', '- [ ] a', '', '# New section'].join('\n'),
	);
	assert.equal(result.level, 1);
	assert.equal(result.headingLine, 4);
});

test('仅引导区（标题前正文）→ 回退一级', () => {
	const content = ['一些开场正文', ''].join('\n');
	const result = appendSectionHeading(content, TITLE);
	assert.equal(result.content, '一些开场正文\n\n# New section');
	assert.equal(result.level, 1);
	assert.equal(result.headingLine, 2);
});

test('标题文本两侧空白被 trim，# 前缀由级别重建', () => {
	// `'## 甲\n'` 的末行是空串（既有的一个分隔行），直接追加 → 恰好一个空行。
	const content = '## 甲\n';
	const result = appendSectionHeading(content, '  未命名  ');
	assert.equal(result.content, '## 甲\n\n## 未命名');
	assert.equal(result.headingLine, 2);
});

test('结果可被 parseSections 解析为独立顶层块，起始行 = headingLine', () => {
	const content = ['## 甲', '- [ ] a'].join('\n');
	const result = appendSectionHeading(content, TITLE);
	const sections = parseSections(result.content);
	const created = sections.find((s) => s.startLine === result.headingLine);
	assert.ok(created, '新标题块应被解析到');
	assert.equal(created.level, 2);
	assert.equal(created.title, TITLE);
});
