import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	parseSections,
	parseChecklistItems,
	parseChecklistItemsInRange,
	buildTasksSectionHeading,
	buildTopLevelTaskLine,
	collectTaskContinuations,
	commonIndentPrefix,
	dedentLines,
	findSectionByTitle,
	isTaskContinuationLine,
	sectionHasChecklist,
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

/* ------------------------------------------------------------------ *
 * buildTopLevelTaskLine（[[Plan-20261004-110845]] 批次 D/H）
 * ------------------------------------------------------------------ */

test('buildTopLevelTaskLine：强制 0 级、保留列表符号、不继承控制项', () => {
	// 参照行是深层子任务 → 新行仍为顶层 0 级，正文原样
	assert.equal(
		buildTopLevelTaskLine('    - [x] 深层参照 #ioto/turns/0', '新任务'),
		'- [ ] 新任务',
	);
	// 列表符号跟随参照行（有序列表）
	assert.equal(buildTopLevelTaskLine('  1. [ ] 参照', ''), '1. [ ] ');
	// 勾选态可指定
	assert.equal(buildTopLevelTaskLine('- [ ] 参照', '已完成', 'x'), '- [x] 已完成');
	// 行尾空白（含 CRLF 的 \r）保留
	assert.equal(buildTopLevelTaskLine('- [ ] 参照\r', '新'), '- [ ] 新\r');
});

test('buildTopLevelTaskLine：参照行不是任务行时退回默认 - 列表符号', () => {
	assert.equal(buildTopLevelTaskLine('- ', ''), '- [ ] ');
	assert.equal(buildTopLevelTaskLine('普通行', '新'), '- [ ] 新');
});

/* ------------------------------------------------------------------ *
 * buildTasksSectionHeading（「添加任务」在文末新建 Section）
 * ------------------------------------------------------------------ */

test('buildTasksSectionHeading：补 `# ` 成为一级标题，两侧空白收敛', () => {
	assert.equal(buildTasksSectionHeading('任务'), '# 任务');
	assert.equal(buildTasksSectionHeading(' Tasks '), '# Tasks');
	assert.equal(buildTasksSectionHeading('任務'), '# 任務');
});

test('buildTasksSectionHeading：写出的标题行能被解析成 Section 并被回查命中', () => {
	// 回归：曾只写裸标题 `任务`，产出普通段落 —— 既不成为 Section，
	// 也让下一次「添加任务」找不到段而重复建段。
	const content = [buildTasksSectionHeading('任务'), buildTopLevelTaskLine('- ')].join(
		'\n',
	);

	assert.deepEqual(parseSections(content), [
		{ level: 1, title: '任务', startLine: 0, endLine: 1 },
	]);
	// 语言包存的是裸标题，回查按裸标题匹配 → 必须能命中刚建的那一段
	assert.equal(findSectionByTitle(content, '任务')?.startLine, 0);
	assert.equal(sectionHasChecklist(content, parseSections(content)[0]), true);
});

/* ------------------------------------------------------------------ *
 * 卡片续行（CommonMark lazy continuation）
 *
 * 回归：Markdown View 里在任务项下 Shift+Enter 敲出的正文，曾按普通正文分块，
 * 渲染成 `<ul>` 之外的孤立 div；它应归属上一张卡。
 * ------------------------------------------------------------------ */

test('isTaskContinuationLine：正文/缩进续行算续行，空行与块级结构不算', () => {
	assert.equal(isTaskContinuationLine('一段说明'), true);
	assert.equal(isTaskContinuationLine('  缩进的说明'), true);

	// 另一条任务行（含嵌套）→ 由调用方按行号处理，不算续行
	assert.equal(isTaskContinuationLine('- [ ] 另一条任务'), false);
	assert.equal(isTaskContinuationLine('  - [ ] 嵌套任务'), false);
	// 普通列表项 / 块级结构起始 → 不算续行
	assert.equal(isTaskContinuationLine('- 普通列表项'), false);
	assert.equal(isTaskContinuationLine('1. 有序列表项'), false);
	assert.equal(isTaskContinuationLine('## 嵌套标题'), false);
	assert.equal(isTaskContinuationLine('> 引用'), false);
	assert.equal(isTaskContinuationLine('```js'), false);
	assert.equal(isTaskContinuationLine('~~~'), false);
	assert.equal(isTaskContinuationLine('---'), false);
	assert.equal(isTaskContinuationLine('* * *'), false);
	// 空行终止续行
	assert.equal(isTaskContinuationLine(''), false);
	assert.equal(isTaskContinuationLine('   '), false);
});

