import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { normalizeProjectName, resolveProjectTargetPath } = await jiti.import(
	'../src/tasks-center/project-creation.ts',
);

test('项目名称归一化会折叠空白并替换非法字符', () => {
	assert.equal(normalizeProjectName('  新   项目  '), '新 项目');
	assert.equal(normalizeProjectName('项目/阶段一'), '项目-阶段一');
	assert.equal(normalizeProjectName('   '), null);
});

test('项目目标路径会落在自定义任务根目录/项目名 下', () => {
	const targetPath = resolveProjectTargetPath('工作区/任务', '新项目');

	assert.equal(targetPath, '工作区/任务/新项目');
});
