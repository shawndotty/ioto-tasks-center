import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// Section 批量折叠 / 展开（[[Plan-20261024-065930]] S6）。
// 两个被测模块都只依赖纯模块（section-fold-key / fold-store / note-structure），
// 零 obsidian，故 jiti 可直接导入源码，无需先构建、无需桩。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { collectSectionFoldKeys } = await jiti.import(
	'../src/views/ioto-task/section-fold-key.ts',
);
const { hasSectionFolds, toggleAllSectionFolds } = await jiti.import(
	'../src/views/ioto-task/task-view-section-fold.ts',
);
const {
	loadContinuationFolds,
	loadSectionFolds,
	saveContinuationFolds,
} = await jiti.import('../src/views/ioto-task/task-view-fold-store.ts');

/** 假宿主：底层 Map 存完整键（`<appId>-<key>`），`save(key, null)` 即删除。 */
function makeStorage({ appId = 'aaa' } = {}) {
	const map = new Map();
	const app = {
		appId,
		loadLocalStorage: (key) =>
			map.has(`${appId}-${key}`) ? map.get(`${appId}-${key}`) : null,
		saveLocalStorage: (key, data) => {
			const full = `${appId}-${key}`;
			if (data === null) {
				map.delete(full);
			} else {
				map.set(full, data);
			}
		},
	};
	return { map, app };
}

/**
 * 假视图：toggleAllSectionFolds 只碰 app / file / data / collapsedSections /
 * sectionZoomLine / 三个宿主方法。调用顺序记在 `calls` 里供顺序断言。
 */
function makeView({
	app,
	path = 'A.md',
	data = '',
	sectionZoomLine = null,
	calls = [],
} = {}) {
	return {
		app,
		file: path === null ? null : { path },
		data,
		collapsedSections: new Set(),
		sectionZoomLine,
		calls,
		renderNoteCalls: [],
		async flushInlineEdits() {
			calls.push('flushInlineEdits');
		},
		exitSectionZoom() {
			calls.push('exitSectionZoom');
			this.sectionZoomLine = null;
		},
		renderNote(nextData, options) {
			calls.push('renderNote');
			this.renderNoteCalls.push({ data: nextData, options });
		},
	};
}

const NESTED = ['# A', '- [ ] a', '## 子节', '- [ ] a2', '', '# B', '- [ ] b', ''].join(
	'\n',
);

test('空串 → []', () => {
	assert.deepEqual(collectSectionFoldKeys(''), []);
});

test('只有引导区（首个标题之前）→ []（不产 s:0: 键）', () => {
	const note = ['- [ ] a', '- [ ] b', ''].join('\n');
	assert.deepEqual(collectSectionFoldKeys(note), []);
});

test('嵌套标题归父 root → 只 1 个键', () => {
	assert.deepEqual(collectSectionFoldKeys(NESTED), ['s:1:A', 's:1:B']);
});

test('# A + 引导区卡 + # B → 引导区不额外产键', () => {
	const note = ['- [ ] lead', '', '# A', '- [ ] a', '', '# B', '- [ ] b', ''].join(
		'\n',
	);
	assert.deepEqual(collectSectionFoldKeys(note), ['s:1:A', 's:1:B']);
});

test('两个同名同层 → 两个相同键（不去重，锁定 fail-open 共享态）', () => {
	const note = ['# 同名', '- [ ] a', '', '# 同名', '- [ ] b', ''].join('\n');
	const keys = collectSectionFoldKeys(note);
	assert.equal(keys.length, 2);
	assert.deepEqual(keys, ['s:1:同名', 's:1:同名']);
});

test('CRLF 与 LF 同一笔记 → 同键数组', () => {
	const lf = collectSectionFoldKeys(NESTED);
	const crlf = collectSectionFoldKeys(NESTED.replace(/\n/g, '\r\n'));
	assert.deepEqual(crlf, lf);
});

test('折叠方向：集合 = 全键、renderNote 带 resetScroll、store 只换 sections', async () => {
	const { app } = makeStorage();
	saveContinuationFolds(app, 'A.md', ['c12345678']);
	const view = makeView({ app, data: NESTED });

	assert.equal(await toggleAllSectionFolds(view), true);
	assert.deepEqual([...view.collapsedSections], ['s:1:A', 's:1:B']);
	assert.equal(view.renderNoteCalls.length, 1);
	assert.deepEqual(view.renderNoteCalls[0].options, { resetScroll: true });
	assert.deepEqual(loadSectionFolds(app, 'A.md'), ['s:1:A', 's:1:B']);
	// 补丁写：续写区折叠态不被冲掉
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), ['c12345678']);
});

test('展开方向：集合清空、renderNote 无 options、store 的 sections = []', async () => {
	const { app } = makeStorage();
	const view = makeView({ app, data: NESTED });
	view.collapsedSections.add('s:1:A');
	view.collapsedSections.add('s:1:B');

	assert.equal(await toggleAllSectionFolds(view), true);
	assert.equal(view.collapsedSections.size, 0);
	assert.equal(view.renderNoteCalls.length, 1);
	assert.equal(view.renderNoteCalls[0].options, undefined);
	assert.deepEqual(loadSectionFolds(app, 'A.md'), []);
	assert.notEqual(loadSectionFolds(app, 'A.md'), null);
});

test('门禁与前置顺序', async () => {
	// (a) 无节笔记 → 门禁 false、toggle false、不重绘、不落盘
	const noSection = makeStorage();
	const plain = makeView({
		app: noSection.app,
		data: ['- [ ] a', '- [ ] b', ''].join('\n'),
	});
	assert.equal(hasSectionFolds(plain), false);
	assert.equal(await toggleAllSectionFolds(plain), false);
	assert.equal(plain.renderNoteCalls.length, 0);
	assert.equal(noSection.map.size, 0);
	// 有节笔记时门禁放行
	assert.equal(hasSectionFolds(makeView({ app: noSection.app, data: NESTED })), true);

	// (b) 聚焦态 → 调用顺序 flush → exit → render
	const focused = makeView({
		app: makeStorage().app,
		data: NESTED,
		sectionZoomLine: 4,
	});
	assert.equal(await toggleAllSectionFolds(focused), true);
	assert.deepEqual(focused.calls, [
		'flushInlineEdits',
		'exitSectionZoom',
		'renderNote',
	]);
});
