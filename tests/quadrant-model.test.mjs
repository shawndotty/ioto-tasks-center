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
	{ priority, statusKey = 'todo', mtime = 0, ctime = 0, starred = false } = {},
) {
	const basename = path.split('/').pop().replace(/\.md$/, '');
	return {
		name: `${basename}.md`,
		basename,
		title: basename,
		path,
		mtime,
		ctime,
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
	timeFilter = { kind: 'none' },
} = {}) {
	return {
		statusKeys: new Set(statusKeys),
		projectScope,
		hiddenProjectNames: new Set(hiddenProjectNames),
		timeFilter,
	};
}

// 固定 now：2026-11-11（周三）15:00 本地，时间过滤断言与机器时钟解耦。
const NOW = new Date(2026, 10, 11, 15, 0, 0).getTime();
const OCT_15 = new Date(2026, 9, 15, 12, 0, 0).getTime();
const NOV_05 = new Date(2026, 10, 5, 12, 0, 0).getTime();

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

test('菜单描述：未标注 4 项无 clear；已标注首项 clear + 当前项 active；顺序固定', () => {	const unlabeled = buildQuadrantPriorityMenuItems(undefined);
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

test('时间过滤：scopedTotal / statusCounts 只统计窗口内，状态过滤在其后', () => {
	const tasks = [
		task('3-任务/A/recent.md', { statusKey: 'todo', mtime: NOV_05 }),
		task('3-任务/A/old.md', { statusKey: 'in-progress', mtime: OCT_15 }),
		task('3-任务/A/done.md', { statusKey: 'completed', mtime: NOV_05 }),
	];
	const model = buildQuadrantModel(
		tasks,
		filter({
			timeFilter: { kind: 'preset', value: 'updated-calendar-month' },
		}),
		NOW,
	);
	assert.equal(model.scopedTotal, 2);
	assert.deepEqual(model.statusCounts, {
		completed: 1,
		'in-progress': 0,
		todo: 1,
	});
	assert.equal(model.total, 1);
	assert.deepEqual(pathsOf(model.unlabeled), ['3-任务/A/recent.md']);
});

test('时间过滤字段：按创建排除 ctime 在窗口外的任务，未标注侧栏同步', () => {
	const tasks = [
		task('3-任务/A/new-created.md', {
			ctime: NOV_05,
			mtime: NOV_05,
		}),
		task('3-任务/A/old-created.md', {
			ctime: OCT_15,
			mtime: NOV_05,
		}),
	];
	const model = buildQuadrantModel(
		tasks,
		filter({
			timeFilter: { kind: 'preset', value: 'created-calendar-month' },
		}),
		NOW,
	);
	assert.deepEqual(pathsOf(model.unlabeled), ['3-任务/A/new-created.md']);
	assert.equal(model.scopedTotal, 1);
});

test('时间 + 项目范围 + 状态组合：total 守恒，scopedTotal 为时间收敛后的总数', () => {
	const tasks = [
		task('3-任务/Live/a.md', { priority: 0, mtime: NOV_05 }),
		task('3-任务/Live/b.md', { priority: 0, statusKey: 'completed', mtime: NOV_05 }),
		task('3-任务/Live/c.md', { priority: 1, mtime: OCT_15 }),
		task('3-任务/Archived/d.md', { priority: 2, mtime: NOV_05 }),
		task('3-任务/Live/e.md', { mtime: NOV_05 }),
	];
	const model = buildQuadrantModel(
		tasks,
		filter({
			statusKeys: ['todo'],
			hiddenProjectNames: ['Archived'],
			timeFilter: {
				kind: 'custom',
				field: 'updated',
				start: '2026-11-01',
			},
		}),
		NOW,
	);
	const bucketSum = QUADRANT_KEYS.reduce(
		(sum, key) => sum + model.counts[key],
		0,
	);
	assert.equal(bucketSum + model.counts.unlabeled, model.total);
	assert.equal(model.scopedTotal, 3);
	assert.equal(model.total, 2);
	assert.equal(model.counts.p0, 1);
	assert.equal(model.counts.unlabeled, 1);
});

// 任务类型过滤（[[Plan-20261117-085118]] §5.2 / §6.2）。
function typedFilter(options = {}) {
	const base = filter(options);
	return options.typeKeys === undefined
		? base
		: { ...base, typeKeys: new Set(options.typeKeys) };
}

const TYPED_TASKS = [
	task('3-任务/A/A-计划-V1.md', { priority: 0, statusKey: 'todo' }),
	task('3-任务/A/A-计划-V2.md', { priority: 1, statusKey: 'completed' }),
	task('3-任务/A/A-主题-Dev.md', { priority: 2, statusKey: 'in-progress' }),
	task('3-任务/A/A-2026-06-24.md', { priority: 3, statusKey: 'todo' }),
	task('3-任务/A/随意任务.md', { priority: 0, statusKey: 'todo' }),
];

test('缺省 typeKeys：与改动前逐项一致（全选回归）', () => {
	const withoutField = buildQuadrantModel(TYPED_TASKS, filter());
	const allSelected = buildQuadrantModel(
		TYPED_TASKS,
		typedFilter({ typeKeys: ['normal', 'date', 'topic', 'plan'] }),
	);
	assert.deepEqual(withoutField.counts, allSelected.counts);
	assert.equal(withoutField.total, 4);
	assert.equal(withoutField.scopedTotal, 5);
	assert.deepEqual(withoutField.typeCounts, {
		normal: 1,
		date: 1,
		topic: 1,
		plan: 2,
	});
});

test('仅选 plan：桶内只剩计划任务，total 为计划任务数', () => {
	const model = buildQuadrantModel(
		TYPED_TASKS,
		typedFilter({ typeKeys: ['plan'], statusKeys: ['todo', 'completed'] }),
	);
	assert.equal(model.total, 2);
	assert.equal(model.counts.p0, 1);
	assert.equal(model.counts.p1, 1);
	assert.deepEqual(pathsOf(model.buckets.p0), ['3-任务/A/A-计划-V1.md']);
	assert.deepEqual(pathsOf(model.buckets.p1), ['3-任务/A/A-计划-V2.md']);
});

test('typeCounts 之和 = 项目 + 时间范围总数，不受类型过滤影响', () => {
	const model = buildQuadrantModel(
		TYPED_TASKS,
		typedFilter({ typeKeys: ['plan'] }),
	);
	const sum = Object.values(model.typeCounts).reduce((a, b) => a + b, 0);
	assert.equal(sum, 5);
});

test('sum(选中 typeCounts) === scopedTotal 不变式', () => {
	const tasks = [
		...TYPED_TASKS,
		task('3-任务/Archived/A-计划-V3.md', { priority: 0 }),
	];
	const model = buildQuadrantModel(
		tasks,
		typedFilter({
			typeKeys: ['plan', 'date'],
			hiddenProjectNames: ['Archived'],
		}),
	);
	const included =
		model.typeCounts.plan + model.typeCounts.date;
	assert.equal(included, model.scopedTotal);
	assert.equal(model.scopedTotal, 3);
});

test('类型 + 状态叠加：状态计数只在选中类型内统计', () => {
	const model = buildQuadrantModel(
		TYPED_TASKS,
		typedFilter({ typeKeys: ['plan', 'topic'] }),
	);
	assert.deepEqual(model.statusCounts, {
		completed: 1,
		'in-progress': 1,
		todo: 1,
	});
});

test('typeKeys 全不选：total / scopedTotal / statusCounts 归零，typeCounts 不变', () => {
	const model = buildQuadrantModel(TYPED_TASKS, typedFilter({ typeKeys: [] }));
	assert.equal(model.total, 0);
	assert.equal(model.scopedTotal, 0);
	assert.deepEqual(model.statusCounts, {
		completed: 0,
		'in-progress': 0,
		todo: 0,
	});
	assert.deepEqual(model.typeCounts, {
		normal: 1,
		date: 1,
		topic: 1,
		plan: 2,
	});
	assert.deepEqual(model.unlabeled, []);
});

test('状态勾选变化不影响 typeCounts', () => {
	const a = buildQuadrantModel(
		TYPED_TASKS,
		typedFilter({ statusKeys: ['todo'] }),
	);
	const b = buildQuadrantModel(
		TYPED_TASKS,
		typedFilter({ statusKeys: ['completed', 'in-progress'] }),
	);
	assert.deepEqual(a.typeCounts, b.typeCounts);
});

test('时间过滤在类型计数之前生效', () => {
	const tasks = [
		task('3-任务/A/A-计划-recent.md', { mtime: NOV_05 }),
		task('3-任务/A/A-计划-old.md', { mtime: OCT_15 }),
	];
	const model = buildQuadrantModel(
		tasks,
		typedFilter({
			timeFilter: { kind: 'preset', value: 'updated-calendar-month' },
		}),
		NOW,
	);
	assert.deepEqual(model.typeCounts, {
		normal: 0,
		date: 0,
		topic: 0,
		plan: 1,
	});
});

