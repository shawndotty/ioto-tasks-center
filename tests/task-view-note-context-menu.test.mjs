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

function entryByTitle(menu, title) {
	const entry = entriesOf(menu).find((item) => item.title === title);
	assert.ok(entry, `missing menu entry: ${title}`);
	return entry;
}

function baseOptions(overrides = {}) {
	return {
		starred: false,
		priority: null,
		canDelete: true,
		hasSections: true,
		hasContinuations: true,
		onShowLinks: () => {},
		onSetPriority: () => {},
		onClearPriority: () => {},
		onToggleStarred: () => {},
		onToggleAllSections: () => {},
		onToggleAllContinuations: () => {},
		exporting: false,
		canInsertEntryTemplate: true,
		onExportImage: () => {},
		onCopyImage: () => {},
		onInsertEntryTemplate: () => {},
		onSearchTasks: () => {},
		onDelete: () => {},
		...overrides,
	};
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- 菜单构造（15 条） ----

test('未标记、无优先级：顶层 10 项 + 4 分隔线（含折叠组与视图动作组）', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions());

	const entries = entriesOf(menu);
	assert.equal(entries.length, 10);
	assert.equal(menu.items.filter((entry) => entry.separator).length, 4);
	assert.deepEqual(
		entries.map((entry) => entry.title),
		[
			'View related links',
			'Priority',
			'Mark as core task',
			'Collapse / expand all sections',
			'Collapse / expand all continuations',
			'Export as image',
			'Copy as image',
			'Insert entry template',
			'Search tasks',
			'Delete current task note',
		],
	);
});

test('已设优先级：标题带当前值，子菜单含取消项与 4 档', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions({ priority: 2 }));

	const priorityEntry = entryByTitle(menu, 'Priority: P2');
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

	const submenu = entryByTitle(menu, 'Priority').item.submenu;
	assert.deepEqual(titlesOf(submenu), ['P0', 'P1', 'P2', 'P3']);
});

test('核心任务二态：标题与图标随状态翻转', () => {
	const starred = createFakeMenu();
	buildNoteContextMenu(starred, baseOptions({ starred: true }));
	const starredEntry = entryByTitle(starred, 'Clear core task mark');
	assert.equal(starredEntry.item.icon, 'star-off');

	const plain = createFakeMenu();
	buildNoteContextMenu(plain, baseOptions({ starred: false }));
	const plainEntry = entryByTitle(plain, 'Mark as core task');
	assert.equal(plainEntry.item.icon, 'star');
});

test('删除项按 canDelete 置灰', () => {
	const blocked = createFakeMenu();
	buildNoteContextMenu(blocked, baseOptions({ canDelete: false }));
	assert.equal(
		entryByTitle(blocked, 'Delete current task note').item.disabled,
		true,
	);

	const allowed = createFakeMenu();
	buildNoteContextMenu(allowed, baseOptions({ canDelete: true }));
	assert.equal(
		entryByTitle(allowed, 'Delete current task note').item.disabled,
		false,
	);
});

test('无 setSubmenu 且无优先级：标题项禁用 + 平铺 4 档', () => {
	const menu = createFakeMenu({ withoutSubmenu: true });
	buildNoteContextMenu(menu, baseOptions({ priority: null }));

	const entries = entriesOf(menu);
	assert.equal(entries.length, 14);
	assert.equal(menu.items.filter((entry) => entry.separator).length, 4);
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
			'Collapse / expand all sections',
			'Collapse / expand all continuations',
			'Export as image',
			'Copy as image',
			'Insert entry template',
			'Search tasks',
			'Delete current task note',
		],
	);
	assert.equal(entries[1].item.disabled, true);
});

test('无 setSubmenu 且已设优先级：平铺取消项与 4 档', () => {
	const menu = createFakeMenu({ withoutSubmenu: true });
	buildNoteContextMenu(menu, baseOptions({ priority: 2 }));

	const entries = entriesOf(menu);
	assert.equal(entries.length, 15);
	assert.equal(menu.items.filter((entry) => entry.separator).length, 5);
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
			'Collapse / expand all sections',
			'Collapse / expand all continuations',
			'Export as image',
			'Copy as image',
			'Insert entry template',
			'Search tasks',
			'Delete current task note',
		],
	);
	assert.equal(entries[1].item.disabled, true);
});

