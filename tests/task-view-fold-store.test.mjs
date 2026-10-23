import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 续写折叠态的跨会话镜像（[[Plan-20261023-001403]] S1）。
// store 模块零 `obsidian` import（连 import type 都不用），用 Map 假实现宿主即可直测；
// hydrate / persist 壳函数同理（只 import 纯模块 + 类型）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	sectionFoldKey,
	parseSectionFoldKey,
	claimSectionFoldKeys,
	intersectSectionFoldKeys,
} = await jiti.import('../src/views/ioto-task/section-fold-key.ts');
const {
	FOLD_STORE_PREFIX,
	foldStoreKey,
	readFoldRecord,
	readFoldSections,
	loadContinuationFolds,
	saveContinuationFolds,
	resolveContinuationFolds,
	loadSectionFolds,
	saveSectionFolds,
	resolveSectionFolds,
	renameContinuationFolds,
	listStoredFoldPaths,
	pruneContinuationFolds,
	resolveAppId,
	createFoldStorage,
} = await jiti.import('../src/views/ioto-task/task-view-fold-store.ts');
const { hydrateContinuationFolds, persistContinuationFolds, forgetContinuationFold } =
	await jiti.import('../src/views/ioto-task/task-view-continuation-fold.ts');

/**
 * 假宿主：底层 Map 存**完整键**（`<appId>-<key>`，与核心真实行为一致，也让清理用例能
 * 同时铺多个库的键）；`save(key, null)` 即删除。
 */
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

/** 完整存储键（供清理用例铺数据）。 */
const rawKey = (appId, path) => `${appId}-${FOLD_STORE_PREFIX}${path}`;

/** 假视图：hydrate / persist 只碰这四项。 */
function makeView({ app, path = 'A.md', pending = null }) {
	return {
		app,
		file: path === null ? null : { path },
		continuationCollapsed: new Set(),
		pendingLeafFolds: pending,
		takePendingLeafFolds() {
			const taken = this.pendingLeafFolds;
			this.pendingLeafFolds = null;
			return taken;
		},
	};
}

test('键名：前缀 + 原 path；无记录时 load 返回 null', () => {
	assert.equal(foldStoreKey('3-任务/a.md'), `${FOLD_STORE_PREFIX}3-任务/a.md`);
	const { app, map } = makeStorage();
	assert.equal(loadContinuationFolds(app, 'A.md'), null);
	assert.equal(map.size, 0);
});

test('往返：写入后读回同一数组，形态为 {v:1,continuations:[…]}', () => {
	const { app, map } = makeStorage();
	saveContinuationFolds(app, 'A.md', ['c1', 'c2']);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), ['c1', 'c2']);
	const record = map.get(rawKey('aaa', 'A.md'));
	assert.equal(record.v, 1);
	assert.deepEqual(record.continuations, ['c1', 'c2']);
	// 去重 + 只留 string
	saveContinuationFolds(app, 'A.md', ['c1', 'c1', 42, null, 'c2']);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), ['c1', 'c2']);
});

test('写空集合 → 记录存在且读回 []（不是 null）', () => {
	const { app, map } = makeStorage();
	saveContinuationFolds(app, 'A.md', []);
	assert.equal(map.has(rawKey('aaa', 'A.md')), true);
	const loaded = loadContinuationFolds(app, 'A.md');
	assert.deepEqual(loaded, []);
	assert.notEqual(loaded, null);
});

test('坏数据 → null，不抛错', () => {
	const { app, map } = makeStorage();
	const key = rawKey('aaa', 'A.md');
	for (const raw of [
		'not json',
		{ v: 2, continuations: ['c1'] },
		{ v: 1, continuations: 'x' },
		{ v: 1 },
		null,
		42,
		[],
	]) {
		map.set(key, raw);
		assert.equal(loadContinuationFolds(app, 'A.md'), null);
	}
	// loadLocalStorage 自己抛错也要吞掉
	const throwing = makeStorage();
	throwing.app.loadLocalStorage = () => {
		throw new Error('boom');
	};
	assert.equal(loadContinuationFolds(throwing.app, 'A.md'), null);
	// readFoldRecord 直接喂原值
	assert.equal(readFoldRecord({ v: 1, continuations: ['c1'] }).length, 1);
});

test('认领只在无记录时：有记录 [] 不认领 legacy，无记录则认领并落盘', () => {
	const { app, map } = makeStorage();
	saveContinuationFolds(app, 'A.md', []);
	assert.deepEqual(resolveContinuationFolds(app, 'A.md', ['cX']), []);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), []);

	const empty = makeStorage();
	assert.deepEqual(resolveContinuationFolds(empty.app, 'B.md', ['cX']), ['cX']);
	assert.deepEqual(loadContinuationFolds(empty.app, 'B.md'), ['cX']);
	assert.equal(empty.map.size, 1);
});

