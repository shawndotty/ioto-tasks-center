import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	parseSections,
	parseChecklistItems,
	parseChecklistItemsInRange,
} = await jiti.import('../src/tasks-center/note-structure.ts');

test('frontmatter 不进 Section，frontmatter 与首标题之间的正文进引导区', () => {
	const content = [
		'---',
		'Project: ["Demo"]',
		'---',
		'',
		'一段引导正文',
		'',
		'# 目标',
		'- 做点什么',
	].join('\n');

	const sections = parseSections(content);
	assert.deepEqual(sections, [
		{ level: 0, title: '', startLine: 4, endLine: 5 },
		{ level: 1, title: '目标', startLine: 6, endLine: 7 },
	]);
});

test('frontmatter 与首标题之间只有空白时不产出引导区', () => {
	const content = ['---', 'Project: ["Demo"]', '---', '', '', '# 目标', ''].join(
		'\n',
	);

	const sections = parseSections(content);
	assert.deepEqual(sections, [
		{ level: 1, title: '目标', startLine: 5, endLine: 6 },
	]);
});

test('围栏代码与注释里的 # 不算 Section', () => {
	const content = [
		'# 真标题',
		'```',
		'# 代码里的井号',
		'```',
		'~~~',
		'# 波浪围栏里的井号',
		'~~~',
		'%%',
		'# Obsidian 注释里的井号',
		'%%',
		'<!--',
		'# HTML 注释里的井号',
		'-->',
		'',
		'## 真子标题',
		'- [ ] 子任务',
	].join('\n');

	const sections = parseSections(content).map((section) => ({
		level: section.level,
		title: section.title,
		startLine: section.startLine,
		endLine: section.endLine,
	}));

	assert.deepEqual(sections, [
		{ level: 1, title: '真标题', startLine: 0, endLine: 15 },
		{ level: 2, title: '真子标题', startLine: 14, endLine: 15 },
	]);
});

test('endLine 精确：下一个 level <= 本级的标题前一行', () => {
	const content = [
		'# 目标',
		'- a',
		'',
		'# 任务',
		'- [ ] 一',
		'- [x] 二',
		'',
		'# 产物汇总',
		'## 成果',
		'- [[链接]]',
		'## 输入',
		'（无）',
	].join('\n');

	const sections = parseSections(content);
	assert.deepEqual(sections, [
		{ level: 1, title: '目标', startLine: 0, endLine: 2 },
		{ level: 1, title: '任务', startLine: 3, endLine: 6 },
		{ level: 1, title: '产物汇总', startLine: 7, endLine: 11 },
		{ level: 2, title: '成果', startLine: 8, endLine: 9 },
		{ level: 2, title: '输入', startLine: 10, endLine: 11 },
	]);
});

test('控制项（含行中 #ioto/*）被剥离进 controls', () => {
	const items = parseChecklistItems(
		'- [ ] 执行落地 #ioto/turns/0\n- [x] 已完成 #ioto/turns/3 后置说明\n',
	);

	assert.equal(items.length, 2);
	assert.equal(items[0].text, '执行落地');
	assert.deepEqual(items[0].controls, [
		{ kind: 'turns', raw: '#ioto/turns/0', value: 0 },
	]);
	// 行中控制项同样被收进 controls（正文接缝收敛为单个空格）
	assert.equal(items[1].text, '已完成 后置说明');
	assert.deepEqual(items[1].controls, [
		{ kind: 'turns', raw: '#ioto/turns/3', value: 3 },
	]);
});

test('缩进层级：每 2 空格或 1 个 Tab 记 1 级', () => {
	const items = parseChecklistItems(
		['- [ ] 顶层', '  - [ ] 二级', '    - [x] 四级', '\t- [ ] Tab 一级'].join(
			'\n',
		),
	);

	assert.deepEqual(
		items.map((item) => item.indentLevel),
		[0, 1, 2, 1],
	);
	assert.deepEqual(
		items.map((item) => item.marker),
		[' ', ' ', 'x', ' '],
	);
});

test('围栏代码里的 checklist 不算任务卡片', () => {
	const items = parseChecklistItems(
		['# T', '```', '- [ ] 代码里的任务', '```', '- [ ] 真任务'].join('\n'),
	);

	assert.deepEqual(
		items.map((item) => ({ line: item.line, text: item.text })),
		[{ line: 4, text: '真任务' }],
	);
});

test('parseChecklistItemsInRange 按行范围取舍，且保留全局行号', () => {
	const content = [
		'# 目标', // 0
		'- [ ] 目标下任务', // 1
		'# 任务', // 2
		'- [ ] 任务一', // 3
		'- [x] 任务二', // 4
		'',
		'## 备注', // 6
		'- [ ] 备注任务', // 7
	].join('\n');

	const inTask = parseChecklistItemsInRange(content, 3, 7);
	assert.deepEqual(
		inTask.map((item) => ({ line: item.line, text: item.text })),
		[
			{ line: 3, text: '任务一' },
			{ line: 4, text: '任务二' },
			{ line: 7, text: '备注任务' },
		],
	);
});

test('空 checklist 行（无正文）不产出条目', () => {
	const items = parseChecklistItems('- [ ]    \n- [ ] 有效\n');
	assert.deepEqual(
		items.map((item) => item.text),
		['有效'],
	);
});
