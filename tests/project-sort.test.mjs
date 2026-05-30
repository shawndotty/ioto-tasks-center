import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { sortProjectEntries } = await jiti.import(
	'../src/tasks-center/project-sort.ts',
);
const { filterHiddenProjectEntries } = await jiti.import(
	'../src/tasks-center/project-sort.ts',
);

test('默认按未完成任务数量从多到少排序，并在同数量时按名称排序', () => {
	const sortedProjects = sortProjectEntries(
		[
			{ name: '项目2', path: '3-任务/项目2' },
			{ name: '项目1', path: '3-任务/项目1' },
			{ name: '项目3', path: '3-任务/项目3' },
		],
		new Map([
			['项目2', 1],
			['项目1', 3],
			['项目3', 1],
		]),
		'incomplete-count',
	);

	assert.deepEqual(
		sortedProjects.map((project) => project.name),
		['项目1', '项目2', '项目3'],
	);
});

test('按项目名称排序时支持数字顺序', () => {
	const sortedProjects = sortProjectEntries(
		[
			{ name: '项目10', path: '3-任务/项目10' },
			{ name: '项目2', path: '3-任务/项目2' },
			{ name: '项目1', path: '3-任务/项目1' },
		],
		new Map([
			['项目10', 5],
			['项目2', 0],
			['项目1', 3],
		]),
		'name',
	);

	assert.deepEqual(
		sortedProjects.map((project) => project.name),
		['项目1', '项目2', '项目10'],
	);
});

test('隐藏项目过滤会移除已配置隐藏的项目', () => {
	const visibleProjects = filterHiddenProjectEntries(
		[
			{ name: '项目1', path: '3-任务/项目1' },
			{ name: '项目2', path: '3-任务/项目2' },
			{ name: '项目3', path: '3-任务/项目3' },
		],
		['项目2'],
	);

	assert.deepEqual(
		visibleProjects.map((project) => project.name),
		['项目1', '项目3'],
	);
});
