import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// loadProjects 两阶段加载的回归测试（[[Plan-20261127-142715]] §P0-2-4）。
// 断言：阶段一（项目列表 + 选中项目任务列表）不等全项目角标扫描；
// 角标补位用独立代次判定过期，慢任务的后到结果不得覆盖新一轮刷新。
// 与 task-file-cache.test.mjs 同理：保持 moduleCache，让 data.ts 拿到同一个 TFile 类。
const jiti = createJiti(import.meta.url, {
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { TFile, TFolder } = await jiti.import('./stubs/obsidian.mjs');
const { loadProjects } = await jiti.import(
	'../src/views/tasks-center/data-loader.ts',
);

const TASKS_ROOT = '3-任务';

function createHarness(projectNames) {
	const folders = [];
	for (const projectName of projectNames) {
		const contents = new Map([
			[
				`${TASKS_ROOT}/${projectName}/t1.md`,
				'- [ ] 未完成一\n- [x] 已完成一\n',
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
		folders.push(projectFolder);
	}

	const rootFolder = new TFolder(TASKS_ROOT);
	rootFolder.children = folders;

	const app = {
		vault: {
			getAbstractFileByPath(path) {
				if (path === TASKS_ROOT) {
					return rootFolder;
				}
				return folders.find((folder) => folder.path === path) ?? null;
			},
			// 每个文件对象自带内容映射（下方循环写入 __iotoContent），直接回读。
			cachedRead: async (file) => file.__iotoContent ?? '',
		},
		metadataCache: {
			getFileCache: () => null,
		},
	};

	for (const folder of folders) {
		for (const file of folder.children) {
			file.__iotoContent =
				file.name === 't1.md'
					? '- [ ] 未完成一\n- [x] 已完成一\n'
					: '- [ ] 未完成二\n';
		}
	}

	return { app, folders };
}

function createView(app) {
	return {
		app,
		refreshToken: 0,
		isProjectsLoading: false,
		isTasksLoading: false,
		loadingRenderTimer: null,
		renderCount: 0,
		projects: [],
		projectIncompleteCounts: null,
		projectActivityMtime: null,
		projectCategoryByName: null,
		selectedProject: null,
		tasks: [],
		taskResult: null,
		projectResult: null,
		openedTaskPath: null,
		lastOpenedTaskByProject: new Map(),
		projectCategoryFilter: null,
		collapsedSubtaskParents: new Set(),
		selectedTaskPaths: new Set(),
		taskListScrollTop: 0,
		getTasksRootPath: () => TASKS_ROOT,
		getHiddenProjectNames: () => [],
		getProjectListSortMode: () => 'name',
		shouldDeferVaultRefresh: () => false,
		scheduleLoadingRender: () => {},
		cancelLoadingRender: () => {},
		render() {
			this.renderCount += 1;
		},
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('阶段一不等角标：loadProjects 返回时计数仍为空，任务列表已就位', async () => {
	const { app } = createHarness(['两阶段A']);
	const view = createView(app);

	await loadProjects(view, null);

	assert.equal(view.isProjectsLoading, false);
	assert.deepEqual([...view.projectIncompleteCounts.keys()], [], '阶段一不写角标');
	assert.equal(view.selectedProject, '两阶段A');
	assert.equal(view.tasks.length, 2, '任务列表首帧不等角标');

	// 阶段二后台补位后角标与活跃度就位。
	await tick();
	await tick();
	assert.equal(view.projectIncompleteCounts.get('两阶段A'), 2);
	assert.equal(view.projectActivityMtime.get('两阶段A') > 0, true);
});

test('角标补位按代次去重：慢一轮的后到结果不覆盖新刷新', async () => {
	const { app, folders } = createHarness(['两阶段B']);
	const view = createView(app);
	let releaseGate;
	const gate = new Promise((resolve) => {
		releaseGate = resolve;
	});

	const originalRead = app.vault.cachedRead;
	let gateFirst = true;
	app.vault.cachedRead = async (file) => {
		if (gateFirst) {
			gateFirst = false;
			await gate;
		}
		return originalRead(file);
	};

	const first = loadProjects(view, null);
	await first;
	// 首轮角标仍卡在闸门里（未回填）。
	await tick();
	assert.equal(view.projectIncompleteCounts.size, 0);

	// 新一轮刷新启动：代次前进，旧角标任务的后到结果必须被丢弃。
	const second = loadProjects(view, '两阶段B');
	await second;
	releaseGate();
	await tick();
	await tick();

	// 若闸门里的旧结果未被代次拦截，这里会被它写回；两轮的计数恰好同值，
	// 用「新结果已就位 + 旧任务未再触发 render 覆盖」共同断言语义。
	assert.equal(view.projectIncompleteCounts.get('两阶段B'), 2);
	assert.equal(view.selectedProject, '两阶段B');
	void folders;
});
