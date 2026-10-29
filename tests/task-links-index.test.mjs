import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildTaskLinksIndex,
	collectOtherOutlinkPaths,
	filterTaskLinks,
	findRelaxHints,
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

// 搜索范围 / 大小写 / 全词（[[Plan-20261029-083909]] §三 S2 / §四 S6）。
// 三个维度全是可选参数，默认值必须与旧语义逐条相同。
function createSearchFixture() {
	// 标题命中：Alpha 任务 / 正文命中：贝塔任务 / 都不命中：Gamma 任务
	const alpha = createTask('Alpha 任务');
	const beta = createTask('贝塔任务');
	const gamma = createTask('Gamma 任务');
	const foobar = createTask('Foobar 说明');
	return {
		alpha,
		beta,
		gamma,
		foobar,
		snapshot: {
			sections: {
				subtask: [alpha, foobar],
				input: [beta],
				output: [gamma],
				outcome: [],
			},
		},
		bodies: new Map([[beta.path, '正文里提到了 ALPHA 这个关键词']]),
	};
}

test('搜索范围：scope=title 只看标题，正文命中被排除', () => {
	const { alpha, beta, snapshot, bodies } = createSearchFixture();
	const result = filterTaskLinks(snapshot, 'alpha', bodies, {
		scope: 'title',
	});
	assert.deepEqual(
		result.sections.subtask.map((entry) => entry.path),
		[alpha.path],
	);
	assert.deepEqual(result.sections.input, []);
	assert.equal(result.counts.input, 0);
});

test('搜索范围：scope=body 只看正文，标题命中被排除', () => {
	const { alpha, beta, snapshot, bodies } = createSearchFixture();
	const result = filterTaskLinks(snapshot, 'alpha', bodies, {
		scope: 'body',
	});
	assert.deepEqual(result.sections.subtask, []);
	assert.deepEqual(
		result.sections.input.map((entry) => entry.path),
		[beta.path],
	);
});

test('搜索范围：不传 options 与 scope=both 结果逐条相同（默认等价）', () => {
	const { snapshot, bodies } = createSearchFixture();
	const fallback = filterTaskLinks(snapshot, 'alpha', bodies);
	const explicit = filterTaskLinks(snapshot, 'alpha', bodies, {
		scope: 'both',
		// 另外两项显式写默认值，确认「默认 = 旧语义」不是靠参数缺省碰巧成立
		caseSensitive: false,
		wholeWord: false,
	});
	assert.deepEqual(explicit.counts, fallback.counts);
	for (const category of ['subtask', 'input', 'output', 'outcome', 'other']) {
		assert.deepEqual(
			explicit.sections[category].map((entry) => entry.path),
			fallback.sections[category].map((entry) => entry.path),
			category,
		);
	}
});

test('大小写：caseSensitive=true 时 Alpha 与 alpha 区分', () => {
	const { snapshot, bodies } = createSearchFixture();
	assert.equal(filterTaskLinks(snapshot, 'alpha', bodies).counts.subtask, 1);
	assert.equal(
		filterTaskLinks(snapshot, 'alpha', bodies, { caseSensitive: true }).counts
			.subtask,
		0,
	);
	assert.equal(
		filterTaskLinks(snapshot, 'Alpha', bodies, { caseSensitive: true }).counts
			.subtask,
		1,
	);
});

test('全词：标题 Foobar 对 foo 不再命中', () => {
	const { snapshot, bodies } = createSearchFixture();
	assert.equal(filterTaskLinks(snapshot, 'foo', bodies).counts.subtask, 1);
	assert.equal(
		filterTaskLinks(snapshot, 'foo', bodies, { wholeWord: true }).counts.subtask,
		0,
	);
	// 中文在全词下仍按子串处理（不是 \b 语义）
	const chinese = createTask('卡片笔记-2026');
	assert.equal(
		filterTaskLinks(
			{ sections: { subtask: [chinese], input: [], output: [], outcome: [] } },
			'笔记',
			new Map(),
			{ wholeWord: true },
		).counts.subtask,
		1,
	);
});

test('空态归因：单开关生效 → 恰好 1 条 hint 且 count 正确', () => {
	const { snapshot, bodies } = createSearchFixture();
	const hints = findRelaxHints(
		snapshot,
		'alpha',
		bodies,
		{ scope: 'body' },
		'subtask',
	);
	assert.deepEqual(hints, [{ relax: 'scope', count: 1 }]);
});

test('空态归因：全默认 → []', () => {
	const { snapshot, bodies } = createSearchFixture();
	assert.deepEqual(
		findRelaxHints(snapshot, 'alpha', bodies, {}, 'subtask'),
		[],
	);
});

test('空态归因：两个开关同时生效 → 各自能归因', () => {
	// 标题 `Alpha` 大写、正文 `alpha` 小写；区分大小写 + 仅标题 → 0 条，
	// 放宽「范围」（正文小写命中）或「大小写」（标题大写命中）都能回到 1 条。
	const titled = createTask('Alpha 笔记');
	const bodyOnly = createTask('无关任务');
	const snapshot = {
		sections: {
			subtask: [titled, bodyOnly],
			input: [],
			output: [],
			outcome: [],
		},
	};
	const bodies = new Map([[bodyOnly.path, '这里是 alpha 的正文']]);

	assert.equal(
		filterTaskLinks(snapshot, 'alpha', bodies, {
			scope: 'title',
			caseSensitive: true,
		}).counts.subtask,
		0,
	);

	assert.deepEqual(
		findRelaxHints(
			snapshot,
			'alpha',
			bodies,
			{ scope: 'title', caseSensitive: true },
			'subtask',
		),
		[
			{ relax: 'scope', count: 1 },
			{ relax: 'caseSensitive', count: 1 },
		],
	);
});

test('空态归因：放宽后仍 0 条的维度不进 hint', () => {
	const { snapshot, bodies } = createSearchFixture();
	// `Gamma 任务` 只在 output；subtask 里搜一个不存在的词 → 三个维度都放宽也 0 条
	assert.deepEqual(
		findRelaxHints(
			snapshot,
			'Gamma',
			bodies,
			{ scope: 'title', caseSensitive: true, wholeWord: true },
			'subtask',
		),
		[],
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
