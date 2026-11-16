import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限「创建任务」类型选项单测（[[Plan-20261116-154231]] §5.7）。
// 语言要在 import 之前定好：`t()` 现读 window.localStorage 的 language。
globalThis.window = globalThis;
globalThis.localStorage = {
	getItem: (key) => (key === 'language' ? 'en' : null),
};

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { resolveQuadrantTaskTypeOptions } = await jiti.import(
	'../src/views/quadrant/create-task-type-options.ts',
);
const { t } = await jiti.import('../src/lang/helpter.ts');

const keysOf = (options) => options.map((option) => option.key);

test('空配置：回退到四类，按固定顺序', () => {
	assert.deepEqual(keysOf(resolveQuadrantTaskTypeOptions([])), [
		'normal',
		'date',
		'topic',
		'plan',
	]);
});

test('全非法值：回退到四类', () => {
	assert.deepEqual(keysOf(resolveQuadrantTaskTypeOptions(['bogus'])), [
		'normal',
		'date',
		'topic',
		'plan',
	]);
});

test('子集：按固定顺序而非配置顺序', () => {
	assert.deepEqual(
		keysOf(resolveQuadrantTaskTypeOptions(['plan', 'normal'])),
		['normal', 'plan'],
	);
});

test('混入非法值：只保留合法项', () => {
	assert.deepEqual(
		keysOf(resolveQuadrantTaskTypeOptions(['unknown', 'date'])),
		['date'],
	);
});

test('单类型：只返回一项', () => {
	const options = resolveQuadrantTaskTypeOptions(['topic']);
	assert.equal(options.length, 1);
	assert.equal(options[0].key, 'topic');
});

test('label 使用本地化文案', () => {
	const [option] = resolveQuadrantTaskTypeOptions(['normal']);
	assert.equal(option.label, t('task.type.normal'));
});
