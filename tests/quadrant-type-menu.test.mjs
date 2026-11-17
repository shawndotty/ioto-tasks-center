import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限任务类型菜单单测（[[Plan-20261117-085118]] §6.3）。
// 语言要在 import 之前定好：`t()` 现读 window.localStorage 的 language。
globalThis.window = globalThis;
globalThis.localStorage = {
	getItem: (key) => (key === 'language' ? 'en' : null),
};

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { buildQuadrantTypeMenu } = await jiti.import(
	'../src/views/quadrant/type-filter-bar.ts',
);
const { Menu } = await jiti.import('obsidian');

const TYPE_COUNTS = { normal: 116, date: 53, topic: 2, plan: 109 };
const ALL_TYPES = ['normal', 'date', 'topic', 'plan'];

function makeCtx({ activeKeys = ALL_TYPES, model = {} } = {}) {
	const calls = [];
	const ctx = {
		calls,
		getModel: () => ({ typeCounts: TYPE_COUNTS, ...model }),
		getTypeKeys: () => new Set(activeKeys),
		toggleTypeKey: (key) => calls.push({ kind: 'toggle', key }),
		setTypeKeys: (keys) => calls.push({ kind: 'set', keys: [...keys] }),
	};
	return ctx;
}

test('菜单结构：分组标题 + 全部类型 + 分隔符 + 4 项类型', () => {
	const menu = new Menu();
	buildQuadrantTypeMenu(menu, makeCtx());

	assert.equal(menu.items.length, 7);
	assert.equal(menu.items[0].isLabel, true);
	assert.equal(menu.items[0].title, 'Task type');
	assert.equal(menu.items[1].title, 'All types');
	assert.equal(menu.items[1].checked, true);
	assert.equal(menu.items[2].separator, true);
});

test('类型项文案带计数（taskFilterSwitcher.menuItem 格式）', () => {
	const menu = new Menu();
	buildQuadrantTypeMenu(menu, makeCtx());

	assert.deepEqual(
		menu.items.slice(3).map((entry) => entry.title),
		['Normal task (116)', 'Date task (53)', 'Subject task (2)', 'Plan task (109)'],
	);
});

test('勾选态与 getTypeKeys 一致', () => {
	const menu = new Menu();
	buildQuadrantTypeMenu(menu, makeCtx({ activeKeys: ['plan', 'date'] }));

	assert.deepEqual(
		menu.items.slice(3).map((entry) => entry.checked),
		[false, true, false, true],
	);
	// 非全选时「All types」不勾
	assert.equal(menu.items[1].checked, false);
});

test('全不选时 4 项与 All types 均未勾', () => {
	const menu = new Menu();
	buildQuadrantTypeMenu(menu, makeCtx({ activeKeys: [] }));

	assert.equal(menu.items[1].checked, false);
	assert.deepEqual(
		menu.items.slice(3).map((entry) => entry.checked),
		[false, false, false, false],
	);
});

test('点击类型项只调一次 toggleTypeKey', () => {
	const ctx = makeCtx();
	const menu = new Menu();
	buildQuadrantTypeMenu(menu, ctx);

	menu.items[5].click();
	assert.deepEqual(ctx.calls, [{ kind: 'toggle', key: 'topic' }]);
});

test('点击 All types 调 setTypeKeys 并传入 4 类', () => {
	const ctx = makeCtx({ activeKeys: ['plan'] });
	const menu = new Menu();
	buildQuadrantTypeMenu(menu, ctx);

	menu.items[1].click();
	assert.deepEqual(ctx.calls, [{ kind: 'set', keys: ALL_TYPES }]);
});

test('模型未就绪时计数回退为 0', () => {
	const menu = new Menu();
	buildQuadrantTypeMenu(menu, {
		getModel: () => null,
		getTypeKeys: () => new Set(ALL_TYPES),
		toggleTypeKey: () => {},
		setTypeKeys: () => {},
	});

	assert.deepEqual(
		menu.items.slice(3).map((entry) => entry.title),
		['Normal task (0)', 'Date task (0)', 'Subject task (0)', 'Plan task (0)'],
	);
});
