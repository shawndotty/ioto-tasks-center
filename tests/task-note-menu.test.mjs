import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { TFile, TFolder } = await jiti.import('./stubs/obsidian.mjs');
const { buildTaskNoteMenu, isTaskNoteFile } = await jiti.import(
	'../src/tasks-center/task-note-menu.ts',
);

test('任务根目录下的 markdown 笔记会被识别为任务笔记', () => {
	assert.equal(
		isTaskNoteFile(new TFile('3-任务/项目A/任务.md'), '3-任务'),
		true,
	);
});

test('任务根目录深层子目录中的笔记也会被识别', () => {
	assert.equal(
		isTaskNoteFile(new TFile('3-任务/项目A/子目录/任务.md'), '3-任务'),
		true,
	);
});

test('任务根目录带尾斜杠时仍能识别', () => {
	assert.equal(
		isTaskNoteFile(new TFile('3-任务/项目A/任务.md'), '3-任务//'),
		true,
	);
});

test('任务根目录带 ./ 前缀时仍能识别', () => {
	assert.equal(
		isTaskNoteFile(new TFile('3-任务/项目A/任务.md'), './3-任务'),
		true,
	);
});

test('非 markdown 文件不会被识别为任务笔记', () => {
	assert.equal(isTaskNoteFile(new TFile('3-任务/项目A/附件.png'), '3-任务'), false);
});

test('任务根目录之外的笔记不会被识别', () => {
	assert.equal(isTaskNoteFile(new TFile('2-输出/项目A/笔记.md'), '3-任务'), false);
});

test('与任务根目录同前缀的兄弟目录不会被误判', () => {
	assert.equal(
		isTaskNoteFile(new TFile('3-任务归档/项目A/任务.md'), '3-任务'),
		false,
	);
});

test('文件夹不会被识别为任务笔记', () => {
	assert.equal(isTaskNoteFile(new TFolder('3-任务/项目A'), '3-任务'), false);
});

test('两个开关都开启时，文件菜单只多出一个子菜单', () => {
	const menu = createFakeMenu();

	buildTaskNoteMenu({
		app: {},
		file: new TFile('3-任务/项目A/任务.md'),
		menu,
		settings: { showCore: true, showPriority: true },
		starred: false,
		priority: 2,
	});

	assert.equal(menu.items.length, 1);
	assert.equal(menu.items[0].title, 'Core task and priority');
	assert.deepEqual(titlesOf(menu.items[0].item.submenu), [
		'Mark as core task',
		'---',
		'Clear priority',
		'---',
		'P0',
		'P1',
		'P2 (current)',
		'P3',
	]);
});

test('只开启核心任务时，子菜单标题与内容都只剩核心任务', () => {
	const menu = createFakeMenu();

	buildTaskNoteMenu({
		app: {},
		file: new TFile('3-任务/项目A/任务.md'),
		menu,
		settings: { showCore: true, showPriority: false },
		starred: true,
	});

	assert.equal(menu.items[0].title, 'Core task');
	assert.deepEqual(titlesOf(menu.items[0].item.submenu), [
		'Clear core task mark',
	]);
});

test('只开启优先级时，子菜单标题为优先级', () => {
	const menu = createFakeMenu();

	buildTaskNoteMenu({
		app: {},
		file: new TFile('3-任务/项目A/任务.md'),
		menu,
		settings: { showCore: false, showPriority: true },
		starred: false,
	});

	assert.equal(menu.items[0].title, 'Priority');
	assert.deepEqual(titlesOf(menu.items[0].item.submenu), [
		'P0',
		'P1',
		'P2',
		'P3',
	]);
});

test('未设置优先级时不显示「取消优先级」', () => {
	const menu = createFakeMenu();

	buildTaskNoteMenu({
		app: {},
		file: new TFile('3-任务/项目A/任务.md'),
		menu,
		settings: { showCore: false, showPriority: true },
		starred: false,
		priority: undefined,
	});

	assert.equal(titlesOf(menu.items[0].item.submenu).includes('Clear priority'), false);
});

test('两个开关都关闭时不注入任何菜单项', () => {
	const menu = createFakeMenu();

	buildTaskNoteMenu({
		app: {},
		file: new TFile('3-任务/项目A/任务.md'),
		menu,
		settings: { showCore: false, showPriority: false },
		starred: false,
	});

	assert.equal(menu.items.length, 0);
});

test('老版本 Obsidian 缺少 setSubmenu 时降级为平铺', () => {
	const menu = createFakeMenu({ withoutSubmenu: true });

	buildTaskNoteMenu({
		app: {},
		file: new TFile('3-任务/项目A/任务.md'),
		menu,
		settings: { showCore: true, showPriority: true },
		starred: false,
		priority: 2,
	});

	assert.deepEqual(titlesOf(menu), [
		'Core task and priority',
		'Mark as core task',
		'---',
		'Clear priority',
		'---',
		'P0',
		'P1',
		'P2 (current)',
		'P3',
	]);
});

test('点击优先级项会写入 frontmatter', async () => {
	const state = { content: '---\nProject:\n  - "项目A"\n---\n# 任务\n' };
	const app = {
		vault: {
			process: async (_file, transform) => {
				state.content = transform(state.content);
				return state.content;
			},
		},
	};
	const menu = createFakeMenu();

	buildTaskNoteMenu({
		app,
		file: new TFile('3-任务/项目A/任务.md'),
		menu,
		settings: { showCore: false, showPriority: true },
		starred: false,
	});

	const p1Item = menu.items[0].item.submenu.items.find(
		(entry) => entry.title === 'P1',
	);
	p1Item.item.click();
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(
		state.content,
		'---\nProject:\n  - "项目A"\nPriority: 1\n---\n# 任务\n',
	);
	assert.equal(state.content.includes('Project'), true);
});

test('点击核心任务项会写入 Starred', async () => {
	const state = { content: '---\nProject:\n  - "项目A"\n---\n# 任务\n' };
	const app = {
		vault: {
			process: async (_file, transform) => {
				state.content = transform(state.content);
				return state.content;
			},
		},
	};
	const menu = createFakeMenu();

	buildTaskNoteMenu({
		app,
		file: new TFile('3-任务/项目A/任务.md'),
		menu,
		settings: { showCore: true, showPriority: false },
		starred: false,
	});

	menu.items[0].item.submenu.items[0].item.click();
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(
		state.content,
		'---\nProject:\n  - "项目A"\nStarred: true\n---\n# 任务\n',
	);
});

function titlesOf(menu) {
	return menu.items.map((entry) => (entry.separator ? '---' : entry.title));
}

function createFakeMenu(options = {}) {
	const items = [];
	const menu = {
		items,
		addItem(callback) {
			const item = {
				title: '',
				submenu: null,
				click: null,
				setTitle(title) {
					item.title = title;
					return item;
				},
				onClick(handler) {
					item.click = handler;
					return item;
				},
				setDisabled(disabled) {
					item.disabled = disabled;
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