test('无记录无 legacy → [] 且不写键（不给打开过的笔记留空记录）', () => {
	const { app, map } = makeStorage();
	assert.deepEqual(resolveContinuationFolds(app, 'A.md', []), []);
	assert.equal(map.size, 0);
});

test('rename：搬到新路径并删旧键；目标已有记录时不覆盖', () => {
	const { app, map } = makeStorage();
	saveContinuationFolds(app, 'old.md', ['c1']);
	renameContinuationFolds(app, 'old.md', 'new.md');
	assert.equal(map.has(rawKey('aaa', 'old.md')), false);
	assert.deepEqual(loadContinuationFolds(app, 'new.md'), ['c1']);

	saveContinuationFolds(app, 'x.md', ['c1']);
	saveContinuationFolds(app, 'y.md', ['c2']);
	renameContinuationFolds(app, 'x.md', 'y.md');
	assert.deepEqual(loadContinuationFolds(app, 'y.md'), ['c2']);
	assert.equal(map.has(rawKey('aaa', 'x.md')), false);

	// 无记录 → no-op；同路径 → no-op
	const before = map.size;
	renameContinuationFolds(app, 'none.md', 'other.md');
	renameContinuationFolds(app, 'y.md', 'y.md');
	assert.equal(map.size, before);
});

test('清理：只删同 appId + 前缀 + 文件不存在的键', () => {
	const { app, map } = makeStorage();
	// 同机铺三个库 / 别的前缀的键：只有 aaa + FOLD_STORE_PREFIX + 文件没了 才该被删
	map.set(rawKey('aaa', 'gone.md'), { v: 1, continuations: ['c1'] });
	map.set(rawKey('aaa', 'keep.md'), { v: 1, continuations: ['c2'] });
	map.set(rawKey('bbb', 'gone.md'), { v: 1, continuations: ['c3'] });
	map.set('aaa-other-key', { v: 1, continuations: [] });
	const keys = Object.keys(Object.fromEntries(map));
	const removed = pruneContinuationFolds(
		app,
		'aaa',
		keys,
		(path) => path === 'keep.md',
	);
	assert.equal(removed, 1);
	assert.equal(map.has(rawKey('aaa', 'gone.md')), false);
	assert.equal(map.has(rawKey('aaa', 'keep.md')), true);
	assert.equal(map.has(rawKey('bbb', 'gone.md')), true);
	assert.equal(map.has('aaa-other-key'), true);

	assert.deepEqual(listStoredFoldPaths('aaa', keys), ['gone.md', 'keep.md']);
	assert.deepEqual(listStoredFoldPaths('', keys), []);
	// 空 path 残键不当作记录
	assert.deepEqual(listStoredFoldPaths('aaa', [`aaa-${FOLD_STORE_PREFIX}`]), []);
});

test('探测：缺方法 → null；完整对象 → 可用；appId 非空字符串才算', () => {
	assert.equal(createFoldStorage({}), null);
	assert.equal(createFoldStorage({ loadLocalStorage() {} }), null);
	assert.equal(createFoldStorage(null), null);
	const { app } = makeStorage();
	const storage = createFoldStorage(app);
	assert.notEqual(storage, null);
	storage.saveLocalStorage('k', { v: 1 });
	assert.deepEqual(storage.loadLocalStorage('k'), { v: 1 });

	assert.equal(resolveAppId({ appId: 'abc' }), 'abc');
	assert.equal(resolveAppId({ appId: '' }), null);
	assert.equal(resolveAppId({}), null);
	assert.equal(resolveAppId(null), null);
});

test('hydrate：有记录 → 集合 = 记录值，pending 被忽略且不落盘', () => {
	const { app, map } = makeStorage();
	saveContinuationFolds(app, 'A.md', ['c1']);
	const view = makeView({
		app,
		path: 'A.md',
		pending: { path: 'A.md', continuations: ['cX'] },
	});
	hydrateContinuationFolds(view);
	assert.deepEqual([...view.continuationCollapsed], ['c1']);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), ['c1']);
	assert.equal(view.pendingLeafFolds, null);
	assert.equal(map.size, 1);
});

