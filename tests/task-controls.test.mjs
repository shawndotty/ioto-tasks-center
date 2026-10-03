import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	parseChecklistItems,
	splitTaskLine,
	composeTaskLine,
	replaceTaskBody,
	taskBodyForEditor,
	buildSiblingTaskLine,
} = await jiti.import('../src/tasks-center/note-structure.ts');

/* ------------------------------------------------------------------ *
 * 1. 控制项识别（[[Plan-20261003-162429]] §3.2 / §7.1.1）
 * ------------------------------------------------------------------ */

test('控制项识别：depends（笔记 / 序号）', () => {
	const note = parseChecklistItems('- [ ] 正文 depends：[[A]]')[0];
	assert.deepEqual(note.controls, [
		{ kind: 'depends', raw: 'depends：[[A]]', value: ['A'] },
	]);
	assert.equal(note.text, '正文');

	const noteEn = parseChecklistItems('- [ ] 正文 depends: [[A]]')[0];
	assert.deepEqual(noteEn.controls, [
		{ kind: 'depends', raw: 'depends: [[A]]', value: ['A'] },
	]);

	const multi = parseChecklistItems(
		'- [ ] 正文 depends: [[A]]、[[B]]',
	)[0];
	assert.deepEqual(multi.controls, [
		{ kind: 'depends', raw: 'depends: [[A]]、[[B]]', value: ['A', 'B'] },
	]);

	const comma = parseChecklistItems('- [ ] 正文 depends: [[A]], [[B]]')[0];
	assert.deepEqual(comma.controls[0].value, ['A', 'B']);

	const index = parseChecklistItems('- [ ] 正文 #ioto/depends/2')[0];
	assert.deepEqual(index.controls, [
		{ kind: 'depends', raw: '#ioto/depends/2', value: 2 },
	]);
});

test('控制项识别：agent / model（两种写法）/ fanout / turns', () => {
	const agent = parseChecklistItems('- [ ] 正文 #ioto/agent/claude')[0];
	assert.deepEqual(agent.controls, [
		{ kind: 'agent', raw: '#ioto/agent/claude', value: 'claude' },
	]);

	const modelInline = parseChecklistItems(
		'- [ ] 正文 [model:: gpt-4.1]',
	)[0];
	assert.deepEqual(modelInline.controls, [
		{ kind: 'model', raw: '[model:: gpt-4.1]', value: 'gpt-4.1' },
	]);

	const modelTag = parseChecklistItems('- [ ] 正文 #ioto/model/opus')[0];
	assert.deepEqual(modelTag.controls, [
		{ kind: 'model', raw: '#ioto/model/opus', value: 'opus' },
	]);

	const fanout = parseChecklistItems('- [ ] 正文 #ioto/fanout')[0];
	assert.deepEqual(fanout.controls, [
		{ kind: 'fanout', raw: '#ioto/fanout', value: true },
	]);

	const fanoutN = parseChecklistItems('- [ ] 正文 #ioto/fanout/4')[0];
	assert.deepEqual(fanoutN.controls, [
		{ kind: 'fanout', raw: '#ioto/fanout/4', value: 4 },
	]);

	const turns = parseChecklistItems('- [ ] 正文 #ioto/turns/120')[0];
	assert.deepEqual(turns.controls, [
		{ kind: 'turns', raw: '#ioto/turns/120', value: 120 },
	]);

	const turnsZero = parseChecklistItems('- [ ] 正文 #ioto/turns/0')[0];
	assert.deepEqual(turnsZero.controls, [
		{ kind: 'turns', raw: '#ioto/turns/0', value: 0 },
	]);
});

test('同一行两种 model 写法并存：都保留（写回不丢）', () => {
	const item = parseChecklistItems(
		'- [ ] 正文 [model:: hy3] #ioto/model/opus',
	)[0];
	assert.deepEqual(item.controls, [
		{ kind: 'model', raw: '[model:: hy3]', value: 'hy3' },
		{ kind: 'model', raw: '#ioto/model/opus', value: 'opus' },
	]);
	assert.equal(item.text, '正文');
});

/* ------------------------------------------------------------------ *
 * 2. 防误剥（[[Plan-20261003-162429]] §2.1 / §7.1.2）
 * ------------------------------------------------------------------ */

test('连续控制项：接缝空白收敛为单个空格', () => {
	const item = parseChecklistItems(
		'- [ ] 纯正文 #ioto/agent/claude #ioto/turns/120 #ioto/fanout/4 #商业模式',
	)[0];
	assert.equal(item.text, '纯正文 #商业模式');
	assert.equal(item.controls.length, 3);
});

