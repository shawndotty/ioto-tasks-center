import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 任务笔记打开模式判定矩阵（[[Plan-20261116-155634]] §6.1）。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { resolveTaskNoteOpenMode } = await jiti.import(
	'../src/views/tasks-center/task-note-opening.ts',
);

function input(overrides = {}) {
	return {
		hasSearchQuery: false,
		hasLine: false,
		cursorOffset: null,
		preferTaskView: false,
		isTaskNote: false,
		...overrides,
	};
}

test('默认 + 非任务笔记：default', () => {
	assert.equal(resolveTaskNoteOpenMode(input()), 'default');
});

test('任务笔记 + 偏好任务视图：task-view', () => {
	assert.equal(
		resolveTaskNoteOpenMode(
			input({ preferTaskView: true, isTaskNote: true }),
		),
		'task-view',
	);
});

test('任务笔记但未开启偏好：default', () => {
	assert.equal(
		resolveTaskNoteOpenMode(
			input({ preferTaskView: false, isTaskNote: true }),
		),
		'default',
	);
});

test('有 cursorOffset（0 也合法）：source', () => {
	assert.equal(resolveTaskNoteOpenMode(input({ cursorOffset: 0 })), 'source');
	assert.equal(resolveTaskNoteOpenMode(input({ cursorOffset: 12 })), 'source');
});

test('有搜索词：source', () => {
	assert.equal(
		resolveTaskNoteOpenMode(input({ hasSearchQuery: true })),
		'source',
	);
});

test('指定行：source', () => {
	assert.equal(resolveTaskNoteOpenMode(input({ hasLine: true })), 'source');
});

test('光标优先于任务视图偏好：source', () => {
	assert.equal(
		resolveTaskNoteOpenMode(
			input({
				cursorOffset: 3,
				preferTaskView: true,
				isTaskNote: true,
			}),
		),
		'source',
	);
});
