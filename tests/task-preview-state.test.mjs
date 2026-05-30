import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	resolveActiveTaskPath,
	shouldSkipOpeningTask,
} = await jiti.import('../src/views/task-preview-state.ts');

test('当缓存命中但右侧 pane 实际不是目标文件时，不应跳过打开', () => {
	const result = shouldSkipOpeningTask({
		targetTaskPath: '3-任务/项目A/任务1.md',
		openedTaskPath: '3-任务/项目A/任务1.md',
		previewLeafAvailable: true,
		previewedFilePath: '3-任务/项目A/任务2.md',
	});

	assert.equal(result, false);
});

test('当右侧 pane 不可用时，不应跳过打开', () => {
	const result = shouldSkipOpeningTask({
		targetTaskPath: '3-任务/项目A/任务1.md',
		openedTaskPath: '3-任务/项目A/任务1.md',
		previewLeafAvailable: false,
		previewedFilePath: '3-任务/项目A/任务1.md',
	});

	assert.equal(result, false);
});

test('当右侧 pane 已打开目标文件时，才允许跳过打开', () => {
	const result = shouldSkipOpeningTask({
		targetTaskPath: '3-任务/项目A/任务1.md',
		openedTaskPath: '3-任务/项目A/任务1.md',
		previewLeafAvailable: true,
		previewedFilePath: '3-任务/项目A/任务1.md',
	});

	assert.equal(result, true);
});

test('任务激活态优先使用右侧 pane 的真实文件路径', () => {
	const activeTaskPath = resolveActiveTaskPath({
		openedTaskPath: '3-任务/项目A/任务1.md',
		previewLeafAvailable: true,
		previewedFilePath: '3-任务/项目A/任务2.md',
	});

	assert.equal(activeTaskPath, '3-任务/项目A/任务2.md');
});

test('当右侧 pane 不可用时，任务激活态回退到缓存路径', () => {
	const activeTaskPath = resolveActiveTaskPath({
		openedTaskPath: '3-任务/项目A/任务1.md',
		previewLeafAvailable: false,
		previewedFilePath: null,
	});

	assert.equal(activeTaskPath, '3-任务/项目A/任务1.md');
});
