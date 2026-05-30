import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	DEFAULT_TASKS_ROOT_PATH,
	normalizeTasksRootPath,
} = await jiti.import('../src/tasks-center/types.ts');

test('任务根目录为空白时会回退到默认值', () => {
	assert.equal(normalizeTasksRootPath('   '), DEFAULT_TASKS_ROOT_PATH);
});

test('任务根目录会归一化分隔符和末尾斜杠', () => {
	assert.equal(
		normalizeTasksRootPath('\\工作区\\\\任务///'),
		'工作区/任务',
	);
});

test('任务根目录会移除开头的 ./', () => {
	assert.equal(normalizeTasksRootPath('./工作区/任务'), '工作区/任务');
});
