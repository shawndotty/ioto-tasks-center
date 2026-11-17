import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限视图状态解析单测（[[Plan-20261116-060249]] §四 S1）。
// `constants.ts` 无 obsidian 运行时依赖，照 `quadrant-model.test.mjs` 的 jiti 直载范式。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { mergeQuadrantViewState, parseQuadrantViewState } = await jiti.import(
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

// mergeQuadrantViewState（[[Plan-20261116-102615]] §3.1 / §6.1）。
const CURRENT_STATE = {
	sidebarOpen: true,
	timeFilter: { kind: 'preset', value: 'updated-week' },
	statusKeys: ['in-progress', 'todo'],
	typeKeys: ['normal', 'date', 'topic', 'plan'],
	projectScope: { kind: 'project', projectName: 'IOTO Task Center' },
};

test('mergeQuadrantViewState：空 parsed → 字段原样保留且为新引用', () => {
	const merged = mergeQuadrantViewState(CURRENT_STATE, {});
	assert.deepEqual(merged, CURRENT_STATE);
	assert.notEqual(merged.statusKeys, CURRENT_STATE.statusKeys);
});

test('mergeQuadrantViewState：statusKeys 空数组保留（全不选）', () => {
	assert.deepEqual(mergeQuadrantViewState(CURRENT_STATE, { statusKeys: [] }), {
		...CURRENT_STATE,
		statusKeys: [],
	});
});

test('mergeQuadrantViewState：statusKeys 显式值覆盖当前', () => {
	assert.deepEqual(
		mergeQuadrantViewState(CURRENT_STATE, { statusKeys: ['completed'] }),
		{ ...CURRENT_STATE, statusKeys: ['completed'] },
	);
});

test('mergeQuadrantViewState：sidebarOpen=false 显式覆盖 true', () => {
	assert.equal(
		mergeQuadrantViewState(CURRENT_STATE, { sidebarOpen: false }).sidebarOpen,
		false,
	);
});

test('mergeQuadrantViewState：timeFilter none 覆盖旧预设，缺失保留', () => {
	assert.deepEqual(
		mergeQuadrantViewState(CURRENT_STATE, { timeFilter: { kind: 'none' } })
			.timeFilter,
		{ kind: 'none' },
	);
	assert.deepEqual(
		mergeQuadrantViewState(CURRENT_STATE, {}).timeFilter,
		CURRENT_STATE.timeFilter,
	);
});

test('mergeQuadrantViewState：与 parse 组合，全不选 + 全部时间不被默认回填', () => {
	const parsed = parseQuadrantViewState({
		statusKeys: [],
		timeFilter: 'none',
	});
	assert.deepEqual(mergeQuadrantViewState(CURRENT_STATE, parsed), {
		sidebarOpen: true,
		timeFilter: { kind: 'none' },
		statusKeys: [],
		typeKeys: CURRENT_STATE.typeKeys,
		projectScope: CURRENT_STATE.projectScope,
	});
});

// projectScope 持久化（[[Plan-20261116-161225]] §三 步骤 2 / 步骤 5）。
test('parseQuadrantViewState：projectScope 三种 kind 原样还原', () => {
	assert.deepEqual(parseQuadrantViewState({ projectScope: 'all' }), {
		projectScope: { kind: 'all' },
	});
	assert.deepEqual(parseQuadrantViewState({ projectScope: 'unarchived' }), {
		projectScope: { kind: 'unarchived' },
	});
	assert.deepEqual(
		parseQuadrantViewState({ projectScope: 'project:IOTO Task Center' }),
		{ projectScope: { kind: 'project', projectName: 'IOTO Task Center' } },
	);
});

test('parseQuadrantViewState：含冒号的 projectName 原样还原', () => {
	assert.deepEqual(
		parseQuadrantViewState({ projectScope: 'project:a:b:c' }),
		{ projectScope: { kind: 'project', projectName: 'a:b:c' } },
	);
});

test('parseQuadrantViewState：缺 projectScope 键 → 不带该字段', () => {
	assert.deepEqual(parseQuadrantViewState({}), {});
	assert.deepEqual(parseQuadrantViewState({ sidebarOpen: true }), {
		sidebarOpen: true,
	});
});

