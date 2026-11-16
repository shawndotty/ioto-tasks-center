import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限视图状态解析单测（[[Plan-20261116-060249]] §四 S1）。
// `constants.ts` 无 obsidian 运行时依赖，照 `quadrant-model.test.mjs` 的 jiti 直载范式。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { parseQuadrantViewState } = await jiti.import(
	'../src/views/quadrant/constants.ts',
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