test('点击「显示相关链接」：回调恰好一次（延迟执行）', async () => {
	let calls = 0;
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions({ onShowLinks: () => (calls += 1) }));

	entryByTitle(menu, 'View related links').item.click();
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

	entryByTitle(menu, 'Mark as core task').item.click();
	entryByTitle(menu, 'Delete current task note').item.click();
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

	const submenu = entryByTitle(menu, 'Priority: P2').item.submenu;
	const current = entriesOf(submenu).find(
		(entry) => entry.title === 'P2 (current)',
	);
	current.item.click();
	await wait(80);
	assert.deepEqual(received, [2]);
	assert.equal(cleared, 0);
});

test('无续写区：只隐藏续写项，Section 项仍在', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions({ hasContinuations: false }));

	const titles = entriesOf(menu).map((entry) => entry.title);
	assert.equal(titles.length, 9);
	assert.equal(menu.items.filter((entry) => entry.separator).length, 4);
	assert.ok(!titles.includes('Collapse / expand all continuations'));
	assert.ok(titles.includes('Collapse / expand all sections'));
});

test('无 Section：只隐藏 Section 项，续写项仍在', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions({ hasSections: false }));

	const titles = entriesOf(menu).map((entry) => entry.title);
	assert.equal(titles.length, 9);
	assert.equal(menu.items.filter((entry) => entry.separator).length, 4);
	assert.ok(!titles.includes('Collapse / expand all sections'));
	assert.ok(titles.includes('Collapse / expand all continuations'));
});

test('两者都不可用：折叠组整组消失、视图动作组仍在（8 项 + 3 分隔线）', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(
		menu,
		baseOptions({ hasSections: false, hasContinuations: false }),
	);

	assert.deepEqual(titlesOf(menu), [
		'View related links',
		'---',
		'Priority',
		'Mark as core task',
		'---',
		'Export as image',
		'Copy as image',
		'Insert entry template',
		'Search tasks',
		'---',
		'Delete current task note',
	]);
});

test('点击折叠组两项：各自回调恰好一次（延迟执行）', async () => {
	let sections = 0;
	let continuations = 0;
	const menu = createFakeMenu();
	buildNoteContextMenu(
		menu,
		baseOptions({
			onToggleAllSections: () => (sections += 1),
			onToggleAllContinuations: () => (continuations += 1),
		}),
	);

	entryByTitle(menu, 'Collapse / expand all sections').item.click();
	entryByTitle(menu, 'Collapse / expand all continuations').item.click();
	assert.equal(sections, 0);
	assert.equal(continuations, 0);
	await wait(80);
	assert.equal(sections, 1);
	assert.equal(continuations, 1);
});

test('折叠组后紧跟视图动作组：折叠组夹在核心任务与视图动作之间，删除恒居末位', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions());

	const titles = titlesOf(menu);
	const coreIndex = titles.indexOf('Mark as core task');
	const sectionsIndex = titles.indexOf('Collapse / expand all sections');
	const continuationsIndex = titles.indexOf(
		'Collapse / expand all continuations',
	);
	const exportIndex = titles.indexOf('Export as image');
	const searchIndex = titles.indexOf('Search tasks');
	const deleteIndex = titles.indexOf('Delete current task note');

	assert.equal(sectionsIndex, coreIndex + 2);
	assert.equal(continuationsIndex, sectionsIndex + 1);
	assert.equal(titles[sectionsIndex - 1], '---');
	// 折叠组与视图动作组之间仍是**一条**分隔线
	assert.equal(exportIndex, continuationsIndex + 2);
	assert.equal(titles[continuationsIndex + 1], '---');
	assert.equal(deleteIndex, searchIndex + 2);
});

