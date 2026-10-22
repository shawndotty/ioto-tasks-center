import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const {
	isLeafInSidebar,
	resolvePreviewLeafPlacement,
} = await jiti.import('../src/views/tasks-center/preview-leaf.ts');

const LEFT = { id: 'left' };
const RIGHT = { id: 'right' };
const ROOT = { id: 'root' };

// 造一个「身份比较」可用的最小 workspace：三种根都用普通对象占位。
function makeWorkspace(anchor) {
	return {
		leftSplit: LEFT,
		rightSplit: RIGHT,
		rootSplit: ROOT,
		getMostRecentLeaf: (root) => (root === ROOT ? anchor : null),
	};
}

function makeLeaf({ root, viewType = 'markdown', isDeferred = false }) {
	return {
		getRoot: () => root,
		isDeferred,
		view: { getViewType: () => viewType },
		parent: { id: 'tabs' },
	};
}

test('isLeafInSidebar：左/右为真，主区为假', () => {
	const ws = makeWorkspace(null);
	assert.equal(isLeafInSidebar(ws, makeLeaf({ root: LEFT })), true);
	assert.equal(isLeafInSidebar(ws, makeLeaf({ root: RIGHT })), true);
	assert.equal(isLeafInSidebar(ws, makeLeaf({ root: ROOT })), false);
});

test('主区叶：仍按原行为紧邻右侧分栏', () => {
	const ws = makeWorkspace(null);
	const viewLeaf = makeLeaf({ root: ROOT });

	assert.deepEqual(resolvePreviewLeafPlacement(ws, viewLeaf), {
		kind: 'split',
		anchor: viewLeaf,
	});
});

test('侧栏叶 + 主区最近叶是真空格子：直接复用，不再拆一刀', () => {
	const anchor = makeLeaf({ root: ROOT, viewType: 'empty' });
	const ws = makeWorkspace(anchor);
	const viewLeaf = makeLeaf({ root: LEFT });

	assert.deepEqual(resolvePreviewLeafPlacement(ws, viewLeaf), {
		kind: 'reuse',
		leaf: anchor,
	});
});

test('延迟加载的空叶不算空：不能被覆写', () => {
	const anchor = makeLeaf({
		root: ROOT,
		viewType: 'empty',
		isDeferred: true,
	});
	const ws = makeWorkspace(anchor);
	const viewLeaf = makeLeaf({ root: RIGHT });

	assert.deepEqual(resolvePreviewLeafPlacement(ws, viewLeaf), {
		kind: 'split',
		anchor,
	});
});

test('侧栏叶 + 主区最近叶是笔记：拆主区那一叶', () => {
	const anchor = makeLeaf({ root: ROOT });
	const ws = makeWorkspace(anchor);
	const viewLeaf = makeLeaf({ root: LEFT });

	assert.deepEqual(resolvePreviewLeafPlacement(ws, viewLeaf), {
		kind: 'split',
		anchor,
	});
});

test('侧栏叶 + 主区没有可锚的叶：退回主区新标签页', () => {
	const ws = makeWorkspace(null);
	const viewLeaf = makeLeaf({ root: LEFT });

	assert.deepEqual(resolvePreviewLeafPlacement(ws, viewLeaf), { kind: 'tab' });
});
