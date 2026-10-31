import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { checkForeignDropTarget } = await jiti.import(
	'../src/views/ioto-task/task-view-transfer-guard.ts',
);

const SRC = '3-任务/A.md';

/** 可受理的基线目标；用例只覆盖要测的那一项。 */
function makeTarget(overrides = {}) {
	return {
		file: { path: '3-任务/B.md' },
		data: '# 任务\n- [ ] A',
		// `resolveEditingKind` 的「无编辑器」取值是 `null`，不是 'idle'。
		editingKind: null,
		zoomLine: null,
		sectionZoomLine: null,
		filters: {
			onlyTaskBlocks: false,
			onlyPending: false,
			recentOnly: false,
		},
		searchQuery: '',
		supportsInlineEdit: () => true,
		...overrides,
	};
}

test('基线：可写、空闲、无过滤 → 受理', () => {
	assert.deepEqual(checkForeignDropTarget(makeTarget(), SRC), { ok: true });
});

test('not-ready：null 入参 / 无文件 / 无内容', () => {
	assert.deepEqual(checkForeignDropTarget(null, SRC), {
		ok: false,
		reason: 'not-ready',
	});
	assert.deepEqual(checkForeignDropTarget(makeTarget({ file: null }), SRC), {
		ok: false,
		reason: 'not-ready',
	});
	assert.deepEqual(checkForeignDropTarget(makeTarget({ data: '' }), SRC), {
		ok: false,
		reason: 'not-ready',
	});
});

test('readonly：不支持内联编辑', () => {
	assert.equal(
		checkForeignDropTarget(
			makeTarget({ supportsInlineEdit: () => false }),
			SRC,
		).reason,
		'readonly',
	);
});

test('editing：目标正在编辑', () => {
	assert.equal(
		checkForeignDropTarget(makeTarget({ editingKind: 'card' }), SRC).reason,
		'editing',
	);
});

test('zoomed：目标处于放大态', () => {
	assert.equal(
		checkForeignDropTarget(makeTarget({ zoomLine: 1 }), SRC).reason,
		'zoomed',
	);
});

test('section-zoomed：目标处于只看本节', () => {
	assert.equal(
		checkForeignDropTarget(makeTarget({ sectionZoomLine: 0 }), SRC).reason,
		'section-zoomed',
	);
});

test('filtered：三个过滤开关任一', () => {
	for (const key of ['onlyTaskBlocks', 'onlyPending', 'recentOnly']) {
		const target = makeTarget();
		target.filters = { ...target.filters, [key]: true };
		assert.equal(checkForeignDropTarget(target, SRC).reason, 'filtered', key);
	}
});

test('searching：目标有搜索词', () => {
	assert.equal(
		checkForeignDropTarget(makeTarget({ searchQuery: 'abc' }), SRC).reason,
		'searching',
	);
});

test('same-file：同一文件（含两个叶子开同一文件）', () => {
	assert.equal(
		checkForeignDropTarget(makeTarget({ file: { path: SRC } }), SRC).reason,
		'same-file',
	);
});