// ---- 视图动作组（5 条，[[Plan-20261103-155712]] C4） ----

test('N1 视图动作组：四项相邻，顺序为导图→复制→插入模板→搜索，上下各一条分隔线', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions());

	const titles = titlesOf(menu);
	const exportIndex = titles.indexOf('Export as image');
	assert.deepEqual(titles.slice(exportIndex - 1, exportIndex + 5), [
		'---',
		'Export as image',
		'Copy as image',
		'Insert entry template',
		'Search tasks',
		'---',
	]);
});

test('N2 视图动作组：图标分别为 image-down / clipboard-copy / layout-template / search', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions());

	assert.equal(entryByTitle(menu, 'Export as image').item.icon, 'image-down');
	assert.equal(entryByTitle(menu, 'Copy as image').item.icon, 'clipboard-copy');
	assert.equal(
		entryByTitle(menu, 'Insert entry template').item.icon,
		'layout-template',
	);
	assert.equal(entryByTitle(menu, 'Search tasks').item.icon, 'search');
});

test('N3 canInsertEntryTemplate=false：插入项隐藏，其余三项仍在且只有一条前置分隔线', () => {
	const menu = createFakeMenu();
	buildNoteContextMenu(menu, baseOptions({ canInsertEntryTemplate: false }));

	const titles = entriesOf(menu).map((entry) => entry.title);
	assert.ok(!titles.includes('Insert entry template'));
	assert.ok(titles.includes('Export as image'));
	assert.ok(titles.includes('Copy as image'));
	assert.ok(titles.includes('Search tasks'));

	const rawTitles = titlesOf(menu);
	const exportIndex = rawTitles.indexOf('Export as image');
	assert.equal(rawTitles[exportIndex - 1], '---');
	// 不产生连续分隔线
	for (let i = 1; i < rawTitles.length; i += 1) {
		assert.ok(
			!(rawTitles[i] === '---' && rawTitles[i - 1] === '---'),
			`consecutive separators at ${i}`,
		);
	}
});

test('N4 exporting 置灰：导出 / 复制随 exporting 翻转，插入 / 搜索恒可点', () => {
	const busy = createFakeMenu();
	buildNoteContextMenu(busy, baseOptions({ exporting: true }));
	assert.equal(entryByTitle(busy, 'Export as image').item.disabled, true);
	assert.equal(entryByTitle(busy, 'Copy as image').item.disabled, true);
	assert.equal(entryByTitle(busy, 'Insert entry template').item.disabled, false);
	assert.equal(entryByTitle(busy, 'Search tasks').item.disabled, false);

	const idle = createFakeMenu();
	buildNoteContextMenu(idle, baseOptions({ exporting: false }));
	for (const title of [
		'Export as image',
		'Copy as image',
		'Insert entry template',
		'Search tasks',
	]) {
		assert.equal(entryByTitle(idle, title).item.disabled, false, title);
	}
});

test('N5 点击视图动作四项：各自回调恰好一次（延迟执行）', async () => {
	const calls = {
		exportImage: 0,
		copyImage: 0,
		insertTemplate: 0,
		search: 0,
	};
	const menu = createFakeMenu();
	buildNoteContextMenu(
		menu,
		baseOptions({
			onExportImage: () => (calls.exportImage += 1),
			onCopyImage: () => (calls.copyImage += 1),
			onInsertEntryTemplate: () => (calls.insertTemplate += 1),
			onSearchTasks: () => (calls.search += 1),
		}),
	);

	entryByTitle(menu, 'Export as image').item.click();
	entryByTitle(menu, 'Copy as image').item.click();
	entryByTitle(menu, 'Insert entry template').item.click();
	entryByTitle(menu, 'Search tasks').item.click();
	assert.deepEqual(calls, {
		exportImage: 0,
		copyImage: 0,
		insertTemplate: 0,
		search: 0,
	});
	await wait(80);
	assert.deepEqual(calls, {
		exportImage: 1,
		copyImage: 1,
		insertTemplate: 1,
		search: 1,
	});
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
