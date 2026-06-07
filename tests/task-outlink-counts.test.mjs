import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { countTaskOutlinksByRootPaths, groupTaskOutlinksByRootPaths } =
	await jiti.import(
	'../src/tasks-center/task-outlink-counts.ts',
);

test('按目标笔记去重计数（忽略同一目标的多次链接）', () => {
	const resolvedLinks = {
		'1-输入/a.md': 3,
		'1-输入/b.md': 1,
		'2-输出/x.md': 2,
		'4-成果/y.md': 10,
	};

	assert.deepEqual(
		countTaskOutlinksByRootPaths(resolvedLinks, {
			inputRootPath: '1-输入',
			outputRootPath: '2-输出',
			outcomeRootPath: '4-成果',
		}),
		{ input: 2, output: 1, outcome: 1 },
	);
});

test('前缀匹配需要目录边界（rootx 不应命中 root）', () => {
	const resolvedLinks = {
		'1-输入/a.md': 1,
		'1-输入法/z.md': 1,
	};

	assert.deepEqual(
		countTaskOutlinksByRootPaths(resolvedLinks, {
			inputRootPath: '1-输入',
			outputRootPath: '2-输出',
			outcomeRootPath: '4-成果',
		}),
		{ input: 1, output: 0, outcome: 0 },
	);
});

test('空链接映射返回全 0', () => {
	assert.deepEqual(
		countTaskOutlinksByRootPaths(undefined, {
			inputRootPath: '1-输入',
			outputRootPath: '2-输出',
			outcomeRootPath: '4-成果',
		}),
		{ input: 0, output: 0, outcome: 0 },
	);
});

test('分组后的目标列表会按路径稳定排序', () => {
	const resolvedLinks = {
		'1-输入/10.md': 1,
		'1-输入/2.md': 1,
		'1-输入/1.md': 1,
	};

	assert.deepEqual(
		groupTaskOutlinksByRootPaths(resolvedLinks, {
			inputRootPath: '1-输入',
			outputRootPath: '2-输出',
			outcomeRootPath: '4-成果',
		}),
		{
			input: ['1-输入/1.md', '1-输入/2.md', '1-输入/10.md'],
			output: [],
			outcome: [],
		},
	);
});
