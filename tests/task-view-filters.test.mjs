import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// IOTOTask 视图过滤开关的纯逻辑（[[Plan-20261004-110845]] 批次 B/C）。
// 谓词与 Section 命中共用解析层，零 obsidian 依赖，可直接 jiti 导入。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	parseSections,
	parseChecklistItems,
	sectionHasChecklist,
	findSectionByTitle,
	isChecklistItemDone,
} = await jiti.import('../src/tasks-center/note-structure.ts');

const CONTENT = [
	'---', // 0
	'Project: ["Demo"]', // 1
	'---', // 2
	'', // 3
	'一段引导', // 4
	'- [ ] 引导任务', // 5
	'# 目标', // 6
	'纯文字', // 7
	'# 任务', // 8
	'- [ ] 任务一', // 9
	'- [x] 任务二', // 10
	'## 嵌套', // 11
	'- [ ] 嵌套任务', // 12
	'# 空白', // 13
	'说明文字', // 14
].join('\n');

function sectionByStart(content, startLine) {
	const section = parseSections(content).find(
		(item) => item.startLine === startLine,
	);
	assert.ok(section, `expected a section starting at line ${startLine}`);
	return section;
}

test('sectionHasChecklist：引导区含任务判为任务区块', () => {
	assert.equal(sectionHasChecklist(CONTENT, sectionByStart(CONTENT, 4)), true);
});

test('sectionHasChecklist：纯文字 Section 不是任务区块', () => {
	assert.equal(sectionHasChecklist(CONTENT, sectionByStart(CONTENT, 6)), false);
	assert.equal(sectionHasChecklist(CONTENT, sectionByStart(CONTENT, 13)), false);
});

test('sectionHasChecklist：任务只写在嵌套子标题里，父块仍算任务区块', () => {
	// `任务`（8）的 endLine 覆盖到 12（含子标题 11 的任务）
	assert.equal(sectionHasChecklist(CONTENT, sectionByStart(CONTENT, 8)), true);
	assert.equal(sectionHasChecklist(CONTENT, sectionByStart(CONTENT, 11)), true);
});

test('sectionHasChecklist：空骨架任务行也算任务区块（includeEmpty）', () => {
	const content = ['# 任务', '- [ ] '].join('\n');
	assert.equal(sectionHasChecklist(content, sectionByStart(content, 0)), true);
});

test('isChecklistItemDone：x/X 为完成，其余为未完成', () => {
	const items = parseChecklistItems(CONTENT, { includeEmpty: true });
	const byText = new Map(items.map((item) => [item.text, item]));
	assert.equal(isChecklistItemDone(byText.get('任务一')), false);
	assert.equal(isChecklistItemDone(byText.get('任务二')), true);
	assert.equal(isChecklistItemDone({ marker: 'X' }), true);
	assert.equal(isChecklistItemDone({ marker: ' ' }), false);
});

test('findSectionByTitle：语言标题去空白精确匹配、多命中取最靠前', () => {
	const section = findSectionByTitle(CONTENT, '任务');
	assert.deepEqual(section, {
		level: 1,
		title: '任务',
		startLine: 8,
		endLine: 12,
	});

	const twice = ['# 任务', '', '# 任务', '- [ ] a'].join('\n');
	assert.equal(findSectionByTitle(twice, '任务')?.startLine, 0);
});

test('findSectionByTitle：语言隔离 + 引导区不参与匹配', () => {
	// 当前语言是英文时用 `Tasks` 找中文笔记 → 不命中
	assert.equal(findSectionByTitle(CONTENT, 'Tasks'), null);
	// 空标题只属于引导区，永不命中
	assert.equal(findSectionByTitle(CONTENT, ''), null);
});