test('hydrate：无记录 + 同 path 的 pending → 采纳并落盘（老 workspace.json 迁移）', () => {
	const { app } = makeStorage();
	const view = makeView({
		app,
		path: 'A.md',
		pending: { path: 'A.md', continuations: ['cX', 'cY'] },
	});
	hydrateContinuationFolds(view);
	assert.deepEqual([...view.continuationCollapsed], ['cX', 'cY']);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), ['cX', 'cY']);

	// path 为空的旧状态同样认领（核心旧版本 state 里可能没有 file 字段）
	const emptyPath = makeStorage();
	const legacyView = makeView({
		app: emptyPath.app,
		path: 'B.md',
		pending: { path: '', continuations: ['cZ'] },
	});
	hydrateContinuationFolds(legacyView);
	assert.deepEqual([...legacyView.continuationCollapsed], ['cZ']);
});

test('hydrate：pending 的 path 与当前文件不同 → 丢弃（防叶子复用串态）', () => {
	const { app, map } = makeStorage();
	const view = makeView({
		app,
		path: 'B.md',
		pending: { path: 'A.md', continuations: ['cX'] },
	});
	hydrateContinuationFolds(view);
	assert.equal(view.continuationCollapsed.size, 0);
	assert.equal(map.size, 0);
});

test('hydrate：老客户端（无 localStorage API）→ 退化为只认领 pending，不抛错', () => {
	const view = makeView({
		app: {},
		path: 'A.md',
		pending: { path: 'A.md', continuations: ['cX'] },
	});
	hydrateContinuationFolds(view);
	assert.deepEqual([...view.continuationCollapsed], ['cX']);

	// 文件还没绑上时也走同一条兜底
	const noFile = makeView({ app: {}, path: null, pending: null });
	hydrateContinuationFolds(noFile);
	assert.equal(noFile.continuationCollapsed.size, 0);
});

test('persist：显式展开后的空集合要落盘为 []（重载不复活）', () => {
	const { app } = makeStorage();
	const view = makeView({ app, path: 'A.md' });
	view.continuationCollapsed.add('c1');
	persistContinuationFolds(view);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), ['c1']);

	view.continuationCollapsed.clear();
	persistContinuationFolds(view);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), []);

	// 无文件 / 无 API → no-op
	const orphan = makeView({ app, path: null });
	persistContinuationFolds(orphan);
	persistContinuationFolds(makeView({ app: {}, path: 'Z.md' }));
});

test('forget：进续行编辑删键后必须落盘（否则 Esc → 重载会复活折叠态）', () => {
	const { app } = makeStorage();
	const view = makeView({ app, path: 'A.md' });
	view.continuationCollapsed.add('c1');
	view.continuationCollapsed.add('c2');
	persistContinuationFolds(view);

	forgetContinuationFold(view, 'c1');
	assert.deepEqual([...view.continuationCollapsed], ['c2']);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), ['c2']);
});

// ---- Section 折叠态（[[Plan-20261023-062616]] S6 用例 1-15）----

/** 顶层节种子（hydrate 交集的入参形态）。 */
const roots = (...pairs) => pairs.map(([level, title]) => ({ level, title }));

test('键：新键不含行号，形如 s:<level>:<title>', () => {
	assert.equal(sectionFoldKey(1, '目标'), 's:1:目标');
	assert.equal(sectionFoldKey(2, '子:节'), 's:2:子:节');
	// 旧键形态（含行号）不应再被产出来
	assert.equal(sectionFoldKey(1, '目标').includes(':12:'), false);
});

test('解析：新键 / legacy 键都能解出 level+title；坏键 → null', () => {
	assert.deepEqual(parseSectionFoldKey('s:1:目标'), { level: 1, title: '目标' });
	// legacy：行号被丢弃（12 已漂移也无所谓）
	assert.deepEqual(parseSectionFoldKey('1:12:目标'), { level: 1, title: '目标' });
	// 标题含 `:`：只切前两个冒号
	assert.deepEqual(parseSectionFoldKey('s:2:a:b'), { level: 2, title: 'a:b' });
	assert.deepEqual(parseSectionFoldKey('2:7:a:b'), { level: 2, title: 'a:b' });
	for (const bad of ['', 's:', 's:x:目标', '目标', '1:目标', 'x:12:目标']) {
		assert.equal(parseSectionFoldKey(bad), null);
	}
});

