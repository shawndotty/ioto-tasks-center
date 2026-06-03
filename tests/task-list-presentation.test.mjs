import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { moment } from 'obsidian';

moment.locale('en');
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildTaskPresentationSections,
	groupTasksForPresentation,
	sortTasksForPresentation,
} = await jiti.import('../src/views/task-list-presentation.ts');

function createTask(title, options = {}) {
	return {
		name: `${title}.md`,
		basename: options.basename ?? title,
		title,
		path: `3-任务/项目A/${title}.md`,
		mtime: options.mtime ?? 0,
		ctime: options.ctime ?? 0,
		size: options.size ?? 0,
		priority: options.priority,
		status: options.status ?? {
			key: 'todo',
			label: 'To do',
			totalTaskCount: 0,
			completedTaskCount: 0,
			summary: 'No checkbox tasks detected',
		},
		upTaskTitles: options.upTaskTitles ?? [],
	};
}

test('默认排序可按创建时间从新到旧排列', () => {
	const tasks = [
		createTask('任务A', { ctime: 10 }),
		createTask('任务B', { ctime: 30 }),
		createTask('任务C', { ctime: 20 }),
	];

	assert.deepEqual(
		sortTasksForPresentation(tasks, 'created-desc').map(
			(task) => task.title,
		),
		['任务B', '任务C', '任务A'],
	);
});

test('所有排序模式都可生效', () => {
	const tasks = [
		createTask('Beta', { basename: 'Beta', ctime: 20, mtime: 30 }),
		createTask('Alpha', { basename: 'Alpha', ctime: 10, mtime: 40 }),
		createTask('Gamma', { basename: 'Gamma', ctime: 30, mtime: 20 }),
	];

	assert.deepEqual(
		sortTasksForPresentation(tasks, 'created-asc').map(
			(task) => task.basename,
		),
		['Alpha', 'Beta', 'Gamma'],
	);
	assert.deepEqual(
		sortTasksForPresentation(tasks, 'updated-desc').map(
			(task) => task.basename,
		),
		['Alpha', 'Beta', 'Gamma'],
	);
	assert.deepEqual(
		sortTasksForPresentation(tasks, 'updated-asc').map(
			(task) => task.basename,
		),
		['Gamma', 'Beta', 'Alpha'],
	);
	assert.deepEqual(
		sortTasksForPresentation(tasks, 'name-asc').map(
			(task) => task.basename,
		),
		['Alpha', 'Beta', 'Gamma'],
	);
	assert.deepEqual(
		sortTasksForPresentation(tasks, 'name-desc').map(
			(task) => task.basename,
		),
		['Gamma', 'Beta', 'Alpha'],
	);
});

test('同时间戳时使用文件名稳定兜底', () => {
	const tasks = [
		createTask('任务B', { basename: '任务B', ctime: 100 }),
		createTask('任务A', { basename: '任务A', ctime: 100 }),
	];

	assert.deepEqual(
		sortTasksForPresentation(tasks, 'created-desc').map(
			(task) => task.basename,
		),
		['任务A', '任务B'],
	);
});

test('不分组时只返回单个 section', () => {
	const tasks = [createTask('任务A'), createTask('任务B')];

	assert.deepEqual(groupTasksForPresentation(tasks, 'none'), [
		{
			key: 'all',
			label: null,
			tasks,
		},
	]);
});

test('按任务状态分组时按既定顺序输出非空组', () => {
	const tasks = [
		createTask('已完成任务', {
			status: {
				key: 'completed',
				label: 'Completed',
				totalTaskCount: 1,
				completedTaskCount: 1,
				summary: '1/1 completed',
			},
		}),
		createTask('无任务项任务', {
			status: {
				key: 'empty',
				label: 'No tasks',
				totalTaskCount: 0,
				completedTaskCount: 0,
				summary: 'No checkbox tasks detected',
			},
		}),
		createTask('待开始任务'),
	];

	assert.deepEqual(
		groupTasksForPresentation(tasks, 'status').map(
			(section) => section.key,
		),
		['todo', 'completed', 'empty'],
	);
	assert.deepEqual(
		groupTasksForPresentation(tasks, 'status').map(
			(section) => section.label,
		),
		['To do', 'Completed', 'No tasks'],
	);
});

