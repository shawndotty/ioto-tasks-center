import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { describeToggle } = await jiti.import('../src/view-toggle-model.ts');

test('to-markdown → 指向 Markdown 的图标与文案', () => {
	assert.deepEqual(describeToggle('to-markdown'), {
		direction: 'to-markdown',
		icon: 'file-text',
		labelKey: 'view.iotoTaskView.toggleToMarkdown',
	});
});

test('to-task-view → 指向任务视图的图标与文案', () => {
	assert.deepEqual(describeToggle('to-task-view'), {
		direction: 'to-task-view',
		icon: 'list-todo',
		labelKey: 'view.iotoTaskView.toggleToTaskView',
	});
});

test('null 入 null 出', () => {
	assert.equal(describeToggle(null), null);
});