test('认领：新键直通；legacy 转成新键；找不到标题则丢弃', () => {
	const rs = roots([1, '目标'], [2, '子节']);
	assert.deepEqual(claimSectionFoldKeys(['s:1:目标'], rs), ['s:1:目标']);
	assert.deepEqual(claimSectionFoldKeys(['1:12:目标'], rs), ['s:1:目标']);
	assert.deepEqual(claimSectionFoldKeys(['1:999:目标'], rs), ['s:1:目标']);
	assert.deepEqual(claimSectionFoldKeys(['3:5:不存在'], rs), []);
	assert.deepEqual(claimSectionFoldKeys(['乱七八糟'], rs), []);
	// 新键与 legacy 指向同一节 → 去重只留一条
	assert.deepEqual(
		claimSectionFoldKeys(['s:1:目标', '1:12:目标'], rs),
		['s:1:目标'],
	);
	// level 漂移时按标题兜底（取当前节的 level）
	assert.deepEqual(claimSectionFoldKeys(['9:12:目标'], rs), ['s:1:目标']);
});

test('交集：死键 / level 不符的键被剔除，保序去重', () => {
	const rs = roots([1, '目标'], [2, '子节']);
	assert.deepEqual(
		intersectSectionFoldKeys(['s:1:目标', 's:2:子节', 's:1:已删'], rs),
		['s:1:目标', 's:2:子节'],
	);
	// level 不符（标题还在但降级了）
	assert.deepEqual(intersectSectionFoldKeys(['s:3:目标'], rs), []);
	assert.deepEqual(intersectSectionFoldKeys(['s:1:目标', 's:1:目标'], rs), [
		's:1:目标',
	]);
});

test('readFoldSections：缺 sections → null（= 无记录，让 legacy 认领生效）', () => {
	assert.equal(readFoldSections({ v: 1, continuations: [] }), null);
	assert.deepEqual(readFoldSections({ v: 1, continuations: [], sections: [] }), []);
	assert.equal(readFoldSections({ v: 2, continuations: [], sections: ['x'] }), null);
	assert.equal(readFoldSections({ v: 1, continuations: [], sections: 'x' }), null);
	assert.equal(readFoldSections(null), null);
});

test('两个 save 互不覆盖：写 sections 保 continuations，反之亦然', () => {
	const { app, map } = makeStorage();
	saveContinuationFolds(app, 'A.md', ['c1']);
	saveSectionFolds(app, 'A.md', ['s:1:目标']);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), ['c1']);
	assert.deepEqual(loadSectionFolds(app, 'A.md'), ['s:1:目标']);

	saveContinuationFolds(app, 'A.md', ['c2']);
	assert.deepEqual(loadContinuationFolds(app, 'A.md'), ['c2']);
	assert.deepEqual(loadSectionFolds(app, 'A.md'), ['s:1:目标']);
	assert.equal(map.get(rawKey('aaa', 'A.md')).v, 1);
});

test('老记录不补空 sections：只写 continuations 时记录里没有该键', () => {
	const { app, map } = makeStorage();
	saveContinuationFolds(app, 'A.md', ['c1']);
	assert.equal('sections' in map.get(rawKey('aaa', 'A.md')), false);
	assert.equal(loadSectionFolds(app, 'A.md'), null);
});

test('rename 搬整条记录：sections 跟着走，旧键消失', () => {
	const { app, map } = makeStorage();
	saveContinuationFolds(app, 'old.md', ['c1']);
	saveSectionFolds(app, 'old.md', ['s:1:目标']);
	renameContinuationFolds(app, 'old.md', 'new.md');
	assert.equal(map.has(rawKey('aaa', 'old.md')), false);
	assert.deepEqual(loadSectionFolds(app, 'new.md'), ['s:1:目标']);
	assert.deepEqual(loadContinuationFolds(app, 'new.md'), ['c1']);
});

test('resolveSectionFolds：有记录 → 取交集，交集变小则回写', () => {
	const { app } = makeStorage();
	saveSectionFolds(app, 'A.md', ['s:1:目标', 's:1:已删']);
	assert.deepEqual(
		resolveSectionFolds(app, 'A.md', ['s:1:别的'], roots([1, '目标'])),
		['s:1:目标'],
	);
	assert.deepEqual(loadSectionFolds(app, 'A.md'), ['s:1:目标']);
});

test('resolveSectionFolds：无记录 + legacy → 认领并落盘；无 legacy → 不写键', () => {
	const { app, map } = makeStorage();
	assert.deepEqual(
		resolveSectionFolds(app, 'A.md', ['1:12:目标'], roots([1, '目标'])),
		['s:1:目标'],
	);
	assert.deepEqual(loadSectionFolds(app, 'A.md'), ['s:1:目标']);

	const empty = makeStorage();
	assert.deepEqual(
		resolveSectionFolds(empty.app, 'B.md', [], roots([1, '目标'])),
		[],
	);
	assert.equal(empty.map.size, 0);
});