test('collectTaskContinuations：续行归属上一张卡，遇空行/块级/下一张卡即止', () => {
	const content = [
		'- [ ] A', // 0
		'续行一', // 1
		'  续行二', // 2
		'- [ ] B', // 3
		'## 备注', // 4
		'- [ ] C', // 5
		'', // 6
		'孤立段落', // 7
	].join('\n');
	const items = parseChecklistItems(content, { includeEmpty: true });
	const map = collectTaskContinuations(content, items, 7);

	assert.deepEqual(map.get(0), [1, 2]);
	// B 紧跟着块级标题 → 无续行（`## 备注` 属于 Section，不该被吸进卡片）
	assert.equal(map.has(3), false);
	// C 之后是空行 → 无续行（CommonMark：空行结束 list item）
	assert.equal(map.has(5), false);
});

test('collectTaskContinuations：收在 limitLine 之内，不越出所属 Section', () => {
	const content = ['- [ ] A', '续行', '再一行'].join('\n');
	const items = parseChecklistItems(content, { includeEmpty: true });

	assert.deepEqual(collectTaskContinuations(content, items, 1).get(0), [1]);
	assert.deepEqual(collectTaskContinuations(content, items, 2).get(0), [1, 2]);
});

/* ------------------------------------------------------------------ *
 * dedentLines（续行渲染前抹掉列表缩进）
 *
 * 回归：续行带着列表自动缩进被**独立**渲染，行首 ≥4 空格被判成缩进代码块
 * （`<pre><code>`），行内 Markdown 格式全部失效还多出复制按钮。
 * ------------------------------------------------------------------ */

test('dedentLines：抹掉公共前导空白，保留相对缩进与行尾空白', () => {
	// 列表缩进整体抹平 → 独立渲染时不再落入缩进代码块
	assert.equal(dedentLines('      说明一\n      说明二'), '说明一\n说明二');
	// 只有非空行参与取公共前缀：空行不会把前缀拉成 ''
	assert.equal(dedentLines('    说明\n\n    继续'), '说明\n\n继续');
	// 相对缩进保留：续行里的嵌套结构不塌
	assert.equal(
		dedentLines('      - 子项\n        - 孙项'),
		'- 子项\n  - 孙项',
	);
	// 行尾空白（Markdown 硬换行语法）不动
	assert.equal(dedentLines('    说明  '), '说明  ');
});

test('dedentLines：无公共前缀 / 纯空白输入时原样返回', () => {
	assert.equal(dedentLines('顶格\n  缩进'), '顶格\n  缩进');
	assert.equal(dedentLines('只有一行无缩进'), '只有一行无缩进');
	assert.equal(dedentLines(''), '');
	assert.equal(dedentLines('   \n  '), '   \n  ');
});

/* ------------------------------------------------------------------ *
 * commonIndentPrefix（dedentLines 的公共内核；续行写回还原前缀复用）
 * ------------------------------------------------------------------ */

test('commonIndentPrefix：多行取最长公共前导空白，空行不参与', () => {
	assert.equal(commonIndentPrefix(['      说明一', '      说明二']), '      ');
	// 空行（trim 为空）不参与，否则前缀会被拉成 ''
	assert.equal(commonIndentPrefix(['    说明', '', '    继续']), '    ');
	// 相对缩进保留：公共前缀只到两行共有的部分
	assert.equal(commonIndentPrefix(['      - 子项', '        - 孙项']), '      ');
});

test('commonIndentPrefix：无公共前缀 / 单行 / 全空行', () => {
	assert.equal(commonIndentPrefix(['顶格', '  缩进']), '');
	assert.equal(commonIndentPrefix(['    单行']), '    ');
	assert.equal(commonIndentPrefix(['', '   ']), '');
	assert.equal(commonIndentPrefix([]), '');
});
