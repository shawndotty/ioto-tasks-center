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

const EMPTY_ACTIVITY = new Map();

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
		EMPTY_ACTIVITY,
		'incomplete-count',
	);

	assert.deepEqual(
		sortedProjects.map((project) => project.name),
		['项目1', '项目2', '项目3'],
	);
});

test('按未完成任务数量从少到多排序', () => {
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
		EMPTY_ACTIVITY,
		'incomplete-count-asc',
	);

	assert.deepEqual(
		sortedProjects.map((project) => project.name),
		['项目2', '项目3', '项目1'],
	);
});

test('按活跃度排序时最近更新的项目在前，并列时按名称收尾', () => {
	const sortedProjects = sortProjectEntries(
		[
			{ name: '项目1', path: '3-任务/项目1' },
			{ name: '项目3', path: '3-任务/项目3' },
			{ name: '项目2', path: '3-任务/项目2' },
		],
		new Map(),
		new Map([
			['项目1', 1000],
			['项目2', 3000],
			['项目3', 1000],
		]),
		'activity',
	);

	assert.deepEqual(
		sortedProjects.map((project) => project.name),
		// 项目2 mtime 最新在前；项目1/项目3 并列按名称收尾
		['项目2', '项目1', '项目3'],
	);
});

test('按活跃度升序排序时最久未更新的项目在前', () => {
	const sortedProjects = sortProjectEntries(
		[
			{ name: '项目1', path: '3-任务/项目1' },
			{ name: '项目3', path: '3-任务/项目3' },
			{ name: '项目2', path: '3-任务/项目2' },
		],
		new Map(),
		new Map([
			['项目1', 1000],
			['项目2', 3000],
			['项目3', 1000],
		]),
		'activity-asc',
	);

	assert.deepEqual(
		sortedProjects.map((project) => project.name),
		// 项目1/项目3 并列最旧按名称收尾；项目2 mtime 最新排最后
		['项目1', '项目3', '项目2'],
	);
});

test('无任务文件的项目在活跃度降序时排最后、升序时排最前', () => {
	const projects = [
		{ name: '项目1', path: '3-任务/项目1' },
		{ name: '项目2', path: '3-任务/项目2' },
	];
	const activityMtimes = new Map([['项目1', 1000]]);

	const descSorted = sortProjectEntries(
		projects,
		new Map(),
		activityMtimes,
		'activity',
	);
	assert.deepEqual(
		descSorted.map((project) => project.name),
		['项目1', '项目2'],
	);

	const ascSorted = sortProjectEntries(
		projects,
		new Map(),
		activityMtimes,
		'activity-asc',
	);
	assert.deepEqual(
		ascSorted.map((project) => project.name),
		['项目2', '项目1'],
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
		EMPTY_ACTIVITY,
		'name',
	);

	assert.deepEqual(
		sortedProjects.map((project) => project.name),
		['项目1', '项目2', '项目10'],
	);
});

test('按项目名称从 Z 到 A 排序', () => {
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
		EMPTY_ACTIVITY,
		'name-desc',
	);

	assert.deepEqual(
		sortedProjects.map((project) => project.name),
		['项目10', '项目2', '项目1'],
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
