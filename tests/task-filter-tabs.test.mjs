import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	getTaskFilterTabs,
	getTaskFilterCounts,
	isTaskCreatedToday,
	isTaskFilterTab,
	matchesTaskFilterTab,
	normalizeHiddenTaskFilterTabs,
	resolveActiveTaskFilterTab,
	resolveVisibleTaskFilterTabs,
	setTaskFilterTabVisible,
} = await jiti.import('../src/views/task-filter-tabs.ts');

function createTask(title, options = {}) {
	return {
		name: `${title}.md`,
		basename: title,
		title,
		path: `3-任务/项目A/${title}.md`,
		mtime: options.mtime ?? 0,
		ctime: options.ctime ?? 0,
		size: options.size ?? 0,
		starred: options.starred ?? false,
		status: options.status ?? {
			key: 'todo',
			label: '待开始',
			totalTaskCount: 0,
			completedTaskCount: 0,
			summary: '未识别到复选框任务',
		},
		upTaskTitles: options.upTaskTitles ?? [],
	};
}

const TODAY = new Date(2026, 4, 30, 10, 0, 0);

test('today 是合法的任务筛选 tab', () => {
	assert.equal(isTaskFilterTab('today'), true);
});

test('core 是合法的任务筛选 tab', () => {
	assert.equal(isTaskFilterTab('core'), true);
});

test('任务筛选 tab 默认顺序以 core 开头', () => {
	assert.deepEqual(
		getTaskFilterTabs().map((tab) => tab.key),
		['core', 'today', 'incomplete', 'completed', 'all'],
	);
});

test('今天创建的任务会匹配 today tab', () => {
	const task = createTask('今天任务', {
		ctime: new Date(2026, 4, 30, 8, 30, 0).getTime(),
	});

	assert.equal(isTaskCreatedToday(task, TODAY), true);
	assert.equal(matchesTaskFilterTab(task, 'today', TODAY), true);
});

test('非今天创建的任务不会匹配 today tab', () => {
	const task = createTask('昨天任务', {
		ctime: new Date(2026, 4, 29, 23, 59, 59).getTime(),
	});

	assert.equal(isTaskCreatedToday(task, TODAY), false);
	assert.equal(matchesTaskFilterTab(task, 'today', TODAY), false);
});

test('Starred 为 true 的任务会匹配 core tab', () => {
	const task = createTask('核心任务', {
		starred: true,
	});

	assert.equal(matchesTaskFilterTab(task, 'core', TODAY), true);
});

test('Starred 为 false 的任务不会匹配 core tab', () => {
	const task = createTask('普通任务');

	assert.equal(matchesTaskFilterTab(task, 'core', TODAY), false);
});

test('today tab 计数只统计今天创建的任务', () => {
	const tasks = [
		createTask('今天任务A', {
			ctime: new Date(2026, 4, 30, 8, 0, 0).getTime(),
		}),
		createTask('今天任务B', {
			ctime: new Date(2026, 4, 30, 18, 0, 0).getTime(),
			status: {
				key: 'completed',
				label: '已完成',
				totalTaskCount: 1,
				completedTaskCount: 1,
				summary: '1/1 项已完成',
			},
		}),
		createTask('昨天任务', {
			ctime: new Date(2026, 4, 29, 12, 0, 0).getTime(),
			starred: true,
		}),
	];

	assert.deepEqual(getTaskFilterCounts(tasks, TODAY), {
		today: 2,
		incomplete: 2,
		completed: 1,
		all: 3,
		core: 1,
	});
});

test('未配置隐藏名单时可见 tab 为全部 5 个且按注册表顺序', () => {
	assert.deepEqual(
		resolveVisibleTaskFilterTabs([]).map((tab) => tab.key),
		['core', 'today', 'incomplete', 'completed', 'all'],
	);
});

test('隐藏 core 后可见 tab 少一项且不含 core', () => {
	const visible = resolveVisibleTaskFilterTabs(['core']);

	assert.deepEqual(
		visible.map((tab) => tab.key),
		['today', 'incomplete', 'completed', 'all'],
	);
});

test('隐藏全部 tab 时兜底返回 core，绝不返回空数组', () => {
	const visible = resolveVisibleTaskFilterTabs([
		'core',
		'today',
		'incomplete',
		'completed',
		'all',
	]);

	assert.deepEqual(
		visible.map((tab) => tab.key),
		['core'],
	);
});

test('隐藏名单归一化会丢弃非法项、去重并按注册表排序', () => {
	assert.deepEqual(
		normalizeHiddenTaskFilterTabs(['core', 'core', '不存在', 123]),
		['core'],
	);
	assert.deepEqual(normalizeHiddenTaskFilterTabs(undefined), []);
	assert.deepEqual(
		normalizeHiddenTaskFilterTabs(['all', 'core', 'today']),
		['core', 'today', 'all'],
	);
});

test('隐藏名单归一化发现全部被隐藏时回落成空数组', () => {
	assert.deepEqual(
		normalizeHiddenTaskFilterTabs([
			'all',
			'completed',
			'incomplete',
			'today',
			'core',
		]),
		[],
	);
});

test('只剩一个可见 tab 时无法再关闭它', () => {
	assert.deepEqual(
		setTaskFilterTabVisible(['core', 'incomplete', 'completed', 'all'], 'today', false),
		['core', 'incomplete', 'completed', 'all'],
	);
});

test('切换单个 tab 可见性返回按注册表顺序的新名单', () => {
	assert.deepEqual(setTaskFilterTabVisible(['core'], 'today', false), [
		'core',
		'today',
	]);
	assert.deepEqual(setTaskFilterTabVisible(['core', 'today'], 'today', true), [
		'core',
	]);
});

test('激活 tab 不可见时回退到可见列表首项', () => {
	const visible = resolveVisibleTaskFilterTabs(['core', 'completed']);

	assert.equal(resolveActiveTaskFilterTab('completed', visible), 'today');
	assert.equal(resolveActiveTaskFilterTab('today', visible), 'today');
});
