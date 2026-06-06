import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { normalizeEnabledTaskCreationTypes } = await jiti.import(
	'../src/tasks-center/enabled-task-creation-types.ts',
);

test('normalizeEnabledTaskCreationTypes: 非法输入回退为默认四种', () => {
	assert.deepEqual(normalizeEnabledTaskCreationTypes(null), [
		'normal',
		'date',
		'topic',
		'plan',
	]);
	assert.deepEqual(normalizeEnabledTaskCreationTypes(undefined), [
		'normal',
		'date',
		'topic',
		'plan',
	]);
	assert.deepEqual(normalizeEnabledTaskCreationTypes('normal'), [
		'normal',
		'date',
		'topic',
		'plan',
	]);
	assert.deepEqual(normalizeEnabledTaskCreationTypes([]), [
		'normal',
		'date',
		'topic',
		'plan',
	]);
});

test('normalizeEnabledTaskCreationTypes: 过滤非法值并去重排序', () => {
	assert.deepEqual(
		normalizeEnabledTaskCreationTypes([
			'topic',
			'unknown',
			'topic',
			'date',
			'plan',
		]),
		['date', 'topic', 'plan'],
	);
});
