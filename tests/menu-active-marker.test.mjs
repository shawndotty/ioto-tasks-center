import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { ACTIVE_MENU_ITEM_CLASS, markActiveMenuItem } = await jiti.import(
	'../src/views/tasks-center/helpers.ts',
);

test('markActiveMenuItem 只给 dom 加当前项修饰类', () => {
	const classes = new Set();
	const item = { dom: { addClass: (cls) => classes.add(cls) } };

	markActiveMenuItem(item);

	assert.deepEqual([...classes], [ACTIVE_MENU_ITEM_CLASS]);
});

test('styles.css 定义了当前项对勾的排序规则', () => {
	const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

	assert.ok(css.includes(`.${ACTIVE_MENU_ITEM_CLASS} .menu-item-icon`));
});
