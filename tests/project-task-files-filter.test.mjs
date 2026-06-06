import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { isProjectTaskMarkdownFileName } = await jiti.import(
	'../src/tasks-center/data.ts',
);

test('_project.md 不应被识别为任务文件', () => {
	assert.equal(isProjectTaskMarkdownFileName('_project.md'), false);
});

test('一级 Markdown 文件应被识别为任务文件', () => {
	assert.equal(isProjectTaskMarkdownFileName('任务A.md'), true);
	assert.equal(isProjectTaskMarkdownFileName('Task.md'), true);
});

test('非 Markdown 文件不应被识别为任务文件', () => {
	assert.equal(isProjectTaskMarkdownFileName('image.png'), false);
	assert.equal(isProjectTaskMarkdownFileName('README'), false);
});

