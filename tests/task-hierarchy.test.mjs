import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { parseUpTaskFrontmatterValue } = await jiti.import(
	'../src/tasks-center/data.ts',
);
const { buildVisibleTaskHierarchy } = await jiti.import(
	'../src/views/task-hierarchy.ts',
);

function createTask(title, options = {}) {
	return {
		name: `${title}.md`,
		basename: title,
		title,
		path: options.path ?? `3-任务/项目A/${title}.md`,
		mtime: options.mtime ?? 0,
		ctime: options.ctime ?? 0,
		size: options.size ?? 0,
		status: {
			key: 'todo',
			label: '待开始',
			totalTaskCount: 0,
			completedTaskCount: 0,
			summary: '未识别到复选框任务',
		},
		upTaskTitles: options.upTaskTitles ?? [],
	};
}

test('UpTask 单个字符串会解析为单项数组', () => {
	assert.deepEqual(parseUpTaskFrontmatterValue('父任务'), ['父任务']);
});

test('UpTask 的 wikilink 形式会解析成纯标题', () => {
	assert.deepEqual(parseUpTaskFrontmatterValue('[[父任务]]'), ['父任务']);
});

test('UpTask 列表会过滤空白项', () => {
	assert.deepEqual(
		parseUpTaskFrontmatterValue(['父任务', '  ', '第二父任务']),
		['父任务', '第二父任务'],
	);
});

test('UpTask 列表中混合普通标题与 wikilink 时会统一解析', () => {
	assert.deepEqual(
		parseUpTaskFrontmatterValue(['父任务', ' [[第二父任务]] ', '  ']),
		['父任务', '第二父任务'],
	);
});

test('无 UpTask 时保持原顺序并且缩进为 0', () => {
	const tasks = [createTask('A'), createTask('B'), createTask('C')];
	const result = buildVisibleTaskHierarchy(tasks);

	assert.deepEqual(
		result.map((task) => [task.title, task.indentLevel]),
		[
			['A', 0],
			['B', 0],
			['C', 0],
		],
	);
});

test('子任务会排到父任务下方并缩进显示', () => {
	const tasks = [
		createTask('父任务'),
		createTask('子任务', { upTaskTitles: ['父任务'] }),
		createTask('其他任务'),
	];
	const result = buildVisibleTaskHierarchy(tasks);

	assert.deepEqual(
		result.map((task) => [task.title, task.indentLevel]),
		[
			['父任务', 0],
			['子任务', 1],
			['其他任务', 0],
		],
	);
});

test('使用 wikilink 形式的 UpTask 时也能匹配到父任务', () => {
	const tasks = [
		createTask('父任务'),
		createTask('子任务', { upTaskTitles: parseUpTaskFrontmatterValue('[[父任务]]') }),
	];
	const result = buildVisibleTaskHierarchy(tasks);

	assert.deepEqual(
		result.map((task) => [task.title, task.indentLevel]),
		[
			['父任务', 0],
			['子任务', 1],
		],
	);
});

test('支持多级嵌套显示', () => {
	const tasks = [
		createTask('根任务'),
		createTask('二级任务', { upTaskTitles: ['根任务'] }),
		createTask('三级任务', { upTaskTitles: ['二级任务'] }),
	];
	const result = buildVisibleTaskHierarchy(tasks);

	assert.deepEqual(
		result.map((task) => [task.title, task.indentLevel]),
		[
			['根任务', 0],
			['二级任务', 1],
			['三级任务', 2],
		],
	);
});

test('UpTask 指向当前列表外任务时保持顶层显示', () => {
	const tasks = [
		createTask('任务A', { upTaskTitles: ['不存在的父任务'] }),
		createTask('任务B'),
	];
	const result = buildVisibleTaskHierarchy(tasks);

	assert.deepEqual(
		result.map((task) => [task.title, task.indentLevel]),
		[
			['任务A', 0],
			['任务B', 0],
		],
	);
});

test('自引用不会造成异常并保持顶层显示', () => {
	const tasks = [createTask('任务A', { upTaskTitles: ['任务A'] })];
	const result = buildVisibleTaskHierarchy(tasks);

	assert.deepEqual(
		result.map((task) => [task.title, task.indentLevel]),
		[['任务A', 0]],
	);
});

test('循环引用不会死循环且任务不会丢失', () => {
	const tasks = [
		createTask('任务A', { upTaskTitles: ['任务B'] }),
		createTask('任务B', { upTaskTitles: ['任务A'] }),
	];
	const result = buildVisibleTaskHierarchy(tasks);

	assert.deepEqual(
		result.map((task) => task.title),
		['任务A', '任务B'],
	);
	assert.deepEqual(
		result.map((task) => task.indentLevel),
		[0, 1],
	);
});

test('多个 UpTask 值时会使用第一个命中的父任务', () => {
	const tasks = [
		createTask('父任务A'),
		createTask('父任务B'),
		createTask('子任务', { upTaskTitles: ['不存在', '父任务B', '父任务A'] }),
	];
	const result = buildVisibleTaskHierarchy(tasks);

	assert.deepEqual(
		result.map((task) => [task.title, task.indentLevel]),
		[
			['父任务A', 0],
			['父任务B', 0],
			['子任务', 1],
		],
	);
		assert.equal(result[2]?.title, '子任务');
});
