import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const {
	showBatchActionsMenu,
	showBatchPriorityMenu,
	showBatchStarredMenu,
	showBatchUpTaskMenu,
} = await jiti.import('../src/views/tasks-center/batch-bar-menus.ts');
const en = (await jiti.import('../src/lang/locale/en.ts')).default;

const instances = (globalThis.__iotoMenuInstances ??= []);

test('优先级菜单：4 档优先级 + 分隔线 + 清除优先级', () => {
	const menu = openMenu(showBatchPriorityMenu);

	assert.deepEqual(titlesOf(menu), [
		'P0',
		'P1',
		'P2',
		'P3',
		'---',
		en['view.batchBar.clearPriority'],
	]);
	assert.equal(menu.shownAtMouseEvent, EVENT);
});

test('核心菜单：标记与取消核心两项', () => {
	const menu = openMenu(showBatchStarredMenu);

	assert.deepEqual(titlesOf(menu), [
		en['view.batchBar.setStarred'],
		en['view.batchBar.clearStarred'],
	]);
});

test('上级菜单：设置上级任务 + 移除上级任务', () => {
	const menu = openMenu(showBatchUpTaskMenu);

	assert.deepEqual(titlesOf(menu), [
		en['view.batchBar.assignUpTask'],
		en['view.batchBar.removeUpTask'],
	]);
});

test('窄栏「操作 ▾」是属性区三组的并集，删除项位于最末且不承载图标', () => {
	const menu = openMenu(showBatchActionsMenu);

	const labels = menu.items
		.filter((item) => !item.separator && item.isLabel)
		.map((item) => item.title);
	assert.deepEqual(labels, [
		en['view.batchBar.menuPriority'],
		en['view.batchBar.menuStarred'],
		en['view.batchBar.menuUpTask'],
		en['view.batchBar.delete'],
	]);

	const actionTitles = menu.items
		.filter((item) => !item.separator && !item.isLabel)
		.map((item) => item.title);
	assert.equal(actionTitles.at(-1), en['view.batchBar.menuDelete']);
	assert.ok(actionTitles.includes('P0'));
	assert.ok(actionTitles.includes(en['view.batchBar.clearPriority']));
	assert.ok(actionTitles.includes(en['view.batchBar.setStarred']));
	assert.ok(actionTitles.includes(en['view.batchBar.clearStarred']));
	assert.ok(actionTitles.includes(en['view.batchBar.assignUpTask']));
	assert.ok(actionTitles.includes(en['view.batchBar.removeUpTask']));

	// macOS 原生菜单会丢弃图标：一律不加，避免 Windows 上出现孤立图标项。
	assert.ok(menu.items.every((item) => !item.icon));
});

test('无鼠标事件时回落到视图顶部定位，而不是抛错', () => {
	const menu = openMenu((view) => showBatchPriorityMenu(view, undefined));

	assert.deepEqual(menu.shownAtPosition, { x: 50, y: 40 });
});

const EVENT = { clientX: 12, clientY: 34 };

function openMenu(show) {
	instances.length = 0;
	show(createView(), EVENT);
	return instances.at(-1);
}

function titlesOf(menu) {
	return menu.items.map((item) => (item.separator ? '---' : item.title));
}

function createView() {
	return {
		selectedTaskPaths: new Set(),
		containerEl: {
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 100 }),
		},
	};
}
