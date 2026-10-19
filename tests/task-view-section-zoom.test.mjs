/**
 * 「只看本节」（Section 级布局聚焦）的纯函数层用例
 * （[[Research-20261019-131228]] §4.8）。
 *
 * 只测不触真实 DOM 的两块：
 * 1. 聚焦锚点解析（命中 / 引导区 / 已删除）；
 * 2. 卡片归属判定（决定选中 / 搜索是否需要退出聚焦）。
 *
 * 刻意没测：`enterSectionZoom` / `exitSectionZoom` 这些 DOM + 视图状态编排，
 * 按仓库既定分层约定走真机验证（见 Report）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: { obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname },
});

const {
	readCardSectionStartLine,
	resolveSectionZoomTarget,
} = await jiti.import('../src/views/ioto-task/task-view-section-zoom.ts');

const sections = [
	{ level: 0, title: '', startLine: 0, endLine: 4 },
	{ level: 1, title: 'A', startLine: 5, endLine: 20 },
	{ level: 2, title: 'B', startLine: 21, endLine: 30 },
];

test('resolveSectionZoomTarget：命中真标题块', () => {
	const target = resolveSectionZoomTarget(sections, 5);
	assert.equal(target?.title, 'A');
	assert.equal(target?.level, 1);
});

test('resolveSectionZoomTarget：level 0 引导区不是合法目标', () => {
	assert.equal(resolveSectionZoomTarget(sections, 0), null);
});

test('resolveSectionZoomTarget：startLine 不存在时返回 null（节被删 / 行漂移）', () => {
	assert.equal(resolveSectionZoomTarget(sections, 999), null);
});

test('resolveSectionZoomTarget：行号命中但 level 0（防御脏数据）', () => {
	const dirty = [{ level: 0, title: 'x', startLine: 7, endLine: 9 }];
	assert.equal(resolveSectionZoomTarget(dirty, 7), null);
});

test('readCardSectionStartLine：读最近祖先 Section 的 data-start-line', () => {
	const card = {
		closest: () => ({ dataset: { startLine: '21' } }),
	};
	assert.equal(readCardSectionStartLine(card), 21);
});

test('readCardSectionStartLine：不在 Section 内 / 属性缺失 / 非数字 → null', () => {
	assert.equal(readCardSectionStartLine(null), null);
	assert.equal(readCardSectionStartLine({ closest: () => null }), null);
	assert.equal(readCardSectionStartLine({ closest: () => ({ dataset: {} }) }), null);
	assert.equal(
		readCardSectionStartLine({
			closest: () => ({ dataset: { startLine: 'abc' } }),
		}),
		null,
	);
});
