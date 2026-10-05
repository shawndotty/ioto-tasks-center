import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { resolveDeleteConfirmKey } = await jiti.import(
	'../src/views/ioto-task/delete-confirm.ts',
);

test('非 pending：一律 idle，不干扰常规键位', () => {
	assert.equal(resolveDeleteConfirmKey(false, 'Delete', false), 'idle');
	assert.equal(resolveDeleteConfirmKey(false, 'Escape', false), 'idle');
	assert.equal(resolveDeleteConfirmKey(false, 'Enter', false), 'idle');
});

test('pending：二次 Delete / Backspace 确认', () => {
	assert.equal(resolveDeleteConfirmKey(true, 'Delete', false), 'confirm');
	assert.equal(resolveDeleteConfirmKey(true, 'Backspace', false), 'confirm');
});

test('pending：纯 Enter 确认，带修饰键的 Enter 不确认', () => {
	assert.equal(resolveDeleteConfirmKey(true, 'Enter', false), 'confirm');
	assert.equal(
		resolveDeleteConfirmKey(true, 'Enter', false, { shiftKey: true }),
		'fallthrough',
	);
	assert.equal(
		resolveDeleteConfirmKey(true, 'Enter', false, { commandModifier: true }),
		'fallthrough',
	);
	assert.equal(
		resolveDeleteConfirmKey(true, 'Enter', false, { altKey: true }),
		'fallthrough',
	);
});

test('pending：Esc 取消', () => {
	assert.equal(resolveDeleteConfirmKey(true, 'Escape', false), 'cancel');
});

test('pending：↑↓ 及其它键 fallthrough（先取消再导航）', () => {
	assert.equal(resolveDeleteConfirmKey(true, 'ArrowUp', false), 'fallthrough');
	assert.equal(resolveDeleteConfirmKey(true, 'ArrowDown', false), 'fallthrough');
	assert.equal(resolveDeleteConfirmKey(true, 'a', false), 'fallthrough');
});

test('坑 A：auto-repeat 优先级最高，长按 Del 绝不秒过确认', () => {
	// 即便 key 是 Delete / Enter，一旦 repeat 也必须被吞掉。
	assert.equal(resolveDeleteConfirmKey(true, 'Delete', true), 'repeat');
	assert.equal(resolveDeleteConfirmKey(true, 'Backspace', true), 'repeat');
	assert.equal(resolveDeleteConfirmKey(true, 'Enter', true), 'repeat');
	assert.equal(resolveDeleteConfirmKey(true, 'Escape', true), 'repeat');
});
