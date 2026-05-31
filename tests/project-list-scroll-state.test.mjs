import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	captureProjectListScrollTop,
	restoreProjectListScrollTop,
} = await jiti.import('../src/views/project-list-scroll.ts');

test('未找到项目列表容器时会回退到已有 scrollTop', () => {
	assert.equal(captureProjectListScrollTop(null, 128), 128);
	assert.equal(
		captureProjectListScrollTop(
			{
				querySelector: () => null,
			},
			256,
		),
		256,
	);
});

test('可以从旧项目列表容器中读取 scrollTop', () => {
	const scrollTop = captureProjectListScrollTop({
		querySelector: () => ({
			scrollTop: 340,
		}),
	});

	assert.equal(scrollTop, 340);
});

test('可以把缓存的 scrollTop 恢复到新项目列表容器', () => {
	const nextListEl = {
		scrollTop: 0,
	};

	restoreProjectListScrollTop(nextListEl, 412);

	assert.equal(nextListEl.scrollTop, 412);
});
