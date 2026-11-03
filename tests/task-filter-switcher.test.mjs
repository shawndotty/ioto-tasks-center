import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 只锁纯文本分歧（[[Plan-20261103-095223]] §四 C1/C8a）：紧凑布局任务筛选切换按钮的
// 「aria 完整句」与「可见文本」两个字段。按钮 DOM 形态、图标尺寸、几何与省略号
// 走真机验收（§七 V1–V8），DOM 形态另有 task-tabs-renderer.test.mjs 的 FakeElement 断言。

// 语言由 t() → getCurrentLang() → window.localStorage.getItem('language') 决定，
// 必须在 import 之前铺好：通用桩只在 window 未定义时才 `window = globalThis`。
globalThis.window = {
	localStorage: {
		getItem: (key) => (key === 'language' ? 'en' : null),
	},
};

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { getTaskFilterSwitcherTexts } = await jiti.import(
	'../src/views/tasks-center/task-search-ops.ts',
);

const TABS = [
	{ key: 'core', label: 'Core' },
	{ key: 'all', label: 'All' },
];

/** 只覆盖用例关心的字段，其余按「核心任务 tab 激活」给默认值。 */
function view(overrides = {}) {
	return {
		activeTaskFilterTab: 'core',
		getVisibleTaskFilterTabs: () => TABS,
		getTaskFilterCounts: () => ({ core: 1, all: 2 }),
		...overrides,
	};
}

test('就绪态：可见文本只有「X（N）」，aria 保留完整句', () => {
	const texts = getTaskFilterSwitcherTexts(view());
	assert.equal(texts.visible, 'Core (1)');
	assert.equal(texts.label, 'Filter: Core (1)');
	assert.ok(!texts.visible.includes('Filter:'));
});

test('计数变化：可见文本与 aria 同步更新', () => {
	const texts = getTaskFilterSwitcherTexts(
		view({ getTaskFilterCounts: () => ({ core: 128, all: 2 }) }),
	);
	assert.equal(texts.visible, 'Core (128)');
	assert.equal(texts.label, 'Filter: Core (128)');
});

test('切换活动 tab：可见文本跟随新 tab 的名字与计数', () => {
	const texts = getTaskFilterSwitcherTexts(
		view({ activeTaskFilterTab: 'all' }),
	);
	assert.equal(texts.visible, 'All (2)');
	assert.equal(texts.label, 'Filter: All (2)');
});

test('退化分支（活动 tab 不在可见集）：可见文本与 aria 同源', () => {
	const texts = getTaskFilterSwitcherTexts(
		view({ activeTaskFilterTab: 'hidden' }),
	);
	assert.equal(texts.visible, texts.label);
	assert.equal(texts.label, 'Filter: Current filter (0)');
});
