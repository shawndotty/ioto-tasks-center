import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限窄屏时间菜单单测（[[Plan-20261116-083330]] §6.1）。
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

const { buildQuadrantTimeMenu } = await jiti.import(
	'../src/views/quadrant/time-filter-bar.ts',
);
const { Menu } = await jiti.import('obsidian');

const CREATED_PRESETS = [
	'Last 7 days',
	'Last 2 weeks',
	'Last 30 days',
	'This calendar week',
	'This calendar month',
];
const UPDATED_PRESETS = CREATED_PRESETS;

function makeCtx(timeFilter = { kind: 'none' }) {
	const calls = [];
	return {
		calls,
		getTimeFilter: () => timeFilter,
		setTimeFilter: (filter) => calls.push(['set', filter]),
		openTimeRangeEditor: (anchor) => calls.push(['open', anchor]),
	};
}

function buildMenu(ctx) {
	const menu = new Menu();
	const anchor = { id: 'anchor' };
	buildQuadrantTimeMenu(menu, ctx, anchor);
	return { menu, anchor };
}

test('首项是分组标题「Time range」，第二项「Any time」默认勾选', () => {
	const { menu } = buildMenu(makeCtx());

	assert.equal(menu.items[0].isLabel, true);
	assert.equal(menu.items[0].title, 'Time range');
	assert.equal(menu.items[1].title, 'Any time');
	assert.equal(menu.items[1].checked, true);
});

test('两组各 5 项且顺序固定：按创建时间 / 按更新时间', () => {
	const { menu } = buildMenu(makeCtx());

	const labels = menu.items
		.map((item, index) => ({ item, index }))
		.filter(({ item }) => item.isLabel)
		.map(({ item }) => item.title);
	assert.deepEqual(labels, [
		'Time range',
		'By created time',
		'By updated time',
	]);

	const createdStart = menu.items.findIndex(
		(item) => item.title === 'By created time',
	);
	assert.deepEqual(
		menu.items
			.slice(createdStart + 1, createdStart + 6)
			.map((item) => item.title),
		CREATED_PRESETS,
	);
	const updatedStart = menu.items.findIndex(
		(item) => item.title === 'By updated time',
	);
	assert.deepEqual(
		menu.items
			.slice(updatedStart + 1, updatedStart + 6)
			.map((item) => item.title),
		UPDATED_PRESETS,
	);
	assert.equal(menu.items.at(-1).title, 'Custom range…');
});

test('当前预设（含字段）只有对应项打勾', () => {
	const { menu } = buildMenu(
		makeCtx({ kind: 'preset', value: 'updated-two-weeks' }),
	);
	const checked = menu.items
		.filter((item) => item.checked)
		.map((item) => item.title);
	assert.deepEqual(checked, ['Last 2 weeks']);
	assert.equal(
		menu.items.find((item) => item.title === 'Any time').checked,
		false,
	);
});

test('点击预设转发 setTimeFilter({ kind: "preset" })', () => {
	const ctx = makeCtx();
	const { menu } = buildMenu(ctx);
	const item = menu.items.find(
		(item) => item.title === 'This calendar week' && !item.isLabel,
	);
	item.click();
	assert.deepEqual(ctx.calls, [
		['set', { kind: 'preset', value: 'created-calendar-week' }],
	]);
});

test('点击「Any time」转发 none；点击自定义只打开编辑器，不改状态', () => {
	const anyCtx = makeCtx({ kind: 'preset', value: 'created-week' });
	const anyMenu = buildMenu(anyCtx).menu;
	anyMenu.items[1].click();
	assert.deepEqual(anyCtx.calls, [['set', { kind: 'none' }]]);

	const customCtx = makeCtx();
	const { menu, anchor } = buildMenu(customCtx);
	menu.items.at(-1).click();
	assert.deepEqual(customCtx.calls, [['open', anchor]]);
});
