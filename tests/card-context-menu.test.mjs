import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 卡片右键菜单的纯构造单测（[[Plan-20261104-060428]] §6.3）。
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

const { buildCardContextMenu } = await jiti.import(
	'../src/views/ioto-task/render-card-context-menu.ts',
);

function createFakeMenu() {
	const items = [];
	const menu = {
		items,
		addItem(callback) {
			const item = {
				title: '',
				icon: null,
				disabled: false,
				click: null,
				setTitle(title) {
					item.title = title;
					return item;
				},
				setIcon(icon) {
					item.icon = icon;
					return item;
				},
				setDisabled(disabled) {
					item.disabled = disabled;
					return item;
				},
				onClick(handler) {
					item.click = handler;
					return item;
				},
			};
			callback(item);
			items.push(item);
			return menu;
		},
		addSeparator() {
			items.push({ separator: true });
			return menu;
		},
	};
	return menu;
}

const entriesOf = (menu) => menu.items.filter((entry) => !entry.separator);
const titlesOf = (menu) =>
	menu.items.map((entry) => (entry.separator ? '---' : entry.title));

function baseOptions(overrides = {}) {
	return {
		targets: [3],
		pinned: false,
		repeated: false,
		writable: true,
		onPin: () => {},
		onRepeat: () => {},
		onDuplicate: () => {},
		onMoveToFile: () => {},
		onDelete: () => {},
		...overrides,
	};
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('单选（targets 长度 1）：五项文案与改前逐字一致，顺序含一条分隔线', () => {
	const menu = createFakeMenu();
	buildCardContextMenu(menu, baseOptions());

	assert.deepEqual(titlesOf(menu), [
		'Pin task',
		'Mark as repeat task',
		'---',
		'Duplicate task',
		'Move to…',
		'Delete task',
	]);
});

test('单选已固定 / 已重复：标题与图标翻转（二态不变）', () => {
	const menu = createFakeMenu();
	buildCardContextMenu(
		menu,
		baseOptions({ pinned: true, repeated: true }),
	);

	const entries = entriesOf(menu);
	assert.equal(entries[0].title, 'Unpin task');
	assert.equal(entries[0].icon, 'pin-off');
	assert.equal(entries[1].title, 'Unmark repeat task');
	assert.equal(entries[1].icon, 'repeat-2');
});

test('多选（targets 长度 3）：五项都带条数，删除复用工具栏键', () => {
	const menu = createFakeMenu();
	buildCardContextMenu(menu, baseOptions({ targets: [3, 7, 11] }));

	assert.deepEqual(titlesOf(menu), [
		'Pin 3 tasks',
		'Mark 3 tasks as repeat',
		'---',
		'Duplicate 3 tasks',
		'Move to… (3)',
		'Delete 3',
	]);
});

test('多选且已固定 / 已重复：批量取消文案', () => {
	const menu = createFakeMenu();
	buildCardContextMenu(
		menu,
		baseOptions({ targets: [3, 7], pinned: true, repeated: true }),
	);

	const entries = entriesOf(menu);
	assert.equal(entries[0].title, 'Unpin 2 tasks');
	assert.equal(entries[1].title, 'Unmark repeat for 2 tasks');
});

test('writable:false → 五项全部置灰（分隔线不计）', () => {
	const menu = createFakeMenu();
	buildCardContextMenu(menu, baseOptions({ targets: [3, 7], writable: false }));

	const entries = entriesOf(menu);
	assert.equal(entries.length, 5);
	for (const entry of entries) {
		assert.equal(entry.disabled, true, entry.title);
	}
});

test('点击回调收到完整 targets 数组；onPin / onRepeat 收到相反方向', async () => {
	const received = [];
	const menu = createFakeMenu();
	buildCardContextMenu(
		menu,
		baseOptions({
			targets: [3, 7, 11],
			pinned: true,
			repeated: false,
			onPin: (lines, pinned) => received.push(['pin', lines, pinned]),
			onRepeat: (lines, repeated) =>
				received.push(['repeat', lines, repeated]),
			onDuplicate: (lines) => received.push(['duplicate', lines]),
			onMoveToFile: (lines) => received.push(['move', lines]),
			onDelete: (lines) => received.push(['delete', lines]),
		}),
	);

	const entries = entriesOf(menu);
	entries[0].click();
	entries[1].click();
	entries[2].click();
	entries[3].click();
	entries[4].click();

	assert.deepEqual(received, []);
	await wait(80);
	assert.deepEqual(received, [
		['pin', [3, 7, 11], false],
		['repeat', [3, 7, 11], true],
		['duplicate', [3, 7, 11]],
		['move', [3, 7, 11]],
		['delete', [3, 7, 11]],
	]);
});
