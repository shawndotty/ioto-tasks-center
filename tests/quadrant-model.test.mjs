import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 优先级四象限纯模型单测（[[Plan-20261115-201917]] §6.1）。
// 模型零 obsidian 运行时依赖，照 `task-priority.test.mjs` 的 jiti 直载范式。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildQuadrantModel,
	buildQuadrantPriorityMenuItems,
	quadrantKeyForPriority,
	QUADRANT_KEYS,
	toQuadrantStatusKey,
} = await jiti.import('../src/tasks-center/quadrant-data.ts');

function task(
	path,
	{ priority, statusKey = 'todo', mtime = 0, starred = false } = {},
) {
	const basename = path.split('/').pop().replace(/\.md$/, '');
	return {
		name: `${basename}.md`,
		basename,
		title: basename,
		path,
		mtime,
		ctime: 0,
		size: 0,
		starred,
		priority,
		status: {
			key: statusKey,
			label: '',
			totalTaskCount: 0,
			completedTaskCount: 0,
			summary: '',
		},
		upTaskTitles: [],
		content: '',
	};
}

function filter({
	statusKeys = ['in-progress', 'todo'],
	projectScope = { kind: 'unarchived' },
	hiddenProjectNames = [],
} = {}) {
	return {
		statusKeys: new Set(statusKeys),
		projectScope,
		hiddenProjectNames: new Set(hiddenProjectNames),
	};
}

const pathsOf = (entries) => entries.map((entry) => entry.path);

test('quadrantKeyForPriority：0/1/2 → p0/p1/p2，>=3 → p3，缺失与非法 → unlabeled', () => {
	assert.equal(quadrantKeyForPriority(undefined), 'unlabeled');
	assert.equal(quadrantKeyForPriority(0), 'p0');
	assert.equal(quadrantKeyForPriority(1), 'p1');
	assert.equal(quadrantKeyForPriority(2), 'p2');
	assert.equal(quadrantKeyForPriority(3), 'p3');
	assert.equal(quadrantKeyForPriority(4), 'p3');
	assert.equal(quadrantKeyForPriority(99), 'p3');
	assert.equal(quadrantKeyForPriority(-1), 'unlabeled');
	assert.equal(quadrantKeyForPriority(1.5), 'unlabeled');
	assert.equal(quadrantKeyForPriority(Number.NaN), 'unlabeled');
});

test('toQuadrantStatusKey：empty 折进 todo，其余原样', () => {
	assert.equal(toQuadrantStatusKey('todo'), 'todo');
	assert.equal(toQuadrantStatusKey('in-progress'), 'in-progress');
	assert.equal(toQuadrantStatusKey('completed'), 'completed');
	assert.equal(toQuadrantStatusKey('empty'), 'todo');
});

test('状态过滤：任意组合只收选中态；全关时 total 为 0', () => {
	const tasks = [
		task('3-任务/A/a.md', { priority: 0, statusKey: 'todo' }),
		task('3-任务/A/b.md', { priority: 0, statusKey: 'in-progress' }),
		task('3-任务/A/c.md', { priority: 0, statusKey: 'completed' }),
	];

	const onlyTodo = buildQuadrantModel(
		tasks,
		filter({ statusKeys: ['todo'] }),
	);
	assert.deepEqual(pathsOf(onlyTodo.buckets.p0), ['3-任务/A/a.md']);
	assert.equal(onlyTodo.total, 1);

	const none = buildQuadrantModel(tasks, filter({ statusKeys: [] }));
	assert.equal(none.total, 0);
	assert.equal(none.counts.p0, 0);
	assert.equal(none.scopedTotal, 3);
});

test('项目范围 all：含存档项目任务', () => {
	const tasks = [
		task('3-任务/Live/a.md', { priority: 0 }),
		task('3-任务/Archived/b.md', { priority: 1 }),
	];
	const model = buildQuadrantModel(
		tasks,
		filter({ projectScope: { kind: 'all' }, hiddenProjectNames: ['Archived'] }),
	);
	assert.equal(model.counts.p0, 1);
	assert.equal(model.counts.p1, 1);
	assert.equal(model.scopedTotal, 2);
});

test('项目范围 unarchived：排除存档项目', () => {
	const tasks = [
		task('3-任务/Live/a.md', { priority: 0 }),
		task('3-任务/Archived/b.md', { priority: 1 }),
	];
	const model = buildQuadrantModel(
		tasks,
		filter({
			projectScope: { kind: 'unarchived' },
			hiddenProjectNames: ['Archived'],
		}),
	);
	assert.equal(model.counts.p0, 1);
	assert.equal(model.counts.p1, 0);
	assert.equal(model.scopedTotal, 1);
});

test('项目范围 project：只看指定项目，且存档项目仍可见', () => {
	const tasks = [
		task('3-任务/Live/a.md', { priority: 0 }),
		task('3-任务/Archived/b.md', { priority: 1 }),
	];
	const model = buildQuadrantModel(
		tasks,
		filter({
			projectScope: { kind: 'project', projectName: 'Archived' },
			hiddenProjectNames: ['Archived'],
		}),
	);
	assert.equal(model.counts.p0, 0);
	assert.equal(model.counts.p1, 1);
	assert.equal(model.scopedTotal, 1);
});

