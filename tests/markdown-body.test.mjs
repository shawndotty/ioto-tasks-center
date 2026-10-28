import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { stripFrontmatter } = await jiti.import(
	'../src/tasks-center/markdown-body.ts',
);

test('无 frontmatter 时原样返回', () => {
	assert.equal(stripFrontmatter('# 标题\n正文'), '# 标题\n正文');
});

test('标准 frontmatter 被剥离', () => {
	assert.equal(
		stripFrontmatter('---\nProject: x\n---\n# 标题'),
		'# 标题',
	);
});

test('CRLF 换行的 frontmatter 被剥离', () => {
	assert.equal(
		stripFrontmatter('---\r\nA: 1\r\n---\r\n正文'),
		'正文',
	);
});

test('frontmatter 闭合在文件末尾时返回空串', () => {
	assert.equal(stripFrontmatter('---\na: 1\n---'), '');
});

test('正文中段的 --- 不被误伤', () => {
	assert.equal(stripFrontmatter('# T\n---\n分隔线'), '# T\n---\n分隔线');
});

test('未闭合的 --- 不被当作 frontmatter', () => {
	assert.equal(
		stripFrontmatter('---\na: 1\n# 标题'),
		'---\na: 1\n# 标题',
	);
});
