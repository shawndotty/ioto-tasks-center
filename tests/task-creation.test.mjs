import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildTaskFileName,
	getTemplaterCommandId,
	normalizeCustomTaskName,
	resolveTaskTargetPath,
} = await jiti.import('../src/tasks-center/task-creation.ts');

const FIXED_LOCAL_DATE = new Date(2026, 4, 30, 12, 0, 0);

test('日期任务命名符合 项目名-YYYY-MM-DD.md 规则', () => {
	const fileName = buildTaskFileName('项目A', 'date', FIXED_LOCAL_DATE);

	assert.equal(fileName, '项目A-2026-05-30.md');
});

test('计划任务命名符合 项目名-计划-名称.md 规则', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'plan',
		FIXED_LOCAL_DATE,
		'阶段一',
	);

	assert.equal(fileName, '项目A-计划-阶段一.md');
});

test('主题任务命名符合 项目名-主题-名称.md 规则', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'topic',
		FIXED_LOCAL_DATE,
		'发布复盘',
	);

	assert.equal(fileName, '项目A-主题-发布复盘.md');
});

test('计划和主题任务名称为空时会抛出错误', () => {
	assert.throws(
		() => buildTaskFileName('项目A', 'plan', FIXED_LOCAL_DATE, '   '),
		/任务名称不能为空/,
	);

	assert.throws(
		() => buildTaskFileName('项目A', 'topic', FIXED_LOCAL_DATE, ''),
		/任务名称不能为空/,
	);
});

test('任务名称归一化会折叠空白并替换非法字符', () => {
	assert.equal(normalizeCustomTaskName('  阶段   一  '), '阶段 一');
	assert.equal(normalizeCustomTaskName('计划/主题'), '计划-主题');
	assert.equal(normalizeCustomTaskName('   '), null);
});

test('任务目标路径固定在 3-任务/项目名/文件名 下', () => {
	const targetPath = resolveTaskTargetPath('项目A', '项目A-计划-阶段一.md');

	assert.equal(targetPath, '3-任务/项目A/项目A-计划-阶段一.md');
});

test('Templater 命令 ID 生成规则正确', () => {
	const commandId = getTemplaterCommandId(
		'0-辅助/IOTO/Templates/任务模板.md',
	);

	assert.equal(
		commandId,
		'templater-obsidian:0-辅助/IOTO/Templates/任务模板.md',
	);
});
