import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限过滤设备级兜底单测（[[Plan-20261116-102615]] §3.4 / §6.2）。
// `filter-storage.ts` 零 obsidian 运行时依赖，照 `quadrant-view-state.test.mjs` 的 jiti 直载范式。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	QUADRANT_FILTER_STORAGE_KEY,
	readQuadrantFilterFallback,
	writeQuadrantFilterFallback,
} = await jiti.import('../src/views/quadrant/filter-storage.ts');

function createApp(options = {}) {
	const store = new Map();
	return {
		store,
		loadLocalStorage(key) {
			if (options.loadThrows) throw new Error('load failed');
			return store.has(key) ? store.get(key) : null;
		},
		saveLocalStorage(key, data) {
			if (options.saveThrows) throw new Error('save failed');
			store.set(key, data);
		},
	};
}

test('read：非对象或缺少 API 的 app 一律回 {}', () => {
	for (const app of [
		null,
		undefined,
		0,
		'x',
		{},
		{ loadLocalStorage: () => ({}) },
		{ saveLocalStorage: () => {} },
	]) {
		assert.deepEqual(readQuadrantFilterFallback(app), {});
	}
});

test('read：无记录（null）回 {}', () => {
	assert.deepEqual(readQuadrantFilterFallback(createApp()), {});
});

test('read：合法记录解码 statusKeys、timeFilter 与 projectScope', () => {
	const app = createApp();
	app.store.set(QUADRANT_FILTER_STORAGE_KEY, {
		statusKeys: ['completed'],
		timeFilter: 'preset:created-two-weeks',
		projectScope: 'project:IOTO Task Center',
	});
	assert.deepEqual(readQuadrantFilterFallback(app), {
		statusKeys: ['completed'],
		timeFilter: { kind: 'preset', value: 'created-two-weeks' },
		projectScope: { kind: 'project', projectName: 'IOTO Task Center' },
	});
});

test('read：旧记录（无 projectScope）仍读出其它字段，projectScope 为 undefined', () => {
	const app = createApp();
	app.store.set(QUADRANT_FILTER_STORAGE_KEY, {
		statusKeys: ['todo'],
		timeFilter: 'none',
	});
	const result = readQuadrantFilterFallback(app);
	assert.deepEqual(result.statusKeys, ['todo']);
	assert.deepEqual(result.timeFilter, { kind: 'none' });
	assert.equal(result.projectScope, undefined);
	assert.equal('projectScope' in result, false);
});

test('read：脏 projectScope 不污染其它字段', () => {
	const app = createApp();
	app.store.set(QUADRANT_FILTER_STORAGE_KEY, {
		statusKeys: ['todo'],
		timeFilter: 'none',
		projectScope: 'project:',
	});
	const result = readQuadrantFilterFallback(app);
	assert.deepEqual(result.statusKeys, ['todo']);
	assert.deepEqual(result.timeFilter, { kind: 'none' });
	assert.equal(result.projectScope, undefined);
});

test('read：statusKeys 空数组读回 []（不当作无记录）', () => {
	const app = createApp();
	app.store.set(QUADRANT_FILTER_STORAGE_KEY, { statusKeys: [] });
	const result = readQuadrantFilterFallback(app);
	assert.deepEqual(result.statusKeys, []);
	assert.equal(result.timeFilter, undefined);
});

test('read：全脏记录 → 对应字段 undefined；脏 timeFilter 回落 none', () => {
	const app = createApp();
	app.store.set(QUADRANT_FILTER_STORAGE_KEY, {
		statusKeys: ['bogus'],
		timeFilter: 42,
	});
	const result = readQuadrantFilterFallback(app);
	assert.equal(result.statusKeys, undefined);
	assert.deepEqual(result.timeFilter, { kind: 'none' });
});

test('read：loadLocalStorage 抛错回 {}', () => {
	assert.deepEqual(readQuadrantFilterFallback(createApp({ loadThrows: true })), {});
});

test('write：缺 API 或非对象 app 不抛错', () => {
	for (const app of [null, undefined, {}, { loadLocalStorage: () => null }]) {
		assert.doesNotThrow(() =>
			writeQuadrantFilterFallback(app, {
				statusKeys: new Set(['todo']),
				timeFilter: { kind: 'none' },
				projectScope: { kind: 'all' },
			}),
		);
	}
});

