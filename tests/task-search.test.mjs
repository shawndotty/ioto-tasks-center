import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	filterTasksBySearchQuery,
	matchesTaskSearchQuery,
	normalizeTaskSearchQuery,
} = await jiti.import('../src/views/task-search.ts');

function createTask(title, basename = title) {
	return {
		name: `${basename}.md`,
		basename,
		title,
		path: `3-任务/项目A/${basename}.md`,
		mtime: 0,
		ctime: 0,
		size: 0,
		status: {
			key: 'todo',
			label: '待开始',
			totalTaskCount: 0,
			completedTaskCount: 0,
			summary: '未识别到复选框任务',
		},
		upTaskTitles: [],
	};
}

test('空关键词会被归一化为空字符串', () => {
	assert.equal(normalizeTaskSearchQuery('   '), '');
});

test('搜索会去掉首尾空白并转为小写', () => {
	assert.equal(normalizeTaskSearchQuery('  Release  '), 'release');
});

test('空关键词不过滤任务列表', () => {
	const tasks = [createTask('任务A'), createTask('任务B')];
	assert.deepEqual(filterTasksBySearchQuery(tasks, '   '), tasks);
});

test('中文文件名可以匹配', () => {
	assert.equal(matchesTaskSearchQuery(createTask('发布复盘'), '复盘'), true);
});

test('英文匹配大小写不敏感', () => {
	assert.equal(
		matchesTaskSearchQuery(createTask('Release Notes'), 'release'),
		true,
	);
});

test('特殊字符按普通字符匹配', () => {
	assert.equal(
		matchesTaskSearchQuery(createTask('项目A-v2.0'), 'v2.0'),
		true,
	);
});

test('搜索结果只过滤不改变原有顺序', () => {
	const tasks = [
		createTask('发布方案'),
		createTask('项目A-发布复盘'),
		createTask('发布检查清单'),
	];

	assert.deepEqual(
		filterTasksBySearchQuery(tasks, '发布').map((task) => task.title),
		['发布方案', '项目A-发布复盘', '发布检查清单'],
	);
});

test('仅匹配到文件名不含关键词的任务会被排除', () => {
	const tasks = [createTask('设计方案'), createTask('发布复盘')];

	assert.deepEqual(
		filterTasksBySearchQuery(tasks, '复盘').map((task) => task.title),
		['发布复盘'],
	);
});
