import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { captureTaskListScrollTop, restoreTaskListScrollTop } =
	await jiti.import('../src/views/task-list-scroll.ts');

test('未找到任务列表容器时会回退到已有 scrollTop', () => {
	assert.equal(captureTaskListScrollTop(null, 128), 128);
	assert.equal(
		captureTaskListScrollTop(
			{
				querySelector: () => null,
			},
			256,
		),
		256,
	);
});

test('可以从旧任务列表容器中读取 scrollTop', () => {
	const scrollTop = captureTaskListScrollTop({
		querySelector: () => ({
			scrollTop: 340,
		}),
	});

	assert.equal(scrollTop, 340);
});

test('可以把缓存的 scrollTop 恢复到新任务列表容器', () => {
	const nextListEl = {
		scrollTop: 0,
	};

	restoreTaskListScrollTop(nextListEl, 412);

	assert.equal(nextListEl.scrollTop, 412);
});

