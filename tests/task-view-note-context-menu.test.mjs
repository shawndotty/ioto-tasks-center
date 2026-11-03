import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

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

const {
	buildNoteContextMenu,
	readNotePriority,
	readNoteStarred,
	shouldShowNoteContextMenu,
} = await jiti.import('../src/views/ioto-task/task-view-note-context-menu.ts');

function createFakeMenu(options = {}) {
	const items = [];
	const menu = {
		items,
		addItem(callback) {
			const item = {
				title: '',
				icon: null,
				disabled: false,
				submenu: null,
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

			if (!options.withoutSubmenu) {
				item.setSubmenu = () => {
					item.submenu = createFakeMenu(options);
					return item.submenu;
				};
			}

			callback(item);
			items.push({ title: item.title, item });
			return menu;
		},
		addSeparator() {
			items.push({ separator: true });
			return menu;
		},
	};

	return menu;
}

function entriesOf(menu) {
	return menu.items.filter((entry) => !entry.separator);
}

function titlesOf(menu) {
	return menu.items.map((entry) => (entry.separator ? '---' : entry.title));
}

function baseOptions(overrides = {}) {
	return {
		starred: false,
		priority: null,
		canDelete: true,
		onShowLinks: () => {},
		onSetPriority: () => {},
		onClearPriority: () => {},
		onToggleStarred: () => {},
		onDelete: () => {},
		...overrides,
	};
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- 菜单构造（10 条） ----

test('未标记、无优先级：顶层 4 项 + 2 分隔线', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions());

	const entries = entriesOf(menu);
	assert.equal(entries.length, 4);
	assert.equal(menu.items.filter((entry) => entry.separator).length, 2);
	assert.deepEqual(
		entries.map((entry) => entry.title),
		[
			'View related links',
			'Priority',
			'Mark as core task',
			'Delete current task note',
		],
	);
});

test('已设优先级：标题带当前值，子菜单含取消项与 4 档', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions({ priority: 2 }));

	const priorityEntry = entriesOf(menu)[1];
	assert.equal(priorityEntry.title, 'Priority: P2');
	assert.deepEqual(titlesOf(priorityEntry.item.submenu), [
		'Clear priority',
		'---',
		'P0',
		'P1',
		'P2 (current)',
		'P3',
	]);
});

test('未设优先级：子菜单没有取消项，只剩 4 档', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions({ priority: null }));

	const submenu = entriesOf(menu)[1].item.submenu;
	assert.deepEqual(titlesOf(submenu), ['P0', 'P1', 'P2', 'P3']);
});

test('核心任务二态：标题与图标随状态翻转', () => {
	const starred = createFakeMenu();
	buildNoteContextMenu(starred, baseOptions({ starred: true }));
	const starredEntry = entriesOf(starred)[2];
	assert.equal(starredEntry.title, 'Clear core task mark');
	assert.equal(starredEntry.item.icon, 'star-off');

	const plain = createFakeMenu();
	buildNoteContextMenu(plain, baseOptions({ starred: false }));
	const plainEntry = entriesOf(plain)[2];
	assert.equal(plainEntry.title, 'Mark as core task');
	assert.equal(plainEntry.item.icon, 'star');
});

test('删除项按 canDelete 置灰', () => {
	const blocked = createFakeMenu();
	buildNoteContextMenu(blocked, baseOptions({ canDelete: false }));
	assert.equal(entriesOf(blocked)[3].item.disabled, true);

	const allowed = createFakeMenu();
	buildNoteContextMenu(allowed, baseOptions({ canDelete: true }));
	assert.equal(entriesOf(allowed)[3].item.disabled, false);
});

test('无 setSubmenu 且无优先级：标题项禁用 + 平铺 4 档', () => {
	const menu = createFakeMenu({ withoutSubmenu: true });
	buildNoteContextMenu(menu, baseOptions({ priority: null }));

	const entries = entriesOf(menu);
	assert.equal(entries.length, 8);
	assert.equal(menu.items.filter((entry) => entry.separator).length, 2);
	assert.deepEqual(
		entries.map((entry) => entry.title),
		[
			'View related links',
			'Priority',
			'P0',
			'P1',
			'P2',
			'P3',
			'Mark as core task',
			'Delete current task note',
		],
	);
	assert.equal(entries[1].item.disabled, true);
});

