import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildTaskLinksIndex,
	collectOtherOutlinkPaths,
	filterTaskLinks,
	resolveTaskParentPaths,
	toTaskLinkEntry,
} = await jiti.import('../src/tasks-center/task-links-index.ts');

const ROOTS = {
	tasksRootPath: '3-任务',
	inputRootPath: '1-输入',
	outputRootPath: '2-输出',
	outcomeRootPath: '4-成果',
};

function createTask(title, options = {}) {
	return {
		name: `${title}.md`,
		basename: title,
		title,
		path: options.path ?? `3-任务/项目A/${title}.md`,
		mtime: 0,
		ctime: 0,
		size: 0,
		starred: false,
		status: {
			key: 'todo',
			label: '待开始',
			totalTaskCount: 0,
			completedTaskCount: 0,
			summary: '',
		},
		upTaskTitles: options.upTaskTitles ?? [],
		content: '',
	};
}

test('其他链接：三个根下的路径全部排除', () => {
	assert.deepEqual(
		collectOtherOutlinkPaths(
			[
				'1-输入/2026-01-01 素材.md',
				'2-输出/如何做.md',
				'4-成果/Report-1.md',
				'1-输入/子目录/图.png',
			],
			ROOTS,
			[],
		),
		[],
	);
});

test('其他链接：同名前缀根目录不算命中', () => {
	assert.deepEqual(
		collectOtherOutlinkPaths(['1-输入法/z.md'], ROOTS, []),
		['1-输入法/z.md'],
	);
});

test('其他链接：排除集（自身 + 子任务）不进结果', () => {
	assert.deepEqual(
		collectOtherOutlinkPaths(
			[
				'3-任务/项目/子任务.md',
				'3-任务/项目/本任务.md',
				'0-辅助/附件/a.pdf',
			],
			ROOTS,
			['3-任务/项目/子任务.md', '3-任务/项目/本任务.md'],
		),
		['0-辅助/附件/a.pdf'],
	);
});

test('其他链接：父任务不排除（frontmatter 出链是真实链接）', () => {
	assert.deepEqual(
		collectOtherOutlinkPaths(
			['3-任务/IOTO Task Center/IOTO Task Center-计划-V277.md'],
			ROOTS,
			['3-任务/IOTO Task Center/任务链接浏览窗口.md'],
		),
		['3-任务/IOTO Task Center/IOTO Task Center-计划-V277.md'],
	);
});

test('其他链接：重复输入去重且按数字序排序', () => {
	assert.deepEqual(
		collectOtherOutlinkPaths(
			['0-辅助/10.md', '0-辅助/2.md', '0-辅助/10.md', '0-辅助/1.md'],
			ROOTS,
			[],
		),
		['0-辅助/1.md', '0-辅助/2.md', '0-辅助/10.md'],
	);
});

test('子任务按传入顺序进入 childrenByParentPath，父任务不在自己的子列表里', () => {
	const parent = createTask('父任务');
	const first = createTask('子任务一', { upTaskTitles: ['父任务'] });
	const second = createTask('子任务二', { upTaskTitles: ['父任务'] });
	const third = createTask('子任务三', { upTaskTitles: ['父任务'] });

	const index = buildTaskLinksIndex([third, parent, first, second]);
	const children = index.childrenByParentPath.get(parent.path) ?? [];

	assert.deepEqual(
		children.map((task) => task.title),
		['子任务三', '子任务一', '子任务二'],
	);
	assert.equal(index.childrenByParentPath.has(first.path), false);
	assert.equal(index.parentPathByTaskPath.get(first.path), parent.path);
});

test('父级解析：注入解析器命中时优先用它', () => {
	const parentA = createTask('父任务', { path: '3-任务/项目A/父任务.md' });
	const parentB = createTask('父任务', { path: '3-任务/项目B/父任务.md' });
	const child = createTask('子任务', {
		path: '3-任务/项目B/子任务.md',
		upTaskTitles: ['父任务'],
	});

	const index = buildTaskLinksIndex([parentA, parentB, child], () => parentA.path);

	assert.equal(index.parentPathByTaskPath.get(child.path), parentA.path);
});

test('父级解析：解析器返回集合外的路径时退回同目录候选', () => {
	const parentA = createTask('父任务', { path: '3-任务/项目A/父任务.md' });
	const parentB = createTask('父任务', { path: '3-任务/项目B/父任务.md' });
	const child = createTask('子任务', {
		path: '3-任务/项目B/子任务.md',
		upTaskTitles: ['父任务'],
	});

	const index = buildTaskLinksIndex(
		[parentA, parentB, child],
		() => '4-成果/不存在.md',
	);

	assert.equal(index.parentPathByTaskPath.get(child.path), parentB.path);
});

