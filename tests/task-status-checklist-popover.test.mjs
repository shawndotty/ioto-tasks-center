import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { truncateChecklistPreview } = await jiti.import(
	'../src/ui/task-status-checklist-popover.ts',
);

test('20 个字符以内的 checklist 预览不截断', () => {
	assert.equal(truncateChecklistPreview('短任务', 20), '短任务');
	assert.equal(
		truncateChecklistPreview('12345678901234567890', 20),
		'12345678901234567890',
	);
});

test('超过 20 个字符的 checklist 预览会截断并追加省略号', () => {
	assert.equal(
		truncateChecklistPreview('1234567890123456789012345', 20),
		'12345678901234567890...',
	);
});

