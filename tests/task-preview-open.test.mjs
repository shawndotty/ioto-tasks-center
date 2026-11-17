import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 视图中立打开模块的宿主层单测（[[Plan-20261117-062052]] §6.1）。
// 与 `preview-leaf-host.test.mjs` 同范式：jiti 直载 + obsidian 别名桩。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { openTaskInPreviewLeaf, openTaskInTab } = await jiti.import(
	'../src/views/task-preview-open.ts',
);
const { TFile, FileView } = await jiti.import('./stubs/obsidian.mjs');

const LEFT = { id: 'left' };
const RIGHT = { id: 'right' };
const ROOT = { id: 'root' };

function makeFile(path) {
	return new TFile(path);
}

/** 建一个可记录的桩叶：view 用 FileView 实例以便 `instanceof FileView` 成立。 */
function makeLeaf({
	id = 'leaf',
	root = ROOT,
	parent = { id: 'tabs' },
	file = null,
	viewType = 'markdown',
} = {}) {
	let currentFile = file;
	let currentType = viewType;
	const calls = { openFile: [], setViewState: [], setActiveLeaf: [] };
	const leaf = {
		id,
		parent,
		isDeferred: false,
		getRoot: () => root,
		getViewState() {
			return {
				type: currentType,
				state: currentFile ? { file: currentFile.path } : {},
			};
		},
		setViewState(state) {
			calls.setViewState.push(state);
			currentType = state.type;
			if (state.state?.file) {
				currentFile = makeFile(state.state.file);
			}
			return Promise.resolve();
		},
		openFile(target) {
			calls.openFile.push(target);
			currentFile = target;
			currentType = 'markdown';
			return Promise.resolve();
		},
		calls,
	};
	leaf.view = Object.assign(new FileView(), {
		file: file,
		getViewType: () => currentType,
	});
	return leaf;
}

function makeWorkspace({ leaves = [], allLeaves = null, mostRecent = null } = {}) {
	const calls = { setActiveLeaf: [], getLeaf: [] };
	const created = makeLeaf({ id: 'created' });
	const tabLeaf = makeLeaf({ id: 'tab-leaf' });
	const ws = {
		leftSplit: LEFT,
		rightSplit: RIGHT,
		rootSplit: ROOT,
		getMostRecentLeaf: (root) => (root === ROOT ? mostRecent : null),
		iterateAllLeaves: (cb) => {
			for (const leaf of allLeaves ?? leaves) cb(leaf);
		},
		getLeaf: (kind, direction) => {
			calls.getLeaf.push([kind, direction]);
			if (kind === 'tab') return tabLeaf;
			return created;
		},
		setActiveLeaf: (leaf, options) => {
			calls.setActiveLeaf.push([leaf, options]);
		},
	};
	return { ws, calls, created, tabLeaf };
}

function makeHost({
	workspace,
	leaf,
	file = null,
	files = {},
	previewLeaf = null,
	openedTaskPath = null,
	available = [],
	preferTaskView = false,
	tasksRootPath = '3-任务',
	onTaskOpened,
	onOpeningChange,
} = {}) {
	const host = {
		app: {
			workspace,
			vault: {
				getAbstractFileByPath: (path) =>
					path in files ? files[path] : null,
			},
		},
		leaf,
		previewLeaf,
		openedTaskPath,
		isLeafAvailable: (candidate) => available.includes(candidate),
		ensurePreviewLeaf: () => previewLeaf ?? null,
		getTasksRootPath: () => tasksRootPath,
		getUseIOTOTaskViewAsDefault: () => preferTaskView,
	};
	if (onTaskOpened) host.onTaskOpened = onTaskOpened;
	if (onOpeningChange) host.onOpeningChange = onOpeningChange;
	if (file) files[file.path] = file;
	return host;
}

test('文件缺失：返回 missing，不建叶、不触发 openingChange', async () => {
	const { ws } = makeWorkspace();
	const hostLeaf = makeLeaf({ id: 'host' });
	const preview = makeLeaf({ id: 'preview' });
	const openingCalls = [];
	const host = makeHost({
		workspace: ws,
		leaf: hostLeaf,
		previewLeaf: preview,
		available: [preview],
		onOpeningChange: (p) => openingCalls.push(p),
	});

	const result = await openTaskInPreviewLeaf(host, '3-任务/P/缺失.md');

	assert.equal(result.status, 'missing');
	assert.deepEqual(openingCalls, []);
	assert.deepEqual(preview.calls.setViewState, []);
	assert.deepEqual(preview.calls.openFile, []);
});

