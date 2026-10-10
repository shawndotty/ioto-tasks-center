import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 解析结果缓存 + 并发工具的回归测试。
// 任务文件派生字段按 (mtime, size) 缓存，这里用「统计 cachedRead 次数」来断言
// 缓存是否真的生效——这是「项目加载提速」的核心保证，一旦失效会静默退化成全量重扫。
// 注意：这里不关 moduleCache，否则 obsidian 桩的 TFile 会与 data.ts 拿到的不是
// 同一个类对象，`instanceof` 判定会失效。
const jiti = createJiti(import.meta.url, {
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { TFile, TFolder } = await jiti.import('./stubs/obsidian.mjs');
const { listProjectTaskFiles, parseTaskFileFields } = await jiti.import(
	'../src/tasks-center/data.ts',
);
const { mapWithConcurrency } = await jiti.import(
	'../src/tasks-center/async.ts',
);

const TASKS_ROOT = '3-任务';

/** 每个用例用独立项目名，避免共享的解析缓存互相干扰。 */
function createHarness(projectName) {
	const contents = new Map([
		[
			`${TASKS_ROOT}/${projectName}/t1.md`,
			'---\nStarred: true\nPriority: 2\n---\n- [ ] 未完成一\n- [x] 已完成一\n',
		],
		[`${TASKS_ROOT}/${projectName}/t2.md`, '- [ ] 未完成二\n'],
	]);

	const files = [...contents.keys()].map((path, index) => {
		const file = new TFile(path);
		file.stat = {
			mtime: 1000 + index,
			ctime: 1000 + index,
			size: (contents.get(path) ?? '').length,
		};
		return file;
	});

	const projectFolder = new TFolder(`${TASKS_ROOT}/${projectName}`);
	projectFolder.children = files;
	const rootFolder = new TFolder(TASKS_ROOT);
	rootFolder.children = [projectFolder];

	const readPaths = [];
	const app = {
		vault: {
			getAbstractFileByPath(path) {
				if (path === TASKS_ROOT) {
					return rootFolder;
				}
				if (path === `${TASKS_ROOT}/${projectName}`) {
					return projectFolder;
				}
				return null;
			},
			cachedRead: async (file) => {
				readPaths.push(file.path);
				return contents.get(file.path) ?? '';
			},
		},
	};

	return { app, files, readPaths, contents };
}

test('parseTaskFileFields：一次解析出 starred / priority / upTask / status', () => {
	const fields = parseTaskFileFields(
		'---\nStarred: true\nPriority: 2\nUpTask:\n  - "[[父任务]]"\n---\n- [ ] 待办\n- [x] 完成\n',
	);

	assert.equal(fields.starred, true);
	assert.equal(fields.priority, 2);
	assert.deepEqual(fields.upTaskTitles, ['父任务']);
	assert.equal(fields.status.key, 'in-progress');
	assert.equal(fields.status.totalTaskCount, 2);
	assert.equal(fields.status.completedTaskCount, 1);
});

test('首次扫描读取全部文件，二次扫描命中缓存后零 IO', async () => {
	const { app, readPaths } = createHarness('缓存项目A');

	const first = await listProjectTaskFiles(app, TASKS_ROOT, '缓存项目A', {
		includeContent: false,
	});
	assert.equal(first.tasks.length, 2);
	assert.equal(readPaths.length, 2, '首次应读取全部任务文件');
	assert.equal(
		first.tasks.filter(
			(task) => task.status.key === 'todo' || task.status.key === 'in-progress',
		).length,
		2,
		'两个文件各有未完成项',
	);

	readPaths.length = 0;
	const second = await listProjectTaskFiles(app, TASKS_ROOT, '缓存项目A', {
		includeContent: false,
	});
	assert.equal(second.tasks.length, 2);
	assert.equal(readPaths.length, 0, '缓存命中后不应再读文件');
});

test('mtime 变化后缓存失效，只重读变动的文件', async () => {
	const { app, files, readPaths } = createHarness('缓存项目B');

	await listProjectTaskFiles(app, TASKS_ROOT, '缓存项目B', {
		includeContent: false,
	});
	assert.equal(readPaths.length, 2);

	const changed = files[0];
	changed.stat = { ...changed.stat, mtime: changed.stat.mtime + 1 };
	readPaths.length = 0;

	await listProjectTaskFiles(app, TASKS_ROOT, '缓存项目B', {
		includeContent: false,
	});
	assert.deepEqual(readPaths, [changed.path], '只重读 mtime 变动的文件');
});

test('includeContent 关闭时正文不驻留，开启时照旧返回', async () => {
	const { app } = createHarness('缓存项目C');

	const withoutContent = await listProjectTaskFiles(
		app,
		TASKS_ROOT,
		'缓存项目C',
		{ includeContent: false },
	);
	assert.equal(
		withoutContent.tasks.every((task) => task.content === ''),
		true,
		'算角标时不该把正文读进内存',
	);

	const withContent = await listProjectTaskFiles(app, TASKS_ROOT, '缓存项目C');
	assert.equal(
		withContent.tasks.every((task) => task.content.length > 0),
		true,
		'任务列表仍需正文（搜索索引用）',
	);
});

test('mapWithConcurrency：结果保序且并发不超过上限', async () => {
	let active = 0;
	let maxActive = 0;

	const result = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		await new Promise((resolve) => setTimeout(resolve, 1));
		active -= 1;
		return n * 10;
	});

	assert.deepEqual(result, [10, 20, 30, 40, 50, 60]);
	assert.equal(maxActive, 2);
});

test('mapWithConcurrency：空输入直接返回空数组', async () => {
	assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
});
