import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { sortProjectCenterRows } = await jiti.import(
	'../src/views/project-center-sort.ts',
);

test('项目名排序支持数字顺序', () => {
	const rows = [
		{ name: '项目10', taskCount: 0, archived: false, metadata: {} },
		{ name: '项目2', taskCount: 0, archived: false, metadata: {} },
		{ name: '项目1', taskCount: 0, archived: false, metadata: {} },
	];

	assert.deepEqual(
		sortProjectCenterRows(rows, 'projectName', 'asc').map((r) => r.name),
		['项目1', '项目2', '项目10'],
	);
	assert.deepEqual(
		sortProjectCenterRows(rows, 'projectName', 'desc').map((r) => r.name),
		['项目10', '项目2', '项目1'],
	);
});

test('任务数量排序按数值升序/降序', () => {
	const rows = [
		{ name: '项目A', taskCount: 5, archived: false, metadata: {} },
		{ name: '项目B', taskCount: 0, archived: false, metadata: {} },
		{ name: '项目C', taskCount: 2, archived: false, metadata: {} },
	];

	assert.deepEqual(
		sortProjectCenterRows(rows, 'taskCount', 'asc').map((r) => r.name),
		['项目B', '项目C', '项目A'],
	);
	assert.deepEqual(
		sortProjectCenterRows(rows, 'taskCount', 'desc').map((r) => r.name),
		['项目A', '项目C', '项目B'],
	);
});

test('存档排序支持 false/true 升序/降序', () => {
	const rows = [
		{ name: '项目A', taskCount: 0, archived: true, metadata: {} },
		{ name: '项目B', taskCount: 0, archived: false, metadata: {} },
		{ name: '项目C', taskCount: 0, archived: true, metadata: {} },
	];

	assert.deepEqual(
		sortProjectCenterRows(rows, 'archived', 'asc').map((r) => r.name),
		['项目B', '项目A', '项目C'],
	);
	assert.deepEqual(
		sortProjectCenterRows(rows, 'archived', 'desc').map((r) => r.name),
		['项目A', '项目C', '项目B'],
	);
});

test('日期排序使用 YYYY-MM-DD 字符串顺序并允许空值', () => {
	const rows = [
		{
			name: '项目A',
			taskCount: 0,
			archived: false,
			metadata: { dueDate: '2026-12-31' },
		},
		{
			name: '项目B',
			taskCount: 0,
			archived: false,
			metadata: { dueDate: '' },
		},
		{
			name: '项目C',
			taskCount: 0,
			archived: false,
			metadata: { dueDate: '2026-01-01' },
		},
	];

	assert.deepEqual(
		sortProjectCenterRows(rows, 'dueDate', 'asc').map((r) => r.name),
		['项目B', '项目C', '项目A'],
	);
	assert.deepEqual(
		sortProjectCenterRows(rows, 'dueDate', 'desc').map((r) => r.name),
		['项目A', '项目C', '项目B'],
	);
});

