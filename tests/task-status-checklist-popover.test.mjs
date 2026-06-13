import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { truncateChecklistPreview } = await jiti.import(
	'../src/ui/task-status-checklist-popover.ts',
);

test('默认阈值下较短的中文和英文 checklist 预览不截断', () => {
	assert.equal(truncateChecklistPreview('短任务'), '短任务');
	assert.equal(
		truncateChecklistPreview('1234567890123456789012345678901234567890'),
		'1234567890123456789012345678901234567890',
	);
});

test('超过默认显示宽度的中文 checklist 预览会截断并追加省略号', () => {
	assert.equal(
		truncateChecklistPreview('这是一个用于验证中文截断长度是否符合预期的待办事项内容'),
		'这是一个用于验证中文截断长度是否符合...'
	);
});

test('超过默认显示宽度的英文 checklist 预览会比中文保留更多字符', () => {
	assert.equal(
		truncateChecklistPreview(
			'This is a checklist item used to verify longer preview text for English content.',
		),
		'This is a checklist item used to veri...',
	);
});

test('中英混排 checklist 预览会按显示宽度截断', () => {
	assert.equal(
		truncateChecklistPreview(
			'任务描述 mixed with English words for preview balance',
		),
		'任务描述 mixed with English words for...',
	);
});
