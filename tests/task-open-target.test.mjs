import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { resolveTaskOpenTargetFromMouse } = await jiti.import(
	'../src/views/tasks-center/task-open-target.ts',
);

test('单 Alt → current-pane-tab', () => {
	assert.equal(
		resolveTaskOpenTargetFromMouse({ altKey: true, metaKey: false, ctrlKey: false }),
		'current-pane-tab',
	);
});

test('Alt + Cmd / Alt + Ctrl → right-split-tab', () => {
	assert.equal(
		resolveTaskOpenTargetFromMouse({ altKey: true, metaKey: true, ctrlKey: false }),
		'right-split-tab',
	);
	assert.equal(
		resolveTaskOpenTargetFromMouse({ altKey: true, metaKey: false, ctrlKey: true }),
		'right-split-tab',
	);
});

test('无修饰键 → adjacent-preview', () => {
	assert.equal(
		resolveTaskOpenTargetFromMouse({ altKey: false, metaKey: false, ctrlKey: false }),
		'adjacent-preview',
	);
});

test('单 Cmd / 单 Ctrl（无 Alt）→ adjacent-preview，不抢占普通语义', () => {
	assert.equal(
		resolveTaskOpenTargetFromMouse({ altKey: false, metaKey: true, ctrlKey: false }),
		'adjacent-preview',
	);
	assert.equal(
		resolveTaskOpenTargetFromMouse({ altKey: false, metaKey: false, ctrlKey: true }),
		'adjacent-preview',
	);
});
