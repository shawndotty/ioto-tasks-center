import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 任务视图搜索关键词的跨会话镜像（[[Plan-20261112-153653]] S1 / S9）。
// store 模块零 `obsidian` import，用 Map 假宿主直测；三个壳住在 task-view-search.ts，
// 该模块间接依赖 obsidian 运行时，按既有惯例 alias 到桩。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const {
	SEARCH_STORE_PREFIX,
	searchStoreKey,
	loadSearchQuery,
	saveSearchQuery,
	dropSearchQuery,
	renameSearchRecord,
	listStoredSearchPaths,
	pruneSearchQueries,
} = await jiti.import('../src/views/ioto-task/task-view-search-store.ts');
const { createFoldStorage } = await jiti.import(
	'../src/views/ioto-task/task-view-fold-store.ts',
);
const {
	hydrateSearchQuery,
	persistSearchQuery,
	forgetSearchQuery,
	closeSearch,
	resetSearchState,
} = await jiti.import('../src/views/ioto-task/task-view-search.ts');

/** 假宿主：底层 Map 存**完整键**（`<appId>-<key>`），`save(key, null)` 即删除。 */
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

const rawKey = (appId, path) => `${appId}-${SEARCH_STORE_PREFIX}${path}`;

/** 最小 DOM 桩：只覆盖搜索条用到的 class 操作与 value。 */
function makeEl({ classes = [] } = {}) {
	const set = new Set(classes);
	return {
		value: '',
		hasClass: (cls) => set.has(cls),
		addClass: (cls) => {
			set.add(cls);
		},
		removeClass: (cls) => {
			set.delete(cls);
		},
		classes: set,
	};
}

/** 假视图：三个壳只碰这几项。 */
function makeView({ app, path = 'A.md', query = '', barHidden = true } = {}) {
	const view = {
		app,
		file: path === null ? null : { path },
		searchQuery: query,
		searchBarEl: makeEl({ classes: barHidden ? ['is-hidden'] : [] }),
		searchInputEl: makeEl(),
		searchDebounce: null,
		selectedLine: null,
		renderCount: 0,
		toggleRefreshCount: 0,
		contentEl: { focus: () => {} },
		refreshSearchToggleState() {
			this.toggleRefreshCount += 1;
		},
		renderNote() {
			this.renderCount += 1;
		},
	};
	return view;
}

test('键名：前缀 + 原 path；无记录时 load 返回 null 且不写键', () => {
	assert.equal(searchStoreKey('3-任务/a.md'), `${SEARCH_STORE_PREFIX}3-任务/a.md`);
	const { app, map } = makeStorage();
	assert.equal(loadSearchQuery(app, 'A.md'), null);
	assert.equal(map.size, 0);
});

test('往返：写入后读回同一关键词，形态为 {v:1,query}', () => {
	const { app, map } = makeStorage();
	saveSearchQuery(app, 'A.md', '任务');
	assert.equal(loadSearchQuery(app, 'A.md'), '任务');
	assert.deepEqual(map.get(rawKey('aaa', 'A.md')), { v: 1, query: '任务' });
	// 覆盖写
	saveSearchQuery(app, 'A.md', '任务 搜索');
	assert.equal(loadSearchQuery(app, 'A.md'), '任务 搜索');
	// 空 path 不写
	saveSearchQuery(app, '', 'x');
	assert.equal(map.size, 1);
});

test('空串 = 删键（空搜索无可恢复语义）', () => {
	const { app, map } = makeStorage();
	saveSearchQuery(app, 'A.md', 'foo');
	assert.equal(map.has(rawKey('aaa', 'A.md')), true);
	saveSearchQuery(app, 'A.md', '');
	assert.equal(map.has(rawKey('aaa', 'A.md')), false);
	assert.equal(loadSearchQuery(app, 'A.md'), null);
	// 删不存在的键不抛
	dropSearchQuery(app, 'none.md');
	assert.equal(map.size, 0);
});