test('构建 section 时会先排序再分组，组内顺序正确', () => {
	const tasks = [
		createTask('任务1', {
			ctime: 10,
			status: {
				key: 'todo',
				label: 'To do',
				totalTaskCount: 1,
				completedTaskCount: 0,
				summary: '1 pending',
			},
		}),
		createTask('任务2', {
			ctime: 30,
			status: {
				key: 'todo',
				label: 'To do',
				totalTaskCount: 1,
				completedTaskCount: 0,
				summary: '1 pending',
			},
		}),
		createTask('任务3', {
			ctime: 20,
			status: {
				key: 'completed',
				label: 'Completed',
				totalTaskCount: 1,
				completedTaskCount: 1,
				summary: '1/1 completed',
			},
		}),
	];

	const sections = buildTaskPresentationSections(tasks, {
		sortMode: 'created-desc',
		groupMode: 'status',
	});
	assert.deepEqual(
		sections.map((section) => section.key),
		['todo', 'completed'],
	);
	assert.deepEqual(
		sections[0]?.tasks.map((task) => task.title),
		['任务2', '任务1'],
	);
	assert.deepEqual(
		sections[1]?.tasks.map((task) => task.title),
		['任务3'],
	);
});

test('排序不会原地修改输入数组', () => {
	const tasks = [
		createTask('任务A', { ctime: 10 }),
		createTask('任务B', { ctime: 20 }),
	];
	const originalOrder = tasks.map((task) => task.title);

	sortTasksForPresentation(tasks, 'created-desc');

	assert.deepEqual(
		tasks.map((task) => task.title),
		originalOrder,
	);
});

test('优先级高到低排序会让高优先级在前，未设置优先级在最后', () => {
	const tasks = [
		createTask('任务A', { priority: 2 }),
		createTask('任务B', { priority: 0 }),
		createTask('任务C'),
		createTask('任务D', { priority: 1 }),
	];

	assert.deepEqual(
		sortTasksForPresentation(tasks, 'priority-desc').map(
			(task) => task.title,
		),
		['任务B', '任务D', '任务A', '任务C'],
	);
});

test('优先级低到高排序会让低优先级在前，未设置优先级在最后', () => {
	const tasks = [
		createTask('任务A', { priority: 1 }),
		createTask('任务B', { priority: 4 }),
		createTask('任务C'),
		createTask('任务D', { priority: 2 }),
	];

	assert.deepEqual(
		sortTasksForPresentation(tasks, 'priority-asc').map(
			(task) => task.title,
		),
		['任务B', '任务D', '任务A', '任务C'],
	);
});

test('按优先级分组时会生成优先级组和未设置优先级组', () => {
	const tasks = [
		createTask('任务A', { priority: 1 }),
		createTask('任务B'),
		createTask('任务C', { priority: 0 }),
	];

	const sections = groupTasksForPresentation(
		tasks,
		'priority',
		'priority-desc',
	);
	assert.deepEqual(
		sections.map((section) => section.key),
		['priority-0', 'priority-1', 'priority-unset'],
	);
	assert.deepEqual(
		sections.map((section) => section.label),
		['P0', 'P1', 'Priority not set'],
	);
});

test('按优先级分组时，分组顺序跟随优先级排序方向', () => {
	const tasks = [
		createTask('任务A', { priority: 1 }),
		createTask('任务B', { priority: 3 }),
		createTask('任务C', { priority: 0 }),
		createTask('任务D'),
	];

	const descSections = buildTaskPresentationSections(tasks, {
		sortMode: 'priority-desc',
		groupMode: 'priority',
	});
	assert.deepEqual(
		descSections.map((section) => section.key),
		['priority-0', 'priority-1', 'priority-3', 'priority-unset'],
	);

	const ascSections = buildTaskPresentationSections(tasks, {
		sortMode: 'priority-asc',
		groupMode: 'priority',
	});
	assert.deepEqual(
		ascSections.map((section) => section.key),
		['priority-3', 'priority-1', 'priority-0', 'priority-unset'],
	);
});

test('当按优先级分组但当前不是优先级排序时，分组顺序默认高到低', () => {
	const tasks = [
		createTask('任务A', { priority: 3, ctime: 10 }),
		createTask('任务B', { priority: 0, ctime: 30 }),
		createTask('任务C', { priority: 1, ctime: 20 }),
		createTask('任务D'),
	];

	const sections = buildTaskPresentationSections(tasks, {
		sortMode: 'created-desc',
		groupMode: 'priority',
	});

	assert.deepEqual(
		sections.map((section) => section.key),
		['priority-0', 'priority-1', 'priority-3', 'priority-unset'],
	);
});

test('按优先级分组时，组内任务仍遵循当前排序模式', () => {
	const tasks = [
		createTask('任务A', { priority: 1, ctime: 10 }),
		createTask('任务B', { priority: 1, ctime: 30 }),
		createTask('任务C', { priority: 0, ctime: 20 }),
	];

	const sections = buildTaskPresentationSections(tasks, {
		sortMode: 'created-desc',
		groupMode: 'priority',
	});

	assert.deepEqual(
		sections[1]?.tasks.map((task) => task.title),
		['任务B', '任务A'],
	);
});