test('write：key 固定、timeFilter / projectScope 编码为字符串、statusKeys / typeKeys 为普通数组', () => {
	const app = createApp();
	writeQuadrantFilterFallback(app, {
		statusKeys: new Set(['completed', 'todo']),
		typeKeys: new Set(['normal', 'date', 'topic', 'plan']),
		timeFilter: {
			kind: 'custom',
			field: 'created',
			start: '2026-10-01',
			end: '2026-10-31',
		},
		projectScope: { kind: 'project', projectName: 'IOTO Task Center' },
	});
	assert.deepEqual(app.store.get(QUADRANT_FILTER_STORAGE_KEY), {
		statusKeys: ['completed', 'todo'],
		typeKeys: ['normal', 'date', 'topic', 'plan'],
		timeFilter: 'custom:created:2026-10-01:2026-10-31',
		projectScope: 'project:IOTO Task Center',
	});
	assert.equal(QUADRANT_FILTER_STORAGE_KEY, 'ioto-pq-filter-v1');
});

test('write：两种 projectScope 往返一致', () => {
	const scopes = [
		{ kind: 'all' },
		{ kind: 'project', projectName: 'IOTO Task Center' },
	];
	for (const projectScope of scopes) {
		const app = createApp();
		writeQuadrantFilterFallback(app, {
			statusKeys: new Set(['todo']),
			typeKeys: new Set(['normal', 'date', 'topic', 'plan']),
			timeFilter: { kind: 'none' },
			projectScope,
		});
		assert.deepEqual(readQuadrantFilterFallback(app).projectScope, projectScope);
	}
});

test('write：空 Set 写成 []，读回仍为全不选', () => {
	const app = createApp();
	writeQuadrantFilterFallback(app, {
		statusKeys: new Set(),
		typeKeys: new Set(['normal', 'date', 'topic', 'plan']),
		timeFilter: { kind: 'none' },
		projectScope: { kind: 'all' },
	});
	assert.deepEqual(app.store.get(QUADRANT_FILTER_STORAGE_KEY), {
		statusKeys: [],
		typeKeys: ['normal', 'date', 'topic', 'plan'],
		timeFilter: 'none',
		projectScope: 'all',
	});
	assert.deepEqual(readQuadrantFilterFallback(app), {
		statusKeys: [],
		typeKeys: ['normal', 'date', 'topic', 'plan'],
		timeFilter: { kind: 'none' },
		projectScope: { kind: 'all' },
	});
});

test('write：saveLocalStorage 抛错不向上抛', () => {
	assert.doesNotThrow(() =>
		writeQuadrantFilterFallback(createApp({ saveThrows: true }), {
			statusKeys: new Set(['todo']),
			typeKeys: new Set(['normal', 'date', 'topic', 'plan']),
			timeFilter: { kind: 'none' },
			projectScope: { kind: 'all' },
		}),
	);
});

// typeKeys 字段（[[Plan-20261117-085118]] §6.5）。
test('read：旧记录（无 typeKeys）不带该字段 → 视图侧回落全选', () => {
	const app = createApp();
	app.store.set(QUADRANT_FILTER_STORAGE_KEY, {
		statusKeys: ['todo'],
		timeFilter: 'none',
		projectScope: 'all',
	});
	const result = readQuadrantFilterFallback(app);
	assert.equal('typeKeys' in result, false);
});

test('typeKeys 往返：写回后再次读回一致，空数组保持', () => {
	for (const keys of [['plan'], ['normal', 'date', 'topic', 'plan'], []]) {
		const app = createApp();
		writeQuadrantFilterFallback(app, {
			statusKeys: new Set(['todo']),
			typeKeys: new Set(keys),
			timeFilter: { kind: 'none' },
			projectScope: { kind: 'all' },
		});
		assert.deepEqual(readQuadrantFilterFallback(app).typeKeys, keys);
	}
});

// 历史值迁移（[[Plan-20261117-092238]] §5.4）。
test('read：历史 projectScope "unarchived" 迁移为 all，写回落盘为 "all"', () => {
	const app = createApp();
	app.store.set(QUADRANT_FILTER_STORAGE_KEY, {
		statusKeys: ['todo'],
		typeKeys: ['normal', 'date', 'topic', 'plan'],
		timeFilter: 'none',
		projectScope: 'unarchived',
	});
	assert.deepEqual(readQuadrantFilterFallback(app).projectScope, {
		kind: 'all',
	});

	writeQuadrantFilterFallback(app, {
		statusKeys: new Set(['todo']),
		typeKeys: new Set(['normal', 'date', 'topic', 'plan']),
		timeFilter: { kind: 'none' },
		projectScope: { kind: 'all' },
	});
	assert.equal(
		app.store.get(QUADRANT_FILTER_STORAGE_KEY).projectScope,
		'all',
	);
});

test('read：脏 typeKeys 不污染其它字段', () => {
	const app = createApp();
	app.store.set(QUADRANT_FILTER_STORAGE_KEY, {
		statusKeys: ['todo'],
		typeKeys: ['bogus'],
		timeFilter: 'none',
	});
	const result = readQuadrantFilterFallback(app);
	assert.equal(result.typeKeys, undefined);
	assert.deepEqual(result.statusKeys, ['todo']);
});
