import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限窄屏状态菜单单测（[[Plan-20261116-061758]] §3.4 / S5）。
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

const { buildQuadrantStatusMenu } = await jiti.import(
	'../src/views/quadrant/filter-bar.ts',
);
const { Menu } = await jiti.import('obsidian');

const STATUS_COUNTS = { 'in-progress': 2, todo: 5, completed: 1 };

function makeCtx({ activeKeys = ['in-progress'], model = {} } = {}) {
	const calls = [];
	const ctx = {
		calls,
		getModel: () => ({
			statusCounts: STATUS_COUNTS,
			total: 8,
			counts: { unlabeled: 0 },
			...model,
		}),
		getStatusKeys: () => new Set(activeKeys),
		toggleStatusKey: (key) => calls.push(key),
	};
	return ctx;
}

test('首项是分组标题「Task status」', () => {
	const menu = new Menu();
	buildQuadrantStatusMenu(menu, makeCtx());

	assert.equal(menu.items.length, 4);
	assert.equal(menu.items[0].isLabel, true);
	assert.equal(menu.items[0].title, 'Task status');
});

test('其后三项按 In progress / Not started / Completed 排列并带计数', () => {
	const menu = new Menu();
	buildQuadrantStatusMenu(menu, makeCtx());

	assert.deepEqual(
		menu.items.slice(1).map((entry) => entry.title),
		['In progress (2)', 'Not started (5)', 'Completed (1)'],
	);
});

test('只有当前激活状态打勾', () => {
	const menu = new Menu();
	buildQuadrantStatusMenu(menu, makeCtx({ activeKeys: ['in-progress'] }));

	assert.deepEqual(
		menu.items.slice(1).map((entry) => entry.checked),
		[true, false, false],
	);
});

test('点击「Completed」转发给 toggleStatusKey 一次', () => {
	const ctx = makeCtx();
	const menu = new Menu();
	buildQuadrantStatusMenu(menu, ctx);

	assert.equal(typeof menu.items[3].click, 'function');
	menu.items[3].click();

	assert.deepEqual(ctx.calls, ['completed']);
});

test('模型未就绪时计数回退为 0', () => {
	const menu = new Menu();
	buildQuadrantStatusMenu(menu, {
		getModel: () => null,
		getStatusKeys: () => new Set(),
		toggleStatusKey: () => {},
	});

	assert.deepEqual(
		menu.items.slice(1).map((entry) => entry.title),
		['In progress (0)', 'Not started (0)', 'Completed (0)'],
	);
});