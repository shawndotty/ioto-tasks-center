import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { CURSOR_MARKER, stripCursorMarkers, resolveCursorMarkerSearchStart } =
	await jiti.import('../src/tasks-center/cursor-marker.ts');

test('标记常量与模板保持一致', () => {
	assert.equal(CURSOR_MARKER, '%%Cursor%%');
});

test('单个标记会被移除，并返回其起始偏移', () => {
	const content = '# 目标\n\n- %%Cursor%%\n';
	const result = stripCursorMarkers(content);

	assert.equal(result.content, '# 目标\n\n- \n');
	assert.equal(result.firstOffset, content.indexOf('%%Cursor%%'));
	// 偏移可用作插入点：其后的内容正是标记原本之后的部分。
	assert.equal(result.content.slice(result.firstOffset), '\n');
});

test('多个标记会全部移除，偏移落在第一个标记处', () => {
	const content = 'A %%Cursor%% B %%cursor%% C';
	const result = stripCursorMarkers(content);

	assert.equal(result.content, 'A  B  C');
	assert.equal(result.firstOffset, content.indexOf('%%Cursor%%'));
});

test('无标记时内容原样返回且偏移为 null', () => {
	const content = '# 目标\n\n- \n';
	const result = stripCursorMarkers(content);

	assert.equal(result.content, content);
	assert.equal(result.firstOffset, null);
});

test('匹配忽略大小写', () => {
	const lower = stripCursorMarkers('- %%cursor%%');
	const upper = stripCursorMarkers('- %%CURSOR%%');

	assert.equal(lower.content, '- ');
	assert.equal(upper.content, '- ');
	assert.equal(lower.firstOffset, 2);
	assert.equal(upper.firstOffset, 2);
});

test('标记位于文件开头时偏移为 0', () => {
	const result = stripCursorMarkers('%%Cursor%%尾部');

	assert.equal(result.content, '尾部');
	assert.equal(result.firstOffset, 0);
});

test('相邻重复标记全部移除且偏移为首个下标', () => {
	const content = '前%%Cursor%%%%cursor%%后';
	const result = stripCursorMarkers(content);

	assert.equal(result.content, '前后');
	assert.equal(result.firstOffset, content.indexOf('%%Cursor%%'));
});

test('frontmatter 内的标记不会被移除', () => {
	const content = '---\nTitle: %%Cursor%%\n---\n正文';
	const result = stripCursorMarkers(content);

	assert.equal(result.content, content);
	assert.equal(result.firstOffset, null);
});

test('含 frontmatter 时只剥离正文标记，偏移仍指向正文首个标记', () => {
	const content =
		'---\nProject:\n  - "项目A"\n---\n# 目标\n\n- %%Cursor%%\n';
	const result = stripCursorMarkers(content);

	assert.equal(
		result.content,
		'---\nProject:\n  - "项目A"\n---\n# 目标\n\n- \n',
	);
	assert.equal(result.firstOffset, content.indexOf('%%Cursor%%'));
});

test('frontmatter 与正文同时存在标记时，仅剥离正文且偏移基于原始内容', () => {
	const content = '---\nTitle: %%Cursor%%\n---\n正文 %%cursor%% 结束';
	const result = stripCursorMarkers(content);

	assert.equal(result.content, '---\nTitle: %%Cursor%%\n---\n正文  结束');
	assert.equal(
		result.firstOffset,
		content.indexOf('%%cursor%%', resolveCursorMarkerSearchStart(content)),
	);
});

test('正文起始偏移在无 frontmatter 时为 0，有 frontmatter 时为整块长度', () => {
	assert.equal(resolveCursorMarkerSearchStart('# 正文'), 0);
	assert.equal(
		resolveCursorMarkerSearchStart('---\nProject: A\n---\n正文'),
		'---\nProject: A\n---\n'.length,
	);
});

test('正文相对偏移在 frontmatter 变长后仍指向原标记位置', () => {
	const created =
		'---\nProject:\n  - "项目A"\n---\n# 目标\n\n- %%Cursor%%\n';
	const { content: stripped, firstOffset } = stripCursorMarkers(created);
	const bodyOffset =
		firstOffset - resolveCursorMarkerSearchStart(stripped);

	// 打开前调用方再往 frontmatter 写入 UpTask，正文整体后移。
	const grown =
		'---\nProject:\n  - "项目A"\nUpTask:\n  - "[[父任务]]"\n---\n# 目标\n\n- \n';
	const absolute = resolveCursorMarkerSearchStart(grown) + bodyOffset;

	assert.equal(grown.slice(absolute - 2, absolute), '- ');
});