test('父级解析：跨项目同名时取路径字典序第一', () => {
	const parentA = createTask('父任务', { path: '3-任务/项目A/父任务.md' });
	const parentB = createTask('父任务', { path: '3-任务/项目B/父任务.md' });
	const child = createTask('子任务', {
		path: '3-任务/项目C/子任务.md',
		upTaskTitles: ['父任务'],
	});

	const index = buildTaskLinksIndex([parentB, parentA, child]);

	assert.equal(index.parentPathByTaskPath.get(child.path), parentA.path);
});

test('自反 UpTask 不产生父级，A↔B 互指不会死循环', () => {
	const selfRef = createTask('自指任务', { upTaskTitles: ['自指任务'] });
	const taskA = createTask('任务A', { upTaskTitles: ['任务B'] });
	const taskB = createTask('任务B', { upTaskTitles: ['任务A'] });

	const index = buildTaskLinksIndex([selfRef, taskA, taskB]);

	assert.equal(index.parentPathByTaskPath.has(selfRef.path), false);
	assert.equal(index.parentPathByTaskPath.get(taskA.path), taskB.path);
	assert.equal(index.parentPathByTaskPath.get(taskB.path), taskA.path);
});

test('父级行可列出全部可解析的 UpTask', () => {
	const parentA = createTask('父任务甲');
	const parentB = createTask('父任务乙');
	const child = createTask('子任务', {
		upTaskTitles: ['父任务甲', '父任务乙', '父任务甲'],
	});

	const index = buildTaskLinksIndex([parentA, parentB, child]);

	assert.deepEqual(resolveTaskParentPaths(index, child), [
		parentA.path,
		parentB.path,
	]);
});

test('展示标题：关闭项目名前缀时剥离，开启时保留', () => {
	const task = createTask('项目A-子任务');

	assert.equal(toTaskLinkEntry(task, false).title, '子任务');
	assert.equal(toTaskLinkEntry(task, true).title, '项目A-子任务');
	assert.equal(toTaskLinkEntry(task, false).subPath, '3-任务/项目A/项目A-子任务');
});

test('搜索过滤：标题命中 / 正文命中 / 大小写不敏感 / 中文子串', () => {
	const alpha = createTask('Alpha 任务');
	const beta = createTask('贝塔任务');
	const gamma = createTask('Gamma 任务');
	const snapshot = {
		sections: {
			subtask: [alpha],
			input: [beta],
			output: [gamma],
			outcome: [],
		},
	};
	const bodies = new Map([[beta.path, '正文里提到了 ALPHA 这个关键词']]);

	const byTitle = filterTaskLinks(snapshot, 'alpha', bodies);
	assert.deepEqual(
		byTitle.sections.subtask.map((entry) => entry.path),
		[alpha.path],
	);
	assert.deepEqual(
		byTitle.sections.input.map((entry) => entry.path),
		[beta.path],
		'正文命中也要计入',
	);
	assert.deepEqual(byTitle.counts, {
		subtask: 1,
		input: 1,
		output: 0,
		outcome: 0,
		other: 0,
	});

	const byChinese = filterTaskLinks(snapshot, '贝塔', bodies);
	assert.deepEqual(
		byChinese.sections.input.map((entry) => entry.path),
		[beta.path],
	);
});

test('搜索过滤：空词返回全量且计数等于长度，无命中返回空数组', () => {
	const alpha = createTask('Alpha');
	const beta = createTask('Beta');
	const snapshot = {
		sections: {
			subtask: [alpha, beta],
			input: [],
			output: [beta],
			outcome: [],
		},
	};

	const empty = filterTaskLinks(snapshot, '   ', new Map());
	assert.equal(empty.sections.subtask.length, 2);
	assert.deepEqual(empty.counts, {
		subtask: 2,
		input: 0,
		output: 1,
		outcome: 0,
		other: 0,
	});

	const noHit = filterTaskLinks(snapshot, 'zzz', new Map());
	assert.deepEqual(noHit.sections.subtask, []);
	assert.deepEqual(noHit.counts, {
		subtask: 0,
		input: 0,
		output: 0,
		outcome: 0,
		other: 0,
	});
});
