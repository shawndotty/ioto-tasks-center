import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	IOTO_TASKS_CENTER_TASK_HOVER_SOURCE_ID,
	buildTaskHoverPreviewPayload,
	hasActiveTaskHoverPopover,
	shouldTriggerTaskHoverPreview,
} = await jiti.import('../src/views/task-hover-preview.ts');

test('构建 hover-link payload 时会带上任务路径、来源和目标元素', () => {
	const event = { type: 'mouseover', relatedTarget: null };
	const rowEl = {
		dataset: { taskPath: '3-任务/项目A/任务1.md' },
		contains: () => false,
	};
	const hoverParent = { hoverPopover: null };

	const payload = buildTaskHoverPreviewPayload({
		event,
		rowEl,
		taskPath: '3-任务/项目A/任务1.md',
		hoverParent,
	});

	assert.equal(payload.event, event);
	assert.equal(payload.source, IOTO_TASKS_CENTER_TASK_HOVER_SOURCE_ID);
	assert.equal(payload.targetEl, rowEl);
	assert.equal(payload.linktext, '3-任务/项目A/任务1.md');
	assert.equal(payload.sourcePath, '3-任务/项目A/任务1.md');
	assert.equal(payload.hoverParent, hoverParent);
});

test('鼠标仅在任务行内部子元素之间移动时，不重复触发 hover 预览', () => {
	const childEl = { nodeType: 1 };
	const rowEl = {
		contains: (target) => target === childEl,
	};

	const result = shouldTriggerTaskHoverPreview(
		{ relatedTarget: childEl },
		rowEl,
	);

	assert.equal(result, false);
});

test('鼠标从任务行外部进入时，会触发 hover 预览', () => {
	const rowEl = {
		contains: () => false,
	};

	const result = shouldTriggerTaskHoverPreview(
		{ relatedTarget: { nodeType: 1 } },
		rowEl,
	);

	assert.equal(result, true);
});

test('当 hover popover 仍挂载在 DOM 上时，应视为活跃状态', () => {
	const result = hasActiveTaskHoverPopover({
		hoverPopover: {
			hoverEl: {
				isConnected: true,
			},
		},
	});

	assert.equal(result, true);
});

test('当 hover popover 已卸载时，不应继续延迟刷新', () => {
	const result = hasActiveTaskHoverPopover({
		hoverPopover: {
			hoverEl: {
				isConnected: false,
			},
		},
	});

	assert.equal(result, false);
});
