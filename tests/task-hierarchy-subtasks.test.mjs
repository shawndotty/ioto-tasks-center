import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildDirectChildTasksByParentPath, buildVisibleTaskHierarchy } =
	await jiti.import('../src/views/task-hierarchy.ts');

function createTask(path, title, upTaskTitles = []) {
	return {
		name: `${title}.md`,
		basename: title,
		title,
		path,
		mtime: 0,
		ctime: 0,
		size: 0,
		starred: false,
		status: {
			key: 'todo',
			label: 'todo',
			totalTaskCount: 0,
			completedTaskCount: 0,
			summary: '',
		},
		upTaskTitles,
	};
}

test('可统计直接子任务数量并按层级顺序返回', () => {
	const parent = createTask('3-任务/项目A/父任务.md', '父任务');
	const childA = createTask('3-任务/项目A/子任务A.md', '子任务A', ['父任务']);
	const childB = createTask('3-任务/项目A/子任务B.md', '子任务B', ['父任务']);
	const grandChild = createTask(
		'3-任务/项目A/孙任务.md',
		'孙任务',
		['子任务A'],
	);

	const ordered = buildVisibleTaskHierarchy([
		parent,
		childA,
		grandChild,
		childB,
	]);
	const map = buildDirectChildTasksByParentPath(ordered);

	assert.deepEqual(
		(map.get(parent.path) ?? []).map((t) => t.path),
		[childA.path, childB.path],
	);
	assert.deepEqual(
		(map.get(childA.path) ?? []).map((t) => t.path),
		[grandChild.path],
	);
});

test('指向不存在父任务的 UpTask 会被忽略', () => {
	const parent = createTask('3-任务/项目A/父任务.md', '父任务');
	const child = createTask('3-任务/项目A/子任务.md', '子任务', ['不存在的父任务']);

	const ordered = buildVisibleTaskHierarchy([parent, child]);
	const map = buildDirectChildTasksByParentPath(ordered);

	assert.equal(map.get(parent.path)?.length ?? 0, 0);
});

