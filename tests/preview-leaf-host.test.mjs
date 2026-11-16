import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// `ensurePreviewLeafFor` 宿主层单测（[[Plan-20261116-155634]] §6.2）。
// 与 `preview-leaf-placement.test.mjs` 同范式：jiti 直载 + obsidian 别名桩。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { ensurePreviewLeafFor } = await jiti.import(
	'../src/views/tasks-center/preview-leaf.ts',
);

const LEFT = { id: 'left' };
const RIGHT = { id: 'right' };
const ROOT = { id: 'root' };

function makeLeaf({ id = 'leaf', root = ROOT, viewType = 'markdown', isDeferred = false } = {}) {
	return {
		id,
		getRoot: () => root,
		isDeferred,
		view: { getViewType: () => viewType },
		parent: { id: 'tabs' },
	};
}

function makeWorkspace(anchor) {
	const calls = { split: [], tab: 0 };
	const created = makeLeaf({ id: 'created', root: ROOT });
	const tabLeaf = makeLeaf({ id: 'tab-leaf', root: ROOT });
	const ws = {
		leftSplit: LEFT,
		rightSplit: RIGHT,
		rootSplit: ROOT,
		getMostRecentLeaf: (root) => (root === ROOT ? anchor : null),
		iterateAllLeaves: () => {},
		createLeafBySplit: (anchorLeaf, direction) => {
			calls.split.push([anchorLeaf, direction]);
			return created;
		},
		getLeaf: (kind) => {
			calls.tab += 1;
			assert.equal(kind, 'tab');
			return tabLeaf;
		},
	};
	return { ws, calls, created, tabLeaf };
}

function makeHost({
	leaf,
	workspace,
	available = [],
	reusable,
	previewLeaf = null,
}) {
	const host = {
		app: { workspace },
		leaf,
		previewLeaf,
		isLeafAvailable: (candidate) => available.includes(candidate),
	};
	if (reusable !== undefined) {
		host.findReusablePreviewLeaf = () => reusable;
	}
	return host;
}

test('缓存叶可用且在主区：原样返回，不建叶不回捞', () => {
	const { ws, calls } = makeWorkspace(null);
	const hostLeaf = makeLeaf({ id: 'quadrant' });
	const cached = makeLeaf({ id: 'cached' });
	const host = makeHost({
		leaf: hostLeaf,
		workspace: ws,
		available: [cached],
		previewLeaf: cached,
		reusable: makeLeaf({ id: 'other' }),
	});

	assert.equal(ensurePreviewLeafFor(host), cached);
	assert.equal(host.previewLeaf, cached);
	assert.deepEqual(calls.split, []);
	assert.equal(calls.tab, 0);
});

test('缓存叶已失效：走放置策略新建', () => {
	const { ws, calls, created } = makeWorkspace(null);
	const hostLeaf = makeLeaf({ id: 'quadrant' });
	const stale = makeLeaf({ id: 'stale' });
	const host = makeHost({
		leaf: hostLeaf,
		workspace: ws,
		available: [],
		previewLeaf: stale,
	});

	assert.equal(ensurePreviewLeafFor(host), created);
	assert.deepEqual(calls.split, [[hostLeaf, 'vertical']]);
	assert.equal(host.previewLeaf, created);
});

test('缓存叶位于侧栏：拒绝复用，锚主区最近叶分栏', () => {
	const anchor = makeLeaf({ id: 'anchor' });
	const { ws, calls, created } = makeWorkspace(anchor);
	const hostLeaf = makeLeaf({ id: 'quadrant', root: LEFT });
	const cached = makeLeaf({ id: 'side-cached', root: RIGHT });
	const host = makeHost({
		leaf: hostLeaf,
		workspace: ws,
		available: [cached],
		previewLeaf: cached,
	});

	assert.equal(ensurePreviewLeafFor(host), created);
	assert.deepEqual(calls.split, [[anchor, 'vertical']]);
});

test('回捞叶在主区可用：使用并写回 host.previewLeaf', () => {
	const { ws, calls } = makeWorkspace(null);
	const hostLeaf = makeLeaf({ id: 'quadrant' });
	const reusable = makeLeaf({ id: 'reusable' });
	const host = makeHost({
		leaf: hostLeaf,
		workspace: ws,
		available: [reusable],
		previewLeaf: null,
		reusable,
	});

	assert.equal(ensurePreviewLeafFor(host), reusable);
	assert.equal(host.previewLeaf, reusable);
	assert.deepEqual(calls.split, []);
});

test('回捞叶位于侧栏：拒绝，走放置策略', () => {
	const { ws, calls, created } = makeWorkspace(null);
	const hostLeaf = makeLeaf({ id: 'quadrant' });
	const reusable = makeLeaf({ id: 'reusable', root: LEFT });
	const host = makeHost({
		leaf: hostLeaf,
		workspace: ws,
		available: [reusable],
		previewLeaf: null,
		reusable,
	});

	assert.equal(ensurePreviewLeafFor(host), created);
	assert.deepEqual(calls.split, [[hostLeaf, 'vertical']]);
});

test('宿主未实现回捞能力：不报错，直接放置', () => {
	const { ws, calls, created } = makeWorkspace(null);
	const hostLeaf = makeLeaf({ id: 'quadrant' });
	const host = makeHost({
		leaf: hostLeaf,
		workspace: ws,
		available: [],
	});

	assert.equal(ensurePreviewLeafFor(host), created);
	assert.deepEqual(calls.split, [[hostLeaf, 'vertical']]);
});

test('宿主叶在侧栏且主区无锚：退回主区新标签页', () => {
	const { ws, calls, tabLeaf } = makeWorkspace(null);
	const hostLeaf = makeLeaf({ id: 'quadrant', root: LEFT });
	const host = makeHost({
		leaf: hostLeaf,
		workspace: ws,
		available: [],
	});

	assert.equal(ensurePreviewLeafFor(host), tabLeaf);
	assert.equal(calls.tab, 1);
	assert.deepEqual(calls.split, []);
});

test('宿主叶在主区：紧邻自身右侧分栏', () => {
	const { ws, calls, created } = makeWorkspace(null);
	const hostLeaf = makeLeaf({ id: 'quadrant' });
	const host = makeHost({
		leaf: hostLeaf,
		workspace: ws,
		available: [],
	});

	assert.equal(ensurePreviewLeafFor(host), created);
	assert.deepEqual(calls.split, [[hostLeaf, 'vertical']]);
});
