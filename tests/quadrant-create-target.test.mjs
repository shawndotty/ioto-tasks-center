import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限创建任务的项目解析纯逻辑单测（[[Plan-20261116-145111]] §6.1）。
// 模块零 obsidian 运行时依赖，照 `quadrant-drag.test.mjs` 的 jiti 直载范式。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { resolveQuadrantCreateProject } = await jiti.import(
	'../src/tasks-center/quadrant-create-target.ts',
);

const OPTIONS = [
	{ name: 'Alpha', archived: false },
	{ name: 'Beta', archived: true },
	{ name: 'Gamma', archived: false },
];

test('project 范围且项目存在 → 直接使用该项目', () => {
	assert.deepEqual(
		resolveQuadrantCreateProject(
			{ kind: 'project', projectName: 'Beta' },
			OPTIONS,
		),
		{ kind: 'project', projectName: 'Beta' },
	);
});

test('project 范围但项目已消失 → none', () => {
	assert.deepEqual(
		resolveQuadrantCreateProject(
			{ kind: 'project', projectName: 'Delta' },
			OPTIONS,
		),
		{ kind: 'none' },
	);
});

test('project 范围缺少项目名 → none', () => {
	assert.deepEqual(
		resolveQuadrantCreateProject({ kind: 'project' }, OPTIONS),
		{ kind: 'none' },
	);
});

test('unarchived 范围过滤掉已存档项目', () => {
	const resolution = resolveQuadrantCreateProject(
		{ kind: 'unarchived' },
		OPTIONS,
	);
	assert.equal(resolution.kind, 'pick');
	assert.deepEqual(
		resolution.candidates.map((candidate) => candidate.name),
		['Alpha', 'Gamma'],
	);
});

test('all 范围保留已存档项目', () => {
	const resolution = resolveQuadrantCreateProject({ kind: 'all' }, OPTIONS);
	assert.equal(resolution.kind, 'pick');
	assert.deepEqual(
		resolution.candidates.map((candidate) => candidate.name),
		['Alpha', 'Beta', 'Gamma'],
	);
});

test('unarchived 范围全部为已存档 → none', () => {
	assert.deepEqual(
		resolveQuadrantCreateProject({ kind: 'unarchived' }, [
			{ name: 'Archived', archived: true },
		]),
		{ kind: 'none' },
	);
});

test('无候选项目 → none', () => {
	assert.deepEqual(
		resolveQuadrantCreateProject({ kind: 'all' }, []),
		{ kind: 'none' },
	);
	assert.deepEqual(
		resolveQuadrantCreateProject({ kind: 'unarchived' }, []),
		{ kind: 'none' },
	);
});

test('仅一个候选 → 自动使用，不弹选择器', () => {
	assert.deepEqual(
		resolveQuadrantCreateProject({ kind: 'unarchived' }, [
			{ name: 'Solo', archived: false },
			{ name: 'Hidden', archived: true },
		]),
		{ kind: 'project', projectName: 'Solo' },
	);
});

test('pick.candidates 顺序与传入顺序一致', () => {
	const resolution = resolveQuadrantCreateProject({ kind: 'all' }, OPTIONS);
	assert.equal(resolution.kind, 'pick');
	assert.deepEqual(
		resolution.candidates.map((candidate) => candidate.name),
		['Alpha', 'Beta', 'Gamma'],
	);
});

test('返回候选为副本，不修改输入数组与对象', () => {
	const options = [
		{ name: 'Alpha', archived: false },
		{ name: 'Beta', archived: false },
	];
	const snapshot = JSON.parse(JSON.stringify(options));
	const resolution = resolveQuadrantCreateProject({ kind: 'all' }, options);
	assert.equal(resolution.kind, 'pick');
	const [first] = resolution.candidates;
	first.name = 'Mutated';
	assert.deepEqual(options, snapshot);
});