import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { isExcalidrawFile, isExcalidrawFrontmatter } = await jiti.import(
	'../src/tasks-center/excalidraw-target.ts',
);

test('x.excalidraw.md 靠 frontmatter 认出来（主场景：扩展名是 md）', () => {
	const result = isExcalidrawFile({
		extension: 'md',
		frontmatter: { 'excalidraw-plugin': 'parsed' },
	});

	assert.equal(result, true);
});

test('普通笔记不许被改道（md 且没有 frontmatter 标记）', () => {
	const result = isExcalidrawFile({ extension: 'md' });

	assert.equal(result, false);
});

test('纯 JSON 形态的 .excalidraw 本来就该走嵌入', () => {
	const result = isExcalidrawFile({ extension: 'excalidraw' });

	assert.equal(result, true);
});

test('扩展名比较大小写不敏感', () => {
	const result = isExcalidrawFile({ extension: 'EXCALIDRAW' });

	assert.equal(result, true);
});

test('frontmatter 键存在但值为 undefined 时算「不是绘图」', () => {
	const result = isExcalidrawFrontmatter({ 'excalidraw-plugin': undefined });

	assert.equal(result, false);
});

test('frontmatter 缺席（metadataCache 未就绪）不崩', () => {
	assert.equal(isExcalidrawFrontmatter(undefined), false);
	assert.equal(isExcalidrawFrontmatter({}), false);
});
