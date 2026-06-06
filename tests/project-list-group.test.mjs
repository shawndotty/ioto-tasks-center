import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildProjectListSections } = await jiti.import(
	'../src/views/project-list-group.ts',
);

test('不分组：返回单个 section 并按排序模式排序', () => {
	const sections = buildProjectListSections(
		[
			{ name: '项目2', path: '3-任务/项目2' },
			{ name: '项目1', path: '3-任务/项目1' },
		],
		new Map([
			['项目2', 1],
			['项目1', 3],
		]),
		new Map(),
		'incomplete-count',
		'none',
	);

	assert.equal(sections.length, 1);
	assert.deepEqual(
		sections[0].projects.map((project) => project.name),
		['项目1', '项目2'],
	);
});

test('按分类分组：未分类组排最后，组顺序按未完成总数 desc，组内按排序模式排序', () => {
	const sections = buildProjectListSections(
		[
			{ name: '项目A', path: '3-任务/项目A' },
			{ name: '项目B', path: '3-任务/项目B' },
			{ name: '项目C', path: '3-任务/项目C' },
			{ name: '项目D', path: '3-任务/项目D' },
		],
		new Map([
			['项目A', 5],
			['项目B', 1],
			['项目C', 2],
			['项目D', 7],
		]),
		new Map([
			['项目A', '分类1'],
			['项目B', '分类2'],
			['项目C', '分类1'],
			['项目D', ''],
		]),
		'incomplete-count',
		'category',
	);

	assert.deepEqual(
		sections.map((section) => section.groupKey),
		['分类1', '分类2', ''],
	);
	assert.deepEqual(
		sections[0].projects.map((project) => project.name),
		['项目A', '项目C'],
	);
	assert.deepEqual(
		sections[1].projects.map((project) => project.name),
		['项目B'],
	);
	assert.deepEqual(
		sections[2].projects.map((project) => project.name),
		['项目D'],
	);
});

