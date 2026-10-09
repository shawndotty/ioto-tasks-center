import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

/**
 * 编辑态判据真源（[[Plan-20261010-070400]] 批次 0）。
 *
 * `TaskViewHost` 接口只能保证 13 处判据用到的**字段存在**，保证不了它们彼此一致
 * —— 编译器管不到的语义只能靠测试管。本文件锁三件事：
 *   ① 4 kind × 5 语义的判定表；
 *   ② 行号 `0` / 缺字段桩的边界（防 truthy 与 `!== null` 判据回归）；
 *   ③ 「推导式只看行号、不看 handle」这条不变式。
 */
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	resolveEditingKind,
	hasLiveEditor,
	isCardEditing,
	isCardOrContinuationEditing,
	isSectionEditing,
	keepVisibleCardLine,
	resetEditingLines,
	COMMIT_BY_KIND,
} = await jiti.import(
	'../src/views/ioto-task/task-view-editing-state.ts',
);

/** 构造宿主状态面；省略 `sectionEditLine` 即模拟「旧测试桩 / 未接线」场景。 */
function host(overrides = {}) {
	return {
		editingLine: null,
		continuationLine: null,
		sectionEditLine: null,
		...overrides,
	};
}

/* ------------------------------------------------------------------ *
 * ① 穷举判定表：4 kind × 5 语义
 * ------------------------------------------------------------------ */

const TABLE = [
	// [kind, 宿主, hasLiveEditor, isCard, isCardOrContinuation, isSection, keepVisible]
	['null', host(), false, false, false, false, null],
	['card', host({ editingLine: 5 }), true, true, true, false, 5],
	[
		'continuation',
		host({ continuationLine: 7 }),
		true,
		false,
		true,
		false,
		7,
	],
	['section', host({ sectionEditLine: 2 }), true, false, false, true, null],
];

for (const [
	kind,
	state,
	live,
	card,
	cardOrCont,
	section,
	keepVisible,
] of TABLE) {
	test(`判定表：kind = ${kind}`, () => {
		const resolved = resolveEditingKind(state);
		assert.equal(resolved, kind === 'null' ? null : kind);
		assert.equal(hasLiveEditor(resolved), live);
		assert.equal(isCardEditing(resolved), card);
		assert.equal(isCardOrContinuationEditing(resolved), cardOrCont);
		assert.equal(isSectionEditing(resolved), section);
		assert.equal(keepVisibleCardLine(state), keepVisible);
	});
}

/* ------------------------------------------------------------------ *
 * ② 边界：行号 0 / 缺字段桩
 * ------------------------------------------------------------------ */

test('边界：行号 0 是合法值 —— 三种编辑器都必须判为「有编辑器」', () => {
	assert.equal(resolveEditingKind(host({ editingLine: 0 })), 'card');
	assert.equal(hasLiveEditor(resolveEditingKind(host({ editingLine: 0 }))), true);
	assert.equal(resolveEditingKind(host({ continuationLine: 0 })), 'continuation');
	assert.equal(resolveEditingKind(host({ sectionEditLine: 0 })), 'section');
	// 渲染层同理：第 0 行的卡要被无条件保留
	assert.equal(keepVisibleCardLine(host({ editingLine: 0 })), 0);
});

test('边界：测试桩缺 sectionEditLine（undefined）→ 不得误判为 Section 编辑', () => {
	const stub = { editingLine: null, continuationLine: null };
	assert.equal(resolveEditingKind(stub), null);
	assert.equal(hasLiveEditor(resolveEditingKind(stub)), false);
	assert.equal(isSectionEditing(resolveEditingKind(stub)), false);
	assert.equal(keepVisibleCardLine(stub), null);
});

test('边界：三者互斥，优先级 card > continuation > section', () => {
	// 理论上不会同时出现（进入一方前先提交另一方）；真出现时按表优先到先得。
	assert.equal(
		resolveEditingKind(
			host({ editingLine: 5, continuationLine: 7, sectionEditLine: 2 }),
		),
		'card',
	);
	assert.equal(
		resolveEditingKind(host({ continuationLine: 7, sectionEditLine: 2 })),
		'continuation',
	);
});

/* ------------------------------------------------------------------ *
 * ③ 不变式钉子：推导式只看行号，不看 handle
 * ------------------------------------------------------------------ */

test('不变式：行号已置 / handle 未置 → 仍返回对应 kind（A1 依赖此窗口）', () => {
	// `beginEdit` 里存在「行号已置、handle 未置」的窗口，该窗口必须继续挡重绘，
	// 否则外部 vault.modify 会把刚挂上的编辑器冲掉。
	const midBegin = { ...host({ editingLine: 3 }), editingHandle: null };
	assert.equal(resolveEditingKind(midBegin), 'card');
	assert.equal(hasLiveEditor(resolveEditingKind(midBegin)), true);

	const midContinuation = {
		...host({ continuationLine: 3 }),
		continuationHandle: null,
	};
	assert.equal(resolveEditingKind(midContinuation), 'continuation');
});

test('不变式：keepVisibleCardLine 走判定表 —— Section 编辑不保留任何卡', () => {
	// 渲染层若自己取 `editingLine ?? continuationLine`，Section 编辑态会错误保留
	// 上一张编辑过的卡；真源必须先过 isCardOrContinuationEditing。
	const section = host({ editingLine: null, sectionEditLine: 2 });
	assert.equal(keepVisibleCardLine(section), null);
	const stale = host({ continuationLine: 9, sectionEditLine: 2 });
	assert.equal(keepVisibleCardLine(stale), 9);
});

/* ------------------------------------------------------------------ *
 * C 组：清字段 / 提交表
 * ------------------------------------------------------------------ */

test('resetEditingLines：三个行号字段整体清零（含 sectionEditLine）', () => {
	const view = host({ editingLine: 5, continuationLine: 7, sectionEditLine: 2 });
	resetEditingLines(view);
	assert.deepEqual(
		[view.editingLine, view.continuationLine, view.sectionEditLine],
		[null, null, null],
	);
	assert.equal(resolveEditingKind(view), null);
});

test('COMMIT_BY_KIND：三种 kind 各有一个提交器，插入顺序 = card → continuation', () => {
	assert.deepEqual(Object.keys(COMMIT_BY_KIND), [
		'card',
		'continuation',
		'section',
	]);
	for (const kind of Object.keys(COMMIT_BY_KIND)) {
		assert.equal(typeof COMMIT_BY_KIND[kind], 'function');
	}
});

test('COMMIT_BY_KIND：按表提交 = 先标题后续写（与重构前 flushInlineEdits 同序）', async () => {
	const calls = [];
	const view = {
		commitEdit: () => {
			calls.push('card');
			return Promise.resolve();
		},
		commitContinuationEdit: () => {
			calls.push('continuation');
			return Promise.resolve();
		},
	};
	for (const commit of Object.values(COMMIT_BY_KIND)) {
		await commit(view);
	}
	assert.deepEqual(calls, ['card', 'continuation']);
});