test('坏数据 / 坏版本 → null，不抛错', () => {
	const { app, map } = makeStorage();
	const key = rawKey('aaa', 'A.md');
	for (const raw of [
		'not json',
		{ v: 2, query: 'x' },
		{ v: 1, query: 42 },
		{ v: 1 },
		{ query: 'x' },
		null,
		42,
		[],
	]) {
		map.set(key, raw);
		assert.equal(loadSearchQuery(app, 'A.md'), null);
	}
	// loadLocalStorage / saveLocalStorage 自己抛错也要吞掉
	const throwing = makeStorage();
	throwing.app.loadLocalStorage = () => {
		throw new Error('boom');
	};
	assert.equal(loadSearchQuery(throwing.app, 'A.md'), null);
	const throwingSave = makeStorage();
	throwingSave.app.saveLocalStorage = () => {
		throw new Error('boom');
	};
	saveSearchQuery(throwingSave.app, 'A.md', 'x');
	dropSearchQuery(throwingSave.app, 'A.md');
});

test('rename：搬到新路径并删旧键；目标已有记录时保留目标', () => {
	const { app, map } = makeStorage();
	saveSearchQuery(app, 'old.md', 'k1');
	renameSearchRecord(app, 'old.md', 'new.md');
	assert.equal(map.has(rawKey('aaa', 'old.md')), false);
	assert.equal(loadSearchQuery(app, 'new.md'), 'k1');

	saveSearchQuery(app, 'x.md', 'k1');
	saveSearchQuery(app, 'y.md', 'k2');
	renameSearchRecord(app, 'x.md', 'y.md');
	assert.equal(loadSearchQuery(app, 'y.md'), 'k2');
	assert.equal(map.has(rawKey('aaa', 'x.md')), false);

	// 无记录 / 同路径 / 空参数 → no-op
	const before = map.size;
	renameSearchRecord(app, 'none.md', 'other.md');
	renameSearchRecord(app, 'y.md', 'y.md');
	renameSearchRecord(app, '', 'other.md');
	assert.equal(map.size, before);
});

test('清理：只删同 appId + 搜索前缀 + 文件不存在的键', () => {
	const { app, map } = makeStorage();
	map.set(rawKey('aaa', 'gone.md'), { v: 1, query: 'x' });
	map.set(rawKey('aaa', 'keep.md'), { v: 1, query: 'y' });
	map.set(rawKey('bbb', 'gone.md'), { v: 1, query: 'z' });
	// 同库的折叠记录（不同前缀）绝不能被搜索清理误删
	map.set('aaa-ioto-task-fold-keep.md', { v: 1, continuations: [] });
	map.set('aaa-other-key', { v: 1, query: 'w' });
	const keys = Object.keys(Object.fromEntries(map));
	const removed = pruneSearchQueries(
		app,
		'aaa',
		keys,
		(path) => path === 'keep.md',
	);
	assert.equal(removed, 1);
	assert.equal(map.has(rawKey('aaa', 'gone.md')), false);
	assert.equal(map.has(rawKey('aaa', 'keep.md')), true);
	assert.equal(map.has(rawKey('bbb', 'gone.md')), true);
	assert.equal(map.has('aaa-ioto-task-fold-keep.md'), true);
	assert.equal(map.has('aaa-other-key'), true);

	assert.deepEqual(listStoredSearchPaths('aaa', keys), ['gone.md', 'keep.md']);
	assert.deepEqual(listStoredSearchPaths('', keys), []);
	// 空 path 残键不当作记录
	assert.deepEqual(listStoredSearchPaths('aaa', [`aaa-${SEARCH_STORE_PREFIX}`]), []);
});

