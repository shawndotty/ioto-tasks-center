import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	captureProjectCenterScrollPosition,
	restoreProjectCenterScrollPosition,
} = await jiti.import('../src/views/project-center-scroll.ts');

test('未找到项目中心滚动容器时会回退到已有位置', () => {
	assert.deepEqual(captureProjectCenterScrollPosition(null), {
		scrollTop: 0,
		scrollLeft: 0,
	});
	assert.deepEqual(
		captureProjectCenterScrollPosition(
			{
				querySelector: () => null,
			},
			{ scrollTop: 120, scrollLeft: 32 },
		),
		{ scrollTop: 120, scrollLeft: 32 },
	);
});

test('可以从旧项目中心滚动容器中读取 scrollTop/scrollLeft', () => {
	const position = captureProjectCenterScrollPosition({
		querySelector: () => ({
			scrollTop: 340,
			scrollLeft: 48,
		}),
	});

	assert.deepEqual(position, { scrollTop: 340, scrollLeft: 48 });
});

test('当容器不可滚动且位于顶部时，会保留 fallback', () => {
	const position = captureProjectCenterScrollPosition(
		{
			querySelector: () => ({
				scrollTop: 0,
				scrollLeft: 0,
				scrollHeight: 800,
				clientHeight: 800,
			}),
		},
		{ scrollTop: 120, scrollLeft: 32 },
	);

	assert.deepEqual(position, { scrollTop: 120, scrollLeft: 32 });
});

test('可以把缓存位置恢复到新项目中心滚动容器', () => {
	const nextEl = {
		scrollTop: 0,
		scrollLeft: 0,
	};

	restoreProjectCenterScrollPosition(nextEl, { scrollTop: 412, scrollLeft: 96 });

	assert.deepEqual(nextEl, { scrollTop: 412, scrollLeft: 96 });
});

test('传入空元素时恢复函数不会抛错', () => {
	assert.doesNotThrow(() => {
		restoreProjectCenterScrollPosition(null, { scrollTop: 1, scrollLeft: 1 });
	});
});
