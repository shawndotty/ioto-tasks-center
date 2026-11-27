import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 解析缓存「跨会话持久化」纯函数层的回归测试（[[Plan-20261127-142715]] §P0-1-4）。
// 覆盖：往返一致、版本/任务根不符整表作废、脏条目跳过、超限裁剪、脏位归零。
const jiti = createJiti(import.meta.url, {
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { TFile } = await jiti.import('./stubs/obsidian.mjs');
const {
	serializeTaskFileCache,
	hydrateTaskFileCache,
	isTaskFileCacheDirty,
	invalidateTaskFileFields,
	rememberTaskFileFields,
	peekTaskFileFields,
	getTaskFileFieldCacheSize,
	TASK_FILE_CACHE_VERSION,
} = await jiti.import('../src/tasks-center/task-file-cache.ts');
const {
	isPersistedCacheEntry,
	getTaskFileCachePath,
	TASK_FILE_CACHE_FILE_NAME,
} = await jiti.import('../src/tasks-center/task-file-cache-persist.ts');

const TASKS_ROOT = '3-任务';

function makeFields(overrides = {}) {
	return structuredClone({
		status: {
			key: 'todo',
			label: '待办',
			totalTaskCount: 2,
			completedTaskCount: 0,
			summary: '',
		},
		starred: false,
		upTaskTitles: [],
		...overrides,
	});
}

function makeFile(path, mtime = 1000, size = 20) {
	const file = new TFile(path);
	file.stat = { mtime, ctime: mtime, size };
	return file;
}

/** 每个用例用独立项目前缀 + 先清表，避免共享模块态互相干扰。 */
function resetCache() {
	invalidateTaskFileFields();
}

test('serialize → hydrate 往返一致，回填后 peek 直接命中', () => {
	resetCache();
	const f1 = makeFile(`${TASKS_ROOT}/持久化A/t1.md`, 1111, 30);
	const f2 = makeFile(`${TASKS_ROOT}/持久化A/t2.md`, 2222, 40);
	rememberTaskFileFields(f1, makeFields({ starred: true, priority: 2 }));
	rememberTaskFileFields(f2, makeFields());
	assert.equal(isTaskFileCacheDirty(), true, '写入后应置脏');

	const payload = serializeTaskFileCache(TASKS_ROOT, (path) =>
		path.startsWith(`${TASKS_ROOT}/`),
	);
	assert.equal(payload.version, TASK_FILE_CACHE_VERSION);
	assert.equal(payload.tasksRootPath, TASKS_ROOT);
	assert.equal(payload.entries.length, 2);
	assert.equal(isTaskFileCacheDirty(), false, 'serialize 后脏位归零');

	resetCache();
	assert.equal(getTaskFileFieldCacheSize(), 0);
	const loaded = hydrateTaskFileCache(payload, TASKS_ROOT);
	assert.equal(loaded, 2);
	assert.equal(isTaskFileCacheDirty(), false, 'hydrate 后脏位归零');
	assert.deepEqual(peekTaskFileFields(f1), makeFields({ starred: true, priority: 2 }));
	assert.deepEqual(peekTaskFileFields(f2), makeFields());
});

test('version 不符整表作废返回 0', () => {
	resetCache();
	rememberTaskFileFields(makeFile(`${TASKS_ROOT}/持久化B/t1.md`), makeFields());
	const payload = serializeTaskFileCache(TASKS_ROOT, () => true);
	const stale = { ...payload, version: payload.version + 999 };

	resetCache();
	assert.equal(hydrateTaskFileCache(stale, TASKS_ROOT), 0);
	assert.equal(getTaskFileFieldCacheSize(), 0);
});

test('tasksRootPath 与当前设置不符整表作废', () => {
	resetCache();
	rememberTaskFileFields(makeFile(`${TASKS_ROOT}/持久化C/t1.md`), makeFields());
	const payload = serializeTaskFileCache(TASKS_ROOT, () => true);

	resetCache();
	assert.equal(hydrateTaskFileCache(payload, '任务中心'), 0);
	assert.equal(getTaskFileFieldCacheSize(), 0);
});

test('脏条目跳过、合法条目保留；整体结构不合法一律返回 0', () => {
	resetCache();
	const good = makeFile(`${TASKS_ROOT}/持久化D/t1.md`, 3333, 10);
	rememberTaskFileFields(good, makeFields());
	const payload = serializeTaskFileCache(TASKS_ROOT, () => true);

	resetCache();
	const mixed = {
		...payload,
		entries: [
			...payload.entries,
			['x/坏条目.md', { mtime: 'not-a-number', size: 1, fields: makeFields() }],
			['y/缺字段.md', { mtime: 1, size: 1 }],
			['z/状态非法.md', { mtime: 1, size: 1, fields: makeFields({ status: { ...makeFields().status, key: 'unknown' } }) }],
			'不是数组',
		],
	};
	assert.equal(hydrateTaskFileCache(mixed, TASKS_ROOT), 1, '只载入合法条目');
	assert.equal(peekTaskFileFields(good) !== null, true);
	assert.equal(isPersistedCacheEntry(mixed.entries[3]), false);
	assert.equal(isPersistedCacheEntry(mixed.entries[0]), true);

	assert.equal(hydrateTaskFileCache(null, TASKS_ROOT), 0);
	assert.equal(hydrateTaskFileCache('{}', TASKS_ROOT), 0);
	assert.equal(hydrateTaskFileCache({ ...payload, entries: 'not-array' }, TASKS_ROOT), 0);
});

test('serialize 丢弃任务根之外条目并按 maxEntries 裁剪', () => {
	resetCache();
	rememberTaskFileFields(makeFile(`${TASKS_ROOT}/持久化E/a.md`), makeFields());
	rememberTaskFileFields(makeFile(`${TASKS_ROOT}/持久化E/b.md`), makeFields());
	rememberTaskFileFields(makeFile(`9-其他/c.md`), makeFields());

	const filtered = serializeTaskFileCache(TASKS_ROOT, (path) =>
		path.startsWith(`${TASKS_ROOT}/`),
	);
	assert.deepEqual(
		filtered.entries.map(([path]) => path),
		[`${TASKS_ROOT}/持久化E/a.md`, `${TASKS_ROOT}/持久化E/b.md`],
	);

	const capped = serializeTaskFileCache(TASKS_ROOT, () => true, 1);
	assert.equal(capped.entries.length, 1);
});

test('条目数超过 MAX_CACHE_ENTRIES 的分片整表作废', () => {
	resetCache();
	const payload = {
		version: TASK_FILE_CACHE_VERSION,
		savedAt: Date.now(),
		tasksRootPath: TASKS_ROOT,
		entries: Array.from({ length: 8001 }, (_, i) => [
			`${TASKS_ROOT}/持久化F/t${i}.md`,
			{ mtime: i, size: 1, fields: makeFields() },
		]),
	};
	assert.equal(hydrateTaskFileCache(payload, TASKS_ROOT), 0);
});

test('invalidate 置脏（全清与单删），peek 新鲜度判定不受持久化影响', () => {
	resetCache();
	const file = makeFile(`${TASKS_ROOT}/持久化G/t1.md`, 4444, 8);
	rememberTaskFileFields(file, makeFields());
	serializeTaskFileCache(TASKS_ROOT, () => true);
	assert.equal(isTaskFileCacheDirty(), false);

	assert.equal(invalidateTaskFileFields(file.path), undefined);
	assert.equal(isTaskFileCacheDirty(), true, '删条目也是脏');

	rememberTaskFileFields(file, makeFields());
	file.stat = { ...file.stat, mtime: 5555 };
	assert.equal(peekTaskFileFields(file), null, '(mtime,size) 过期即 miss，语义不变');
});

test('分片路径：插件目录拼接与结尾斜杠归一', () => {
	assert.equal(
		getTaskFileCachePath('.obsidian/plugins/ioto-tasks-center'),
		`.obsidian/plugins/ioto-tasks-center/${TASK_FILE_CACHE_FILE_NAME}`,
	);
	assert.equal(
		getTaskFileCachePath('.obsidian/plugins/ioto-tasks-center/'),
		`.obsidian/plugins/ioto-tasks-center/${TASK_FILE_CACHE_FILE_NAME}`,
	);
});