test('防误剥：非 ioto 标签 / 无斜杠 #ioto / 交付物 都留在正文', () => {
	const raw = '- [ ] 正文 #foo/bar #2026/10/03 #ioto #商业模式 @[[交付物]]';
	const item = parseChecklistItems(raw)[0];

	assert.deepEqual(item.controls, []);
	assert.equal(item.text, '正文 #foo/bar #2026/10/03 #ioto #商业模式 @[[交付物]]');
});

test('防误剥：含 depends 字样但无 wikilink 的普通句子不动', () => {
	const item = parseChecklistItems('- [ ] 这段 explains depends 的用法')[0];
	assert.deepEqual(item.controls, []);
	assert.equal(item.text, '这段 explains depends 的用法');
});

/* ------------------------------------------------------------------ *
 * 3. 无损往返（[[Plan-20261003-162429]] §3.4 / §7.1.3）
 * ------------------------------------------------------------------ */

test('split→compose 往返：行中 + 行尾混合控制项逐字节还原', () => {
	const lines = [
		'- [ ] 任务 depends：[[A]]、[[B]] [model:: hy3] #商业模式 #ioto/turns/120 #ioto/fanout/4',
		'- [x] 任务二 #ioto/agent/claude #ioto/depends/3',
		'  1. [ ] 行中 #ioto/turns/5 夹在正文里 #ioto/fanout',
		'- [ ] [model:: gpt-4.1] #ioto/model/opus',
	];

	for (const line of lines) {
		const parts = splitTaskLine(line);
		assert.ok(parts, `splitTaskLine 应当命中：${line}`);
		assert.equal(composeTaskLine(parts), line, `往返失败：${line}`);
	}
});

test('未改动正文时 replaceTaskBody 逐字节还原（含行中控制项）', () => {
	const line = '- [ ] 正文 #ioto/turns/5 后置说明 depends：[[A]]';
	// 传入的正文 === 该行展示正文 → 走还原通道，行内控制项位置不变
	assert.equal(replaceTaskBody(line, '正文 后置说明'), line);
	assert.equal(replaceTaskBody(line, ' 正文 后置说明 '), line);
});

/* ------------------------------------------------------------------ *
 * 4. 写回不丢 / 幂等（[[Plan-20261003-162429]] §7.1.4）
 * ------------------------------------------------------------------ */

test('replaceTaskBody 改正文：控制项集合与顺序不变，尾置', () => {
	const line = '- [ ] 旧正文 depends：[[A]] [model:: m] #ioto/turns/5';
	const next = replaceTaskBody(line, '新正文');
	assert.equal(next, '- [ ] 新正文 depends：[[A]] [model:: m] #ioto/turns/5');

	// 幂等：对规范化结果再 compose 仍是它自己
	const parts = splitTaskLine(next);
	assert.ok(parts);
	assert.equal(composeTaskLine(parts), next);
});

test('replaceTaskBody 行中控制项：改动正文后按原序归位到行尾', () => {
	const line = '- [ ] 旧 #ioto/turns/3 中间说明 #ioto/fanout/2';
	assert.equal(
		replaceTaskBody(line, '新'),
		'- [ ] 新 #ioto/turns/3 #ioto/fanout/2',
	);
});

/* ------------------------------------------------------------------ *
 * 5. taskBodyForEditor / buildSiblingTaskLine（[[Plan-20261003-162429]] §7.1.5-6）
 * ------------------------------------------------------------------ */

test('taskBodyForEditor：剥离本行所有控制项', () => {
	assert.equal(
		taskBodyForEditor(
			'- [ ] 正文 depends：[[B]] [model:: m] #ioto/turns/5',
		),
		'正文',
	);
	assert.equal(
		taskBodyForEditor('- [ ] 正文 #ioto/agent/claude #ioto/fanout/2'),
		'正文',
	);
	assert.equal(taskBodyForEditor('非任务行'), null);
});

test('buildSiblingTaskLine：新行无 controls，逐字节正确', () => {
	assert.equal(
		buildSiblingTaskLine('- [x] 参考 depends：[[A]] #ioto/turns/0', '新'),
		'- [ ] 新',
	);
	const parts = splitTaskLine(
		buildSiblingTaskLine('- [x] 参考 #ioto/fanout/2', '') ?? '',
	);
	assert.ok(parts);
	assert.deepEqual(parts.controls, []);
	assert.equal(parts.source, '');
	assert.equal(parts.sourceText, '');
});
