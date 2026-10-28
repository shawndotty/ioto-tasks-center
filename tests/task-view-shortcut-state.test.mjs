/**
 * 「打开面板瞬间的状态」→ 高亮分组（[[Plan-20261028-142008]] §4.8）。
 *
 * 纯函数进单测；面板结构与滚动属交互，按项目既有约定（无 jsdom 基建）交给真机。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });

const {
	captureShortcutState,
	resolveCurrentShortcutGroupId,
} = await jiti.import('../src/views/ioto-task/task-view-shortcut-state.ts');
const { SHORTCUT_GROUPS } = await jiti.import(
	'../src/views/ioto-task/task-view-shortcut-spec.ts',
);

const base = {
	editingKind: null,
	zoomed: false,
	selected: false,
	deletePending: false,
	searchFocused: false,
};
const state = (patch = {}) => ({ ...base, ...patch });

test('优先级：待删除 > 搜索焦点 > 编辑态', () => {
	// 待删除压过一切
	assert.equal(
		resolveCurrentShortcutGroupId(
			state({ deletePending: true, searchFocused: true }),
		),
		'deleteConfirm',
	);
	assert.equal(
		resolveCurrentShortcutGroupId(
			state({ deletePending: true, editingKind: 'card', selected: true }),
		),
		'deleteConfirm',
	);
	// 搜索焦点压过编辑态
	assert.equal(
		resolveCurrentShortcutGroupId(
			state({ searchFocused: true, editingKind: 'continuation' }),
		),
		'search',
	);
});

test('三种编辑态各归各组（section-title 归 section）', () => {
	assert.equal(
		resolveCurrentShortcutGroupId(state({ editingKind: 'card' })),
		'editTitle',
	);
	assert.equal(
		resolveCurrentShortcutGroupId(state({ editingKind: 'continuation' })),
		'continuation',
	);
	assert.equal(
		resolveCurrentShortcutGroupId(state({ editingKind: 'section' })),
		'section',
	);
	assert.equal(
		resolveCurrentShortcutGroupId(state({ editingKind: 'section-title' })),
		'section',
	);
});

test('兜底：全假 → view；放大态即便选中也算 view', () => {
	assert.equal(resolveCurrentShortcutGroupId(state()), 'view');
	assert.equal(
		resolveCurrentShortcutGroupId(state({ selected: true })),
		'select',
	);
	assert.equal(
		resolveCurrentShortcutGroupId(state({ selected: true, zoomed: true })),
		'view',
	);
});

test('快照折字段：null 行号 → false，0 行号算「有」', () => {
	const inputEl = { id: 'search' };
	const docWith = { activeElement: inputEl };
	const docWithout = { activeElement: { id: 'body' } };

	const empty = captureShortcutState(
		{
			editingKind: null,
			zoomLine: null,
			selectedLine: null,
			pendingDeleteLine: null,
			searchInputEl: null,
		},
		docWith,
	);
	assert.deepEqual(empty, {
		editingKind: null,
		zoomed: false,
		selected: false,
		deletePending: false,
		searchFocused: false,
	});

	// 0 是合法首行：必须算「有」（防 truthy 判据回归）
	const zeroLines = captureShortcutState(
		{
			editingKind: null,
			zoomLine: 0,
			selectedLine: 0,
			pendingDeleteLine: 0,
			searchInputEl: inputEl,
		},
		docWithout,
	);
	assert.equal(zeroLines.zoomed, true);
	assert.equal(zeroLines.selected, true);
	assert.equal(zeroLines.deletePending, true);
	// 同一元素才算焦点
	assert.equal(zeroLines.searchFocused, false);
	assert.equal(
		captureShortcutState(
			{
				editingKind: null,
				zoomLine: null,
				selectedLine: null,
				pendingDeleteLine: null,
				searchInputEl: inputEl,
			},
			docWith,
		).searchFocused,
		true,
	);
});

test('覆盖性：每一组都能被至少一种状态产出（将来加组忘了加映射会红）', () => {
	const samples = [
		state(),
		state({ selected: true }),
		state({ deletePending: true }),
		state({ editingKind: 'card' }),
		state({ editingKind: 'continuation' }),
		state({ searchFocused: true }),
		state({ editingKind: 'section' }),
	];
	const produced = new Set(
		samples.map((sample) => resolveCurrentShortcutGroupId(sample)),
	);
	for (const group of SHORTCUT_GROUPS) {
		assert.ok(produced.has(group.id), `分组 "${group.id}" 无任何状态可产出`);
	}
});

test('类型契约：产出的 id 必须存在于 SHORTCUT_GROUPS', () => {
	const ids = new Set(SHORTCUT_GROUPS.map((group) => group.id));
	for (const sample of [
		state(),
		state({ selected: true }),
		state({ deletePending: true }),
		state({ editingKind: 'card' }),
		state({ editingKind: 'continuation' }),
		state({ editingKind: 'section' }),
		state({ editingKind: 'section-title' }),
		state({ searchFocused: true }),
		state({ selected: true, zoomed: true }),
	]) {
		const id = resolveCurrentShortcutGroupId(sample);
		assert.ok(ids.has(id), `产出了不存在的分组 id：${id}`);
	}
});