test('侧栏集合 = priority undefined ∩ 项目范围 ∩ 状态过滤', () => {
	const tasks = [
		task('3-任务/Live/a.md', { statusKey: 'todo' }),
		task('3-任务/Live/b.md', { statusKey: 'completed' }),
		task('3-任务/Archived/c.md', { statusKey: 'todo' }),
		task('3-任务/Live/d.md', { priority: 0, statusKey: 'todo' }),
	];
	const model = buildQuadrantModel(
		tasks,
		filter({ hiddenProjectNames: ['Archived'] }),
	);
	assert.deepEqual(pathsOf(model.unlabeled), ['3-任务/Live/a.md']);
});

test('不重不漏：四桶 + 侧栏 = total；scopedTotal >= total', () => {
	const tasks = [
		task('3-任务/A/a.md', { priority: 0 }),
		task('3-任务/A/b.md', { priority: 1 }),
		task('3-任务/A/c.md', { priority: 2 }),
		task('3-任务/A/d.md', { priority: 4 }),
		task('3-任务/A/e.md'),
		task('3-任务/A/f.md', { priority: 3, statusKey: 'completed' }),
	];
	const model = buildQuadrantModel(tasks, filter());
	const bucketSum = QUADRANT_KEYS.reduce(
		(sum, key) => sum + model.counts[key],
		0,
	);
	assert.equal(bucketSum + model.counts.unlabeled, model.total);
	assert.equal(model.total, 5);
	assert.equal(model.scopedTotal, 6);
	assert.ok(model.scopedTotal >= model.total);
});

test('statusCounts：项目范围后、状态过滤前，与 chip 开关无关', () => {
	const tasks = [
		task('3-任务/A/a.md', { statusKey: 'todo' }),
		task('3-任务/A/b.md', { statusKey: 'in-progress' }),
		task('3-任务/A/c.md', { statusKey: 'in-progress' }),
		task('3-任务/A/d.md', { statusKey: 'completed' }),
		task('3-任务/A/e.md', { statusKey: 'empty' }),
		task('3-任务/Archived/f.md', { statusKey: 'todo' }),
	];
	const model = buildQuadrantModel(
		tasks,
		filter({
			statusKeys: ['completed'],
			hiddenProjectNames: ['Archived'],
		}),
	);
	assert.deepEqual(model.statusCounts, {
		completed: 1,
		'in-progress': 2,
		todo: 2,
	});
	assert.equal(model.scopedTotal, 5);
});

test('排序：mtime 倒序；同 mtime 按 basename 正序；输入顺序无关', () => {
	const tasks = [
		task('3-任务/A/zebra.md', { priority: 0, mtime: 10 }),
		task('3-任务/A/alpha.md', { priority: 0, mtime: 10 }),
		task('3-任务/A/newest.md', { priority: 0, mtime: 20 }),
	];
	const forward = buildQuadrantModel(tasks, filter());
	const reversed = buildQuadrantModel([...tasks].reverse(), filter());
	const expected = [
		'3-任务/A/newest.md',
		'3-任务/A/alpha.md',
		'3-任务/A/zebra.md',
	];
	assert.deepEqual(pathsOf(forward.buckets.p0), expected);
	assert.deepEqual(pathsOf(reversed.buckets.p0), expected);
});

test('空输入：各桶为空、计数全 0、不抛错', () => {
	const model = buildQuadrantModel([], filter());
	assert.deepEqual(model.buckets, { p0: [], p1: [], p2: [], p3: [] });
	assert.deepEqual(model.unlabeled, []);
	assert.deepEqual(model.counts, {
		p0: 0,
		p1: 0,
		p2: 0,
		p3: 0,
		unlabeled: 0,
	});
	assert.equal(model.total, 0);
	assert.equal(model.scopedTotal, 0);
});

test('指定项目不存在：返回全空模型，不抛错', () => {
	const model = buildQuadrantModel(
		[task('3-任务/A/a.md', { priority: 0 })],
		filter({ projectScope: { kind: 'project', projectName: 'Ghost' } }),
	);
	assert.equal(model.total, 0);
	assert.equal(model.scopedTotal, 0);
});

test('菜单描述：未标注 4 项无 clear；已标注首项 clear + 当前项 active；顺序固定', () => {
	const unlabeled = buildQuadrantPriorityMenuItems(undefined);
	assert.deepEqual(
		unlabeled.map((item) =>
			item.kind === 'clear' ? 'clear' : `${item.value}:${item.active}`,
		),
		['0:false', '1:false', '2:false', '3:false'],
	);

	const p0 = buildQuadrantPriorityMenuItems(0);
	assert.deepEqual(p0[0], { kind: 'clear' });
	assert.deepEqual(
		p0.slice(1).map((item) => `${item.value}:${item.active}`),
		['0:true', '1:false', '2:false', '3:false'],
	);

	const p4 = buildQuadrantPriorityMenuItems(4);
	assert.equal(p4[0].kind, 'clear');
	assert.ok(
		p4.slice(1).every((item) => item.kind === 'priority' && !item.active),
	);

	const fixedOrder = buildQuadrantPriorityMenuItems(undefined)
		.filter((item) => item.kind === 'priority')
		.map((item) => item.value);
	assert.deepEqual(fixedOrder, [0, 1, 2, 3]);
});
