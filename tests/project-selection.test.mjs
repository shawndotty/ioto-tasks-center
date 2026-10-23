import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// helpers.ts 经 lang/helpter 间接 import 'obsidian'（moment），
// 与 tests/task-priority.test.mjs 同一条路径，无需 alias；
// 本函数不调用 t，运行期不会触碰 moment。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { findSelectedProjectEntry } = await jiti.import(
	'../src/views/tasks-center/helpers.ts',
);

const projects = [
	{ name: 'IOTO Task Center', path: '3-任务/IOTO Task Center' },
	{ name: 'OBDEV', path: '3-任务/OBDEV' },
];

test('命中时返回列表中的同一个对象（含 path）', () => {
	assert.equal(findSelectedProjectEntry(projects, 'OBDEV'), projects[1]);
});

test('selectedProject 为 null 时返回 null', () => {
	assert.equal(findSelectedProjectEntry(projects, null), null);
});

test('selectedProject 为空串时返回 null', () => {
	assert.equal(findSelectedProjectEntry(projects, ''), null);
});

test('项目不在列表中（已存档被过滤）时返回 null', () => {
	assert.equal(findSelectedProjectEntry(projects, '已存档的项目'), null);
});

test('空列表（加载中）时返回 null', () => {
	assert.equal(findSelectedProjectEntry([], 'OBDEV'), null);
});

test('按全名匹配，不做前缀命中', () => {
	assert.equal(
		findSelectedProjectEntry(
			[
				{ name: 'A', path: '3-任务/A' },
				{ name: 'AB', path: '3-任务/AB' },
			],
			'AB',
		)?.name,
		'AB',
	);
});