test('探测：缺 localStorage API → createFoldStorage 返回 null，壳函数静默降级', () => {
	assert.equal(createFoldStorage({}), null);
	const view = makeView({ app: {} });
	hydrateSearchQuery(view);
	assert.equal(view.searchQuery, '');
	persistSearchQuery(view);
	forgetSearchQuery(view);
	assert.equal(view.toggleRefreshCount, 1);
	assert.equal(view.renderCount, 0);
});

test('hydrate：按路径灌回关键词、回填输入框、展开搜索条', () => {
	const { app } = makeStorage();
	saveSearchQuery(app, 'A.md', 'foo bar');
	const view = makeView({ app, path: 'A.md' });
	hydrateSearchQuery(view);
	assert.equal(view.searchQuery, 'foo bar');
	assert.equal(view.searchInputEl.value, 'foo bar');
	assert.equal(view.searchBarEl.hasClass('is-hidden'), false);
	assert.equal(view.toggleRefreshCount, 1);

	// 无记录 → 归零并保持收起（resetSearchState 之后的状态）
	const empty = makeView({ app, path: 'B.md' });
	hydrateSearchQuery(empty);
	assert.equal(empty.searchQuery, '');
	assert.equal(empty.searchInputEl.value, '');
	assert.equal(empty.searchBarEl.hasClass('is-hidden'), true);
});

test('hydrate：路径不匹配不串态；无 file / 无工具栏不崩', () => {
	const { app } = makeStorage();
	saveSearchQuery(app, 'A.md', 'only-a');
	const view = makeView({ app, path: 'B.md' });
	hydrateSearchQuery(view);
	assert.equal(view.searchQuery, '');

	const noFile = makeView({ app, path: null });
	assert.doesNotThrow(() => hydrateSearchQuery(noFile));
	assert.equal(noFile.searchQuery, '');

	const noBar = makeView({ app, path: 'A.md' });
	noBar.searchBarEl = null;
	noBar.searchInputEl = null;
	hydrateSearchQuery(noBar);
	assert.equal(noBar.searchQuery, 'only-a');
	assert.equal(noBar.toggleRefreshCount, 1);
});

test('persist / forget：写当前关键词；无 file.path 不写', () => {
	const { app, map } = makeStorage();
	const view = makeView({ app, path: 'A.md', query: 'kw' });
	persistSearchQuery(view);
	assert.equal(loadSearchQuery(app, 'A.md'), 'kw');

	forgetSearchQuery(view);
	assert.equal(map.has(rawKey('aaa', 'A.md')), false);

	const noFile = makeView({ app, path: null });
	noFile.searchQuery = 'kw';
	persistSearchQuery(noFile);
	forgetSearchQuery(noFile);
	assert.equal(map.size, 0);
});

test('清空语义：closeSearch 删记录，resetSearchState（换文件 / 卸载）保留记录', () => {
	const { app, map } = makeStorage();
	saveSearchQuery(app, 'A.md', 'kw');

	// 换文件 / 卸载走 resetSearchState：只清内存与 DOM，键必须留着
	const cleared = makeView({ app, path: 'A.md', query: 'kw', barHidden: false });
	cleared.searchInputEl.value = 'kw';
	resetSearchState(cleared);
	assert.equal(cleared.searchQuery, '');
	assert.equal(cleared.searchInputEl.value, '');
	assert.equal(cleared.searchBarEl.hasClass('is-hidden'), true);
	assert.equal(map.has(rawKey('aaa', 'A.md')), true);

	// 显式关闭（× / Esc）走 closeSearch：键必须删掉，否则「关了切回来又冒出来」
	const closed = makeView({ app, path: 'A.md', query: 'kw', barHidden: false });
	closed.searchInputEl.value = 'kw';
	closeSearch(closed);
	assert.equal(closed.searchQuery, '');
	assert.equal(closed.searchInputEl.value, '');
	assert.equal(closed.searchBarEl.hasClass('is-hidden'), true);
	assert.equal(map.has(rawKey('aaa', 'A.md')), false);
	assert.equal(closed.renderCount, 1);
});