test('无 setSubmenu 且已设优先级：平铺取消项与 4 档', () => {
	const menu = createFakeMenu({ withoutSubmenu: true });
	buildNoteContextMenu(menu, baseOptions({ priority: 2 }));

	const entries = entriesOf(menu);
	assert.equal(entries.length, 9);
	assert.equal(menu.items.filter((entry) => entry.separator).length, 3);
	assert.deepEqual(
		entries.map((entry) => entry.title),
		[
			'View related links',
			'Priority: P2',
			'Clear priority',
			'P0',
			'P1',
			'P2 (current)',
			'P3',
			'Mark as core task',
			'Delete current task note',
		],
	);
	assert.equal(entries[1].item.disabled, true);
});

test('点击「显示相关链接」：回调恰好一次（延迟执行）', async () => {
	let calls = 0;
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions({ onShowLinks: () => (calls += 1) }));

	entriesOf(menu)[0].item.click();
	assert.equal(calls, 0);
	await wait(80);
	assert.equal(calls, 1);
});

test('点击核心项与删除项：各自回调恰好一次', async () => {
	let starred = 0;
	let deleted = 0;
	const menu = createFakeMenu();
	buildNoteContextMenu(
		menu,
		baseOptions({
			onToggleStarred: () => (starred += 1),
			onDelete: () => (deleted += 1),
		}),
	);

	entriesOf(menu)[2].item.click();
	entriesOf(menu)[3].item.click();
	await wait(80);
	assert.equal(starred, 1);
	assert.equal(deleted, 1);
});

test('子菜单点 P2：onSetPriority 收到 2，onClearPriority 不被调用', async () => {
	const received = [];
	let cleared = 0;
	const menu = createFakeMenu();
	buildNoteContextMenu(
		menu,
		baseOptions({
			priority: 2,
			onSetPriority: (value) => received.push(value),
			onClearPriority: () => (cleared += 1),
		}),
	);

	const submenu = entriesOf(menu)[1].item.submenu;
	const current = entriesOf(submenu).find(
		(entry) => entry.title === 'P2 (current)',
	);
	current.item.click();
	await wait(80);
	assert.deepEqual(received, [2]);
	assert.equal(cleared, 0);
});

// ---- 命中判定（2 条） ----

function fakeTarget(matchedSelectors) {
	const matched = new Set(matchedSelectors);
	return { closest: (selector) => (matched.has(selector) ? {} : null) };
}

test('卡片 / 交互控件 / 浮层内的右键不弹笔记菜单', () => {
	const cardSelector = '.ioto-task-view__card';
	const cases = [
		[cardSelector],
		[cardSelector, '.card-editor'],
		['button, a, input, textarea, select'],
		['[contenteditable]'],
		['.ioto-quick-panel'],
		['.menu'],
	];
	for (const selectors of cases) {
		assert.equal(
			shouldShowNoteContextMenu(fakeTarget(selectors)),
			false,
			`selectors: ${selectors.join(',')}`,
		);
	}
});

test('空白与节标题 / 节正文可命中；null 目标不命中', () => {
	assert.equal(
		shouldShowNoteContextMenu(
			fakeTarget(['.ioto-task-view__scroll']),
		),
		true,
	);
	assert.equal(
		shouldShowNoteContextMenu(
			fakeTarget(['.ioto-task-view__section-body']),
		),
		true,
	);
	assert.equal(
		shouldShowNoteContextMenu(
			fakeTarget(['.ioto-task-view__section-header']),
		),
		true,
	);
	assert.equal(shouldShowNoteContextMenu(null), false);
});

// ---- 快照读取（2 条） ----

test('readNotePriority：只认 0-3 的整数', () => {
	assert.equal(readNotePriority('---\nPriority: 2\n---\n'), 2);
	assert.equal(readNotePriority('---\nPriority: "3"\n---\n'), 3);
	assert.equal(readNotePriority('---\nPriority: 9\n---\n'), null);
	assert.equal(readNotePriority('---\nPriority: x\n---\n'), null);
	assert.equal(readNotePriority('---\nProject: A\n---\n'), null);
	assert.equal(readNotePriority('---\nPriority:\n---\n'), null);
});

test('readNoteStarred：显式 true（大小写不敏感）为真', () => {
	assert.equal(readNoteStarred('---\nStarred: true\n---\n'), true);
	assert.equal(readNoteStarred('---\nStarred: FALSE\n---\n'), false);
	assert.equal(readNoteStarred('---\nProject: A\n---\n'), false);
});