test('parseQuadrantViewState：脏 projectScope 一律丢弃（不回落未归档）', () => {
	for (const value of [42, '', 'bogus', 'project:', null, {}, true, []]) {
		const parsed = parseQuadrantViewState({ projectScope: value });
		assert.equal('projectScope' in parsed, false);
	}
});

test('parseQuadrantViewState：projectScope 与其它字段共存', () => {
	assert.deepEqual(
		parseQuadrantViewState({
			sidebarOpen: false,
			timeFilter: 'preset:updated-week',
			statusKeys: ['todo'],
			projectScope: 'project:IOTO Task Center',
		}),
		{
			sidebarOpen: false,
			timeFilter: { kind: 'preset', value: 'updated-week' },
			statusKeys: ['todo'],
			projectScope: { kind: 'project', projectName: 'IOTO Task Center' },
		},
	);
});

test('mergeQuadrantViewState：projectScope 缺失保留当前，给出时覆盖', () => {
	assert.deepEqual(
		mergeQuadrantViewState(CURRENT_STATE, {}).projectScope,
		CURRENT_STATE.projectScope,
	);
	assert.deepEqual(
		mergeQuadrantViewState(CURRENT_STATE, {
			projectScope: { kind: 'all' },
		}).projectScope,
		{ kind: 'all' },
	);
	assert.deepEqual(
		mergeQuadrantViewState(CURRENT_STATE, {
			projectScope: { kind: 'unarchived' },
		}).projectScope,
		{ kind: 'unarchived' },
	);
});

test('mergeQuadrantViewState：projectScope 与 statusKeys 空数组共存', () => {
	const merged = mergeQuadrantViewState(CURRENT_STATE, { statusKeys: [] });
	assert.deepEqual(merged.statusKeys, []);
	assert.deepEqual(merged.projectScope, CURRENT_STATE.projectScope);
});

test('mergeQuadrantViewState：脏 parsed.projectScope 不存在时保留兜底', () => {
	const parsed = parseQuadrantViewState({ projectScope: 42 });
	const merged = mergeQuadrantViewState(CURRENT_STATE, parsed);
	assert.deepEqual(merged.projectScope, CURRENT_STATE.projectScope);
});

test('parseQuadrantViewState：projectScope getState(encode) → parse 往返一致', () => {
	const scopes = [
		{ kind: 'all' },
		{ kind: 'unarchived' },
		{ kind: 'project', projectName: 'IOTO Task Center' },
		{ kind: 'project', projectName: '含:冒号的 项目' },
	];
	for (const scope of scopes) {
		const encoded =
			scope.kind === 'project'
				? `project:${scope.projectName}`
				: scope.kind;
		assert.deepEqual(
			parseQuadrantViewState({ projectScope: encoded }).projectScope,
			scope,
		);
	}
});

// previewLeafId（[[Plan-20261116-155634]] §5.4 / §6.3）：与筛选状态分开解析。
test('parseQuadrantViewState：合法 previewLeafId 保留', () => {
	assert.deepEqual(parseQuadrantViewState({ previewLeafId: 'leaf-1' }), {
		previewLeafId: 'leaf-1',
	});
});

test('parseQuadrantViewState：空串 / 非字符串 previewLeafId 一律丢弃', () => {
	for (const value of ['', 42, null, undefined, [], {}, true]) {
		assert.deepEqual(parseQuadrantViewState({ previewLeafId: value }), {});
	}
});

test('parseQuadrantViewState：previewLeafId 与筛选字段共存', () => {
	assert.deepEqual(
		parseQuadrantViewState({
			sidebarOpen: true,
			statusKeys: ['todo'],
			previewLeafId: 'leaf-1',
		}),
		{ sidebarOpen: true, statusKeys: ['todo'], previewLeafId: 'leaf-1' },
	);
});

test('mergeQuadrantViewState：previewLeafId 不进入筛选合并', () => {
	const merged = mergeQuadrantViewState(CURRENT_STATE, { previewLeafId: 'x' });
	assert.deepEqual(merged, CURRENT_STATE);
	assert.equal('previewLeafId' in merged, false);
});

// openedTaskPath（[[Plan-20261117-062052]] §5.5 / §6.2）：与 previewLeafId 同口径。
test('parseQuadrantViewState：合法 openedTaskPath 保留', () => {
	assert.deepEqual(
		parseQuadrantViewState({ openedTaskPath: '3-任务/P/T.md' }),
		{ openedTaskPath: '3-任务/P/T.md' },
	);
});

