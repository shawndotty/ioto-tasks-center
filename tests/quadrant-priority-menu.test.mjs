import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限精简优先级菜单单测（[[Plan-20261115-201917]] §6.2）。
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

const { buildQuadrantPriorityMenu } = await jiti.import(
	'../src/views/quadrant/menus.ts',
);
const { Menu } = await jiti.import('obsidian');

const entriesOf = (menu) => menu.items.filter((entry) => !entry.separator);
const titlesOf = (menu) =>
	menu.items.map((entry) => (entry.separator ? '---' : entry.title));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('未标注：无「取消优先级」，四项 P0–P3 且均非当前项', () => {
	const menu = new Menu();
	buildQuadrantPriorityMenu(menu, { priority: undefined, onSelect: () => {} });

	assert.deepEqual(titlesOf(menu), ['P0', 'P1', 'P2', 'P3']);
	assert.ok(entriesOf(menu).every((entry) => entry.checked === false));
});

test('已标注 P1：首项「取消优先级」+ 分隔符，P1 带「（当前）」', () => {
	const menu = new Menu();
	buildQuadrantPriorityMenu(menu, { priority: 1, onSelect: () => {} });

	assert.deepEqual(titlesOf(menu), [
		'Clear priority',
		'---',
		'P0',
		'P1 (current)',
		'P2',
		'P3',
	]);
	assert.equal(entriesOf(menu)[2].checked, true);
	assert.equal(entriesOf(menu)[0].checked, false);
	assert.equal(entriesOf(menu)[1].checked, false);
});

test('点击条目 → onSelect 收到正确值；取消项 → undefined', async () => {
	const received = [];
	const menu = new Menu();
	buildQuadrantPriorityMenu(menu, {
		priority: 2,
		onSelect: (value) => received.push(value),
	});

	const entries = entriesOf(menu);
	entries[0].click();
	entries[3].click();
	entries[1].click();

	assert.deepEqual(received, []);
	await wait(80);
	assert.deepEqual(received, [undefined, 2, 0]);
});

test('顺序固定：不因输入优先级变化，P0→P3 始终升序', () => {
	for (const priority of [undefined, 0, 3, 4]) {
		const menu = new Menu();
		buildQuadrantPriorityMenu(menu, { priority, onSelect: () => {} });
		const priorities = entriesOf(menu)
			.filter((entry) => entry.title.startsWith('P'))
			.map((entry) => entry.title.replace(/ \(current\)$/, ''));
		assert.deepEqual(priorities, ['P0', 'P1', 'P2', 'P3']);
	}
});
