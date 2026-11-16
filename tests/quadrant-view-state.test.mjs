import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限视图状态解析单测（[[Plan-20261116-060249]] §四 S1）。
// `constants.ts` 无 obsidian 运行时依赖，照 `quadrant-model.test.mjs` 的 jiti 直载范式。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { parseQuadrantViewState } = await jiti.import(
	'../src/views/quadrant/constants.ts',
);
const { encodeQuadrantTimeFilter, decodeQuadrantTimeFilter } = await jiti.import(
	'../src/tasks-center/task-time-range.ts',
);

test('parseQuadrantViewState：非对象输入一律回 {}', () => {
	for (const input of [null, undefined, 'x', 42, [], true]) {
		assert.deepEqual(parseQuadrantViewState(input), {});
	}
});

test('parseQuadrantViewState：无 sidebarOpen 回 {}', () => {
	assert.deepEqual(parseQuadrantViewState({}), {});
	assert.deepEqual(parseQuadrantViewState({ file: 'a.md' }), {});
});

test('parseQuadrantViewState：boolean 原样返回', () => {
	assert.deepEqual(parseQuadrantViewState({ sidebarOpen: true }), {
		sidebarOpen: true,
	});
	assert.deepEqual(parseQuadrantViewState({ sidebarOpen: false }), {
		sidebarOpen: false,
	});
});

test('parseQuadrantViewState：非 boolean 一律忽略', () => {
	for (const value of ['true', 'false', 1, 0, null, {}, []]) {
		assert.deepEqual(parseQuadrantViewState({ sidebarOpen: value }), {});
	}
});

test('parseQuadrantViewState：多余字段被丢弃', () => {
	assert.deepEqual(
		parseQuadrantViewState({
			file: 'a.md',
			sidebarOpen: true,
			collapsedSections: ['x'],
		}),
		{ sidebarOpen: true },
	);
});

test('parseQuadrantViewState：sidebarOpen 与 timeFilter 同时解析', () => {
	assert.deepEqual(
		parseQuadrantViewState({
			sidebarOpen: true,
			timeFilter: 'preset:updated-week',
		}),
		{ sidebarOpen: true, timeFilter: { kind: 'preset', value: 'updated-week' } },
	);
	assert.deepEqual(
		parseQuadrantViewState({
			sidebarOpen: false,
			timeFilter: 'custom:created:2026-10-01:2026-10-31',
		}),
		{
			sidebarOpen: false,
			timeFilter: {
				kind: 'custom',
				field: 'created',
				start: '2026-10-01',
				end: '2026-10-31',
			},
		},
	);
});

test('parseQuadrantViewState：脏 timeFilter 回落 none，不抛错', () => {
	for (const value of [42, null, {}, 'preset:nope', 'custom:created:2026-02-30:']) {
		assert.deepEqual(parseQuadrantViewState({ timeFilter: value }), {
			timeFilter: { kind: 'none' },
		});
	}
});

test('parseQuadrantViewState：getState → parse 往返一致', () => {
	const filters = [
		{ kind: 'none' },
		{ kind: 'preset', value: 'created-calendar-month' },
		{ kind: 'custom', field: 'updated', start: '2026-10-01', end: '' },
	];
	for (const filter of filters) {
		const state = {
			sidebarOpen: true,
			timeFilter: encodeQuadrantTimeFilter(filter),
		};
		assert.deepEqual(parseQuadrantViewState(state).timeFilter, filter);
		assert.deepEqual(
			decodeQuadrantTimeFilter(state.timeFilter),
			parseQuadrantViewState(state).timeFilter,
		);
	}
});

// statusKeys 持久化（[[Plan-20261116-091927]] §四 S1）。
test('parseQuadrantViewState：缺 statusKeys 键 → 不带该字段（回落默认）', () => {
	assert.deepEqual(parseQuadrantViewState({}), {});
	assert.deepEqual(parseQuadrantViewState({ sidebarOpen: true }), {
		sidebarOpen: true,
	});
});

test('parseQuadrantViewState：statusKeys 白名单数组原样保留', () => {
	assert.deepEqual(parseQuadrantViewState({ statusKeys: ['todo'] }), {
		statusKeys: ['todo'],
	});
	assert.deepEqual(
		parseQuadrantViewState({ statusKeys: ['completed', 'in-progress', 'todo'] }),
		{ statusKeys: ['completed', 'in-progress', 'todo'] },
	);
});

test('parseQuadrantViewState：statusKeys 去重', () => {
	assert.deepEqual(parseQuadrantViewState({ statusKeys: ['todo', 'todo'] }), {
		statusKeys: ['todo'],
	});
});

test('parseQuadrantViewState：空数组合法（全不选）', () => {
	assert.deepEqual(parseQuadrantViewState({ statusKeys: [] }), {
		statusKeys: [],
	});
});

test('parseQuadrantViewState：脏值被过滤，全脏回落默认', () => {
	assert.deepEqual(parseQuadrantViewState({ statusKeys: ['todo', 'bogus', 1] }), {
		statusKeys: ['todo'],
	});
	assert.deepEqual(parseQuadrantViewState({ statusKeys: ['bogus'] }), {});
});

test('parseQuadrantViewState：statusKeys 非数组一律忽略', () => {
	for (const value of ['todo', 42, null, {}, true]) {
		assert.deepEqual(parseQuadrantViewState({ statusKeys: value }), {});
	}
});

test('parseQuadrantViewState：statusKeys 与既有字段共存', () => {
	assert.deepEqual(
		parseQuadrantViewState({ sidebarOpen: true, statusKeys: ['todo'] }),
		{ sidebarOpen: true, statusKeys: ['todo'] },
	);
	assert.deepEqual(
		parseQuadrantViewState({
			sidebarOpen: false,
			timeFilter: 'preset:updated-week',
			statusKeys: ['completed'],
		}),
		{
			sidebarOpen: false,
			timeFilter: { kind: 'preset', value: 'updated-week' },
			statusKeys: ['completed'],
		},
	);
});

test('parseQuadrantViewState：statusKeys getState(数组) → parse 往返一致', () => {
	for (const keys of [[], ['todo'], ['completed', 'in-progress', 'todo']]) {
		const state = { statusKeys: keys };
		assert.deepEqual(parseQuadrantViewState(state).statusKeys, keys);
	}
});
