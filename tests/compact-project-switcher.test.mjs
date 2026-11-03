import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 只锁纯文本分歧（[[Plan-20261103-093127]] §三 C1/C4）：紧凑布局项目切换按钮的
// 「aria 完整句」与「可见文本」两个字段。按钮 DOM 形态、图标尺寸、几何与省略号
// 走真机验收（§六 V1–V8），不在单测里造假 DOM。

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

const { getProjectSwitcherTexts } = await jiti.import(
	'../src/views/tasks-center/compact-layout.ts',
);

/** 只覆盖用例关心的字段，其余按「已就绪」给默认值。 */
function view(overrides = {}) {
	return {
		isProjectsLoading: false,
		isTasksLoading: false,
		selectedProject: 'Project A',
		...overrides,
	};
}

test('就绪态：可见文本只有项目名，aria 保留完整句', () => {
	const texts = getProjectSwitcherTexts(view());
	assert.equal(texts.visible, 'Project A');
	assert.equal(texts.label, 'Current project: Project A');
});

test('项目加载中：可见文本与 aria 同源', () => {
	const texts = getProjectSwitcherTexts(view({ isProjectsLoading: true }));
	assert.equal(texts.visible, 'Loading projects...');
	assert.equal(texts.visible, texts.label);
});

test('任务加载中：可见文本与 aria 同源', () => {
	const texts = getProjectSwitcherTexts(view({ isTasksLoading: true }));
	assert.equal(texts.visible, 'Loading tasks...');
	assert.equal(texts.visible, texts.label);
});

test('未选项目：可见文本与 aria 同源', () => {
	const texts = getProjectSwitcherTexts(view({ selectedProject: null }));
	assert.equal(texts.visible, 'Switch project');
	assert.equal(texts.visible, texts.label);
});