test('同任务已预览：返回 skipped，只激活预览叶', async () => {
	const file = makeFile('3-任务/P/T.md');
	const preview = makeLeaf({ id: 'preview', file });
	const { ws, calls } = makeWorkspace();
	const host = makeHost({
		workspace: ws,
		leaf: makeLeaf({ id: 'host' }),
		file,
		previewLeaf: preview,
		openedTaskPath: file.path,
		available: [preview],
	});

	const result = await openTaskInPreviewLeaf(host, file.path);

	assert.equal(result.status, 'skipped');
	assert.equal(calls.setActiveLeaf.length, 1);
	assert.equal(calls.setActiveLeaf[0][0], preview);
	assert.deepEqual(preview.calls.setViewState, []);
	assert.deepEqual(preview.calls.openFile, []);
});

test('openedTaskPath 相同但预览叶展示别的文件：走正常打开', async () => {
	const file = makeFile('3-任务/P/T.md');
	const other = makeFile('3-任务/P/Other.md');
	const preview = makeLeaf({ id: 'preview', file: other });
	const { ws } = makeWorkspace();
	const host = makeHost({
		workspace: ws,
		leaf: makeLeaf({ id: 'host' }),
		file,
		previewLeaf: preview,
		openedTaskPath: file.path,
		available: [preview],
	});

	const result = await openTaskInPreviewLeaf(host, file.path);

	assert.equal(result.status, 'opened');
	assert.equal(result.leaf, preview);
	assert.equal(preview.calls.openFile.length, 1);
});

test('不同任务复用预览叶：opened + 更新状态 + 调 onTaskOpened', async () => {
	const file = makeFile('3-任务/P/T.md');
	const preview = makeLeaf({ id: 'preview' });
	const { ws } = makeWorkspace();
	const opened = [];
	const host = makeHost({
		workspace: ws,
		leaf: makeLeaf({ id: 'host' }),
		file,
		previewLeaf: preview,
		openedTaskPath: '3-任务/P/Previous.md',
		available: [preview],
		onTaskOpened: (p) => opened.push(p),
	});

	const result = await openTaskInPreviewLeaf(host, file.path);

	assert.equal(result.status, 'opened');
	assert.equal(result.leaf, preview);
	assert.equal(host.openedTaskPath, file.path);
	assert.deepEqual(opened, [file.path]);
	assert.equal(preview.calls.openFile.length, 1);
});

test('偏好任务视图 + 任务笔记：以 IOTOTask 打开', async () => {
	const file = makeFile('3-任务/P/T.md');
	const preview = makeLeaf({ id: 'preview' });
	const { ws } = makeWorkspace();
	const host = makeHost({
		workspace: ws,
		leaf: makeLeaf({ id: 'host' }),
		file,
		previewLeaf: preview,
		available: [preview],
		preferTaskView: true,
	});

	await openTaskInPreviewLeaf(host, file.path);

	assert.equal(preview.calls.setViewState.length, 1);
	assert.equal(preview.calls.setViewState[0].type, 'IOTOTask');
	assert.equal(preview.calls.openFile.length, 0);
});

test('偏好关闭：走 leaf.openFile（默认 Markdown）', async () => {
	const file = makeFile('3-任务/P/T.md');
	const preview = makeLeaf({ id: 'preview' });
	const { ws } = makeWorkspace();
	const host = makeHost({
		workspace: ws,
		leaf: makeLeaf({ id: 'host' }),
		file,
		previewLeaf: preview,
		available: [preview],
		preferTaskView: false,
	});

	await openTaskInPreviewLeaf(host, file.path);

	assert.equal(preview.calls.openFile.length, 1);
	assert.equal(preview.calls.setViewState.length, 0);
});