test('parseQuadrantViewState：空串 / 非字符串 openedTaskPath 一律丢弃', () => {
	for (const value of ['', 42, null, undefined, [], {}, true]) {
		assert.deepEqual(parseQuadrantViewState({ openedTaskPath: value }), {});
	}
});

test('parseQuadrantViewState：openedTaskPath 与筛选字段及 previewLeafId 共存', () => {
	assert.deepEqual(
		parseQuadrantViewState({
			sidebarOpen: true,
			statusKeys: ['todo'],
			previewLeafId: 'leaf-1',
			openedTaskPath: '3-任务/P/T.md',
		}),
		{
			sidebarOpen: true,
			statusKeys: ['todo'],
			previewLeafId: 'leaf-1',
			openedTaskPath: '3-任务/P/T.md',
		},
	);
});

test('mergeQuadrantViewState：openedTaskPath 不进入筛选合并', () => {
	const merged = mergeQuadrantViewState(CURRENT_STATE, {
		openedTaskPath: 'x',
	});
	assert.deepEqual(merged, CURRENT_STATE);
	assert.equal('openedTaskPath' in merged, false);
});

test('parseQuadrantViewState：openedTaskPath 全空输入保持 {}', () => {
	assert.deepEqual(parseQuadrantViewState({}), {});
	assert.deepEqual(parseQuadrantViewState(null), {});
});

// typeKeys 持久化（[[Plan-20261117-085118]] §5.6 / §6.4）。
test('parseQuadrantViewState：typeKeys 白名单数组保留并去重', () => {
	assert.deepEqual(parseQuadrantViewState({ typeKeys: ['plan'] }), {
		typeKeys: ['plan'],
	});
	assert.deepEqual(
		parseQuadrantViewState({ typeKeys: ['plan', 'plan', 'date'] }),
		{ typeKeys: ['plan', 'date'] },
	);
});

test('parseQuadrantViewState：typeKeys 空数组合法（全不选）', () => {
	assert.deepEqual(parseQuadrantViewState({ typeKeys: [] }), { typeKeys: [] });
});

test('parseQuadrantViewState：typeKeys 脏值被过滤，全脏不带字段', () => {
	assert.deepEqual(parseQuadrantViewState({ typeKeys: ['plan', 'bogus', 1] }), {
		typeKeys: ['plan'],
	});
	assert.deepEqual(parseQuadrantViewState({ typeKeys: ['bogus'] }), {});
});

test('parseQuadrantViewState：typeKeys 非数组一律忽略', () => {
	for (const value of ['plan', 42, null, {}, true]) {
		assert.deepEqual(parseQuadrantViewState({ typeKeys: value }), {});
	}
});

test('parseQuadrantViewState：typeKeys 与四字段共存互不影响', () => {
	assert.deepEqual(
		parseQuadrantViewState({
			sidebarOpen: false,
			timeFilter: 'preset:updated-week',
			statusKeys: ['todo'],
			typeKeys: ['plan'],
			projectScope: 'project:IOTO Task Center',
		}),
		{
			sidebarOpen: false,
			timeFilter: { kind: 'preset', value: 'updated-week' },
			statusKeys: ['todo'],
			typeKeys: ['plan'],
			projectScope: { kind: 'project', projectName: 'IOTO Task Center' },
		},
	);
});

test('parseQuadrantViewState：typeKeys getState(数组) → parse 往返一致', () => {
	for (const keys of [[], ['plan'], ['normal', 'date', 'topic', 'plan']]) {
		assert.deepEqual(parseQuadrantViewState({ typeKeys: keys }).typeKeys, keys);
	}
});

test('mergeQuadrantViewState：typeKeys 缺失保留当前，空数组保留全不选', () => {
	const merged = mergeQuadrantViewState(CURRENT_STATE, {});
	assert.deepEqual(merged.typeKeys, CURRENT_STATE.typeKeys);
	assert.notEqual(merged.typeKeys, CURRENT_STATE.typeKeys);
	assert.deepEqual(mergeQuadrantViewState(CURRENT_STATE, { typeKeys: [] }).typeKeys, []);
	assert.deepEqual(
		mergeQuadrantViewState(CURRENT_STATE, { typeKeys: ['plan'] }).typeKeys,
		['plan'],
	);
});

