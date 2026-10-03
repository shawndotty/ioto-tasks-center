import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	splitTaskLine,
	composeTaskLine,
	replaceTaskBody,
	taskBodyForEditor,
	toggleTaskMarker,
	setTaskIndent,
	buildSiblingTaskLine,
	indentLevelOf,
	parseChecklistItems,
} = await jiti.import('../src/tasks-center/note-structure.ts');

test('split(compose) 往返：各种列表符号 / 缩进 / 勾选态 / 行尾标签', () => {
	const lines = [
		'- [ ] 一',
		'* [x] 二',
		'+ [X] 三',
		'1. [ ] 四',
		'\t- [ ] Tab 缩进',
		'  - [ ] 两空格缩进',
		'    - [x] 四级缩进',
		'- [ ] 带标签 #ioto/turns/0',
		'- [x] 多标签 #ioto/turns/3 #ioto/foo',
		'- [ ] 行中 depends：[[A]] [model:: m] 夹在正文 #ioto/fanout/2',
	];

	for (const line of lines) {
		const parts = splitTaskLine(line);
		assert.ok(parts, `splitTaskLine 应当命中：${line}`);
		assert.equal(composeTaskLine(parts), line, `往返失败：${line}`);
	}
});

test('splitTaskLine 拆段正确', () => {
	assert.deepEqual(splitTaskLine('\t1. [X] 正文 #ioto/turns/1'), {
		indent: '\t',
		listMarker: '1. ',
		checked: 'X',
		gap: ' ',
		body: '正文',
		controls: [{ kind: 'turns', raw: '#ioto/turns/1', value: 1 }],
		source: '正文 #ioto/turns/1',
		sourceText: '正文',
		trail: '',
	});

	assert.equal(splitTaskLine('- 不是任务行'), null);
	assert.equal(splitTaskLine('普通正文'), null);
});

test('replaceTaskBody 只换正文，前缀 / 勾选 / 标签 / 行尾空白原样保留', () => {
	assert.equal(
		replaceTaskBody('- [x] 旧文字 #ioto/turns/0', '新文字'),
		'- [x] 新文字 #ioto/turns/0',
	);
	assert.equal(
		replaceTaskBody('\t1. [X] 旧 #ioto/turns/1', '新'),
		'\t1. [X] 新 #ioto/turns/1',
	);
	// 行尾空白（含 CRLF 的 \r）保留
	assert.equal(replaceTaskBody('- [ ] 旧\r', '新'), '- [ ] 新\r');
	// 正文两侧空白被 trim
	assert.equal(replaceTaskBody('- [ ] 旧', '  新  '), '- [ ] 新');
});

test('replaceTaskBody 拒绝多行正文 / 非任务行', () => {
	assert.equal(replaceTaskBody('- [ ] 旧', '第一行\n第二行'), null);
	assert.equal(replaceTaskBody('不是任务行', '新'), null);
});

test('taskBodyForEditor：剥离本行所有控制项（Plan-20261003-162429）', () => {
	// 面板写回的新行 → 编辑器应持有的正文（控制项全部收窄）
	assert.equal(
		taskBodyForEditor(
			'- [ ] 正文 depends：[[B]] [model:: m] #ioto/turns/5',
		),
		'正文',
	);
	// 只有行尾 #ioto/* 时，正文不变
	assert.equal(
		taskBodyForEditor('- [ ] 正文 #ioto/turns/5'),
		'正文',
	);
	// 非任务行 → null（调用方据此跳过 re-seed，绝不清空编辑器）
	assert.equal(taskBodyForEditor('非任务行'), null);
	assert.equal(taskBodyForEditor(''), null);
});

test('toggleTaskMarker：空格 ↔ x，X → 空格，其余字节不动', () => {
	assert.equal(toggleTaskMarker('- [ ] a'), '- [x] a');
	assert.equal(toggleTaskMarker('- [x] a'), '- [ ] a');
	assert.equal(toggleTaskMarker('- [X] a'), '- [ ] a');
	assert.equal(
		toggleTaskMarker('\t1. [X] 任务 #ioto/turns/1'),
		'\t1. [ ] 任务 #ioto/turns/1',
	);
	assert.equal(toggleTaskMarker('普通行'), null);
});

test('setTaskIndent：±1 级、clamp、与解析层口径一致（Tab 会规整成 2 空格）', () => {
	assert.equal(setTaskIndent('- [ ] a', 1), '  - [ ] a');
	assert.equal(setTaskIndent('  - [ ] a', 1), '    - [ ] a');
	assert.equal(setTaskIndent('  - [ ] a', -1), '- [ ] a');
	assert.equal(setTaskIndent('- [ ] a', -1), '- [ ] a');
	assert.equal(setTaskIndent('    - [ ] a', -1), '  - [ ] a');
	// Tab 记为 1 级（= 2 空格宽）：+1 后规整为 4 空格；-1 回到 0
	assert.equal(setTaskIndent('\t- [ ] a', 1), '    - [ ] a');
	assert.equal(setTaskIndent('\t- [ ] a', -1), '- [ ] a');
	// maxLevel clamp
	assert.equal(setTaskIndent('  - [ ] a', 1, 1), '  - [ ] a');
	// 保留正文 / 勾选 / 标签
	assert.equal(
		setTaskIndent('- [x] 正文 #ioto/turns/2', 1),
		'  - [x] 正文 #ioto/turns/2',
	);
	assert.equal(setTaskIndent('普通行', 1), null);
});

test('buildSiblingTaskLine：同 indent / 同列表符号 / 未勾选 / 不继承标签', () => {
	assert.equal(buildSiblingTaskLine('- [x] 参考', '新任务'), '- [ ] 新任务');
	assert.equal(buildSiblingTaskLine('  - [x] 参考 #ioto/turns/0', '新'), '  - [ ] 新');
	assert.equal(buildSiblingTaskLine('1. [x] 参考', ''), '1. [ ] ');
	assert.equal(buildSiblingTaskLine('- [ ] 参考', '已完成', 'x'), '- [x] 已完成');
	// CRLF 行的 trail 继承，插入的新行不会把文件 EOL 弄混
	assert.equal(buildSiblingTaskLine('- [ ] 参考\r', '新'), '- [ ] 新\r');
	assert.equal(buildSiblingTaskLine('普通行', '新'), null);
});

test('indentLevelOf 与解析层 indentLevel 口径一致', () => {
	const lines = [
		'- [ ] 顶层',
		'  - [ ] 二级',
		'    - [x] 四级',
		'\t- [ ] Tab 一级',
	];
	const items = parseChecklistItems(lines.join('\n'));
	items.forEach((item, index) => {
		const parts = splitTaskLine(lines[index]);
		assert.ok(parts);
		assert.equal(indentLevelOf(parts.indent), item.indentLevel);
	});
});