test('cursorOffset: 0 合法：以 source 模式打开（0 不当缺省）', async () => {
	const file = makeFile('3-任务/P/T.md');
	const preview = makeLeaf({ id: 'preview' });
	const { ws } = makeWorkspace();
	const host = makeHost({
		workspace: ws,
		leaf: makeLeaf({ id: 'host' }),
		file,
		previewLeaf: preview,
		available: [preview],
	});

	await openTaskInPreviewLeaf(host, file.path, { cursorOffset: 0 });

	assert.ok(preview.calls.setViewState.length >= 1);
	assert.equal(preview.calls.setViewState[0].type, 'markdown');
	assert.equal(preview.calls.setViewState[0].state.mode, 'source');
});

test('Alt 当前标签组已有同文件：只激活，不新建标签', async () => {
	const file = makeFile('3-任务/P/T.md');
	const tabGroup = { id: 'tabs' };
	const hostLeaf = makeLeaf({ id: 'host', parent: tabGroup });
	const existing = makeLeaf({ id: 'existing', parent: tabGroup, file });
	const { ws, calls } = makeWorkspace({ allLeaves: [hostLeaf, existing] });
	const host = makeHost({
		workspace: ws,
		leaf: hostLeaf,
		file,
	});

	const result = await openTaskInTab(host, file.path, 'current-pane-tab');

	assert.equal(result.status, 'opened');
	assert.deepEqual(calls.getLeaf, []);
	assert.equal(calls.setActiveLeaf.length, 1);
	assert.equal(calls.setActiveLeaf[0][0], existing);
});

test('Alt 组内无同文件：getLeaf(tab) + 打开 + 记录', async () => {
	const file = makeFile('3-任务/P/T.md');
	const tabGroup = { id: 'tabs' };
	const hostLeaf = makeLeaf({ id: 'host', parent: tabGroup });
	const { ws, calls, tabLeaf } = makeWorkspace({ allLeaves: [hostLeaf] });
	const opened = [];
	const host = makeHost({
		workspace: ws,
		leaf: hostLeaf,
		file,
		onTaskOpened: (p) => opened.push(p),
	});

	const result = await openTaskInTab(host, file.path, 'current-pane-tab');

	assert.equal(result.status, 'opened');
	assert.deepEqual(calls.getLeaf, [['tab', undefined]]);
	assert.equal(tabLeaf.calls.openFile.length, 1);
	assert.equal(host.openedTaskPath, file.path);
	assert.deepEqual(opened, [file.path]);
});

test('Alt+Cmd 全工作区已打开：只激活，不 getLeaf(split)', async () => {
	const file = makeFile('3-任务/P/T.md');
	const hostLeaf = makeLeaf({ id: 'host' });
	const existing = makeLeaf({ id: 'existing', file });
	const { ws, calls } = makeWorkspace({ allLeaves: [hostLeaf, existing] });
	const host = makeHost({ workspace: ws, leaf: hostLeaf, file });

	const result = await openTaskInTab(host, file.path, 'right-split-tab');

	assert.equal(result.status, 'opened');
	assert.deepEqual(calls.getLeaf, []);
	assert.equal(calls.setActiveLeaf[0][0], existing);
});

test('Alt+Cmd 未打开：getLeaf(split, vertical) + 打开', async () => {
	const file = makeFile('3-任务/P/T.md');
	const hostLeaf = makeLeaf({ id: 'host' });
	const { ws, calls, created } = makeWorkspace({ allLeaves: [hostLeaf] });
	const host = makeHost({ workspace: ws, leaf: hostLeaf, file });

	const result = await openTaskInTab(host, file.path, 'right-split-tab');

	assert.equal(result.status, 'opened');
	assert.deepEqual(calls.getLeaf, [['split', 'vertical']]);
	assert.equal(created.calls.openFile.length, 1);
	assert.equal(host.openedTaskPath, file.path);
});

test('Alt 分支文件缺失：返回 missing，不建标签', async () => {
	const tabGroup = { id: 'tabs' };
	const hostLeaf = makeLeaf({ id: 'host', parent: tabGroup });
	const { ws, calls } = makeWorkspace({ allLeaves: [hostLeaf] });
	const host = makeHost({ workspace: ws, leaf: hostLeaf });

	const result = await openTaskInTab(host, '3-任务/P/缺失.md', 'current-pane-tab');

	assert.equal(result.status, 'missing');
	assert.deepEqual(calls.getLeaf, []);
});
