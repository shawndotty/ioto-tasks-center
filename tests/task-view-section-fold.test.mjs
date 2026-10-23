import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// Section 折叠态的 hydrate / persist（[[Plan-20261023-062616]] S6 用例 16-18）。
// 模块只依赖纯模块（section-fold-key / fold-store / note-structure），零 obsidian，
// 故 jiti 可直接导入源码，无需先构建、无需桩。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { hydrateSectionFolds, persistSectionFolds } = await jiti.import(
	'../src/views/ioto-task/task-view-section-fold.ts',
);
const { loadSectionFolds, saveSectionFolds, FOLD_STORE_PREFIX } =
	await jiti.import('../src/views/ioto-task/task-view-fold-store.ts');

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

/** 假视图：hydrate / persist 只碰 app / file / data / collapsedSections / pending。 */
function makeView({ app, path = 'A.md', data = '', pending = null }) {
	return {
		app,
		file: path === null ? null : { path },
		data,
		collapsedSections: new Set(),
		pendingLeafFolds: pending,
		takePendingLeafFolds() {
			const taken = this.pendingLeafFolds;
			this.pendingLeafFolds = null;
			return taken;
		},
	};
}

const NOTE = ['# 目标', '- [ ] a', '', '# 其他', '- [ ] b', ''].join('\n');

test('hydrate：有记录 → 集合 = 记录值（交集按当前 root 清理）', () => {
	const { app } = makeStorage();
	saveSectionFolds(app, 'A.md', ['s:1:目标', 's:1:已删']);
	const view = makeView({ app, path: 'A.md', data: NOTE });
	hydrateSectionFolds(view);
	assert.deepEqual([...view.collapsedSections], ['s:1:目标']);
});

test('hydrate：无记录 + 同 path 的 pending → 认领 legacy 行号键并落盘', () => {
	const { app } = makeStorage();
	const view = makeView({
		app,
		path: 'A.md',
		data: NOTE,
		pending: { path: 'A.md', continuations: [], sections: ['1:1:目标'] },
	});
	hydrateSectionFolds(view);
	assert.deepEqual([...view.collapsedSections], ['s:1:目标']);
	assert.deepEqual(loadSectionFolds(app, 'A.md'), ['s:1:目标']);
});

test('hydrate：pending 的 path 与当前文件不同 → 丢弃（防叶子复用串态）', () => {
	const { app, map } = makeStorage();
	const view = makeView({
		app,
		path: 'B.md',
		data: NOTE,
		pending: { path: 'A.md', continuations: [], sections: ['s:1:目标'] },
	});
	hydrateSectionFolds(view);
	assert.equal(view.collapsedSections.size, 0);
	assert.equal(map.size, 0);
});

test('hydrate：老客户端（无 localStorage API）→ 退化为只认领 pending，不抛错', () => {
	const view = makeView({
		app: {},
		path: 'A.md',
		data: NOTE,
		pending: { path: 'A.md', continuations: [], sections: ['1:1:目标'] },
	});
	hydrateSectionFolds(view);
	assert.deepEqual([...view.collapsedSections], ['1:1:目标']);

	const noFile = makeView({ app: {}, path: null, pending: null });
	hydrateSectionFolds(noFile);
	assert.equal(noFile.collapsedSections.size, 0);
});

test('hydrate：显式传 pending 时不再 take（两处 hydrate 共用同一份）', () => {
	const { app } = makeStorage();
	const view = makeView({ app, path: 'A.md', data: NOTE });
	view.pendingLeafFolds = {
		path: 'A.md',
		continuations: [],
		sections: ['s:1:目标'],
	};
	hydrateSectionFolds(view, view.takePendingLeafFolds());
	assert.deepEqual([...view.collapsedSections], ['s:1:目标']);
	assert.equal(view.pendingLeafFolds, null);
});

test('persist：整份镜像覆盖写；空集合写 []（展开后重载不复活）', () => {
	const { app, map } = makeStorage();
	const view = makeView({ app, path: 'A.md', data: NOTE });
	view.collapsedSections.add('s:1:目标');
	persistSectionFolds(view);
	assert.deepEqual(loadSectionFolds(app, 'A.md'), ['s:1:目标']);
	assert.equal(map.get(`aaa-${FOLD_STORE_PREFIX}A.md`).v, 1);

	view.collapsedSections.clear();
	persistSectionFolds(view);
	assert.deepEqual(loadSectionFolds(app, 'A.md'), []);
	assert.notEqual(loadSectionFolds(app, 'A.md'), null);

	// 无文件 / 无 API → no-op
	persistSectionFolds(makeView({ app, path: null }));
	persistSectionFolds(makeView({ app: {}, path: 'Z.md' }));
});
