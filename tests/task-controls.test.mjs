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
	setTaskPin,
	setTaskRepeat,
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

/* ------------------------------------------------------------------ *
 * 6. repeat / lite（无值标签，见 [[Plan-20261022-111723]] S1）
 * ------------------------------------------------------------------ */

test('控制项识别：repeat / lite（无值标签）', () => {
	const item = parseChecklistItems('- [ ] 写日报 #ioto/repeat #ioto/lite')[0];
	assert.deepEqual(item.controls, [
		{ kind: 'repeat', raw: '#ioto/repeat', value: true },
		{ kind: 'lite', raw: '#ioto/lite', value: true },
	]);
	assert.equal(item.text, '写日报');
});

test('防误剥：repeat / lite 的右边界与多余段', () => {
	const plain = parseChecklistItems(
		'- [ ] 正文 #ioto/repeatfoo #ioto/repeat-2 #ioto/litebox',
	)[0];
	assert.deepEqual(plain.controls, []);
	assert.equal(plain.text, '正文 #ioto/repeatfoo #ioto/repeat-2 #ioto/litebox');

	// 多余段整段吞掉，不留 `/x` 在正文里（与设置面板「多余段忽略」同口径）
	const extra = parseChecklistItems('- [ ] 正文 #ioto/lite/x')[0];
	assert.deepEqual(extra.controls, [
		{ kind: 'lite', raw: '#ioto/lite/x', value: true },
	]);
	assert.equal(extra.text, '正文');
});

test('repeat / lite 的往返与写回', () => {
	const line = '- [ ] 写日报 #ioto/repeat #ioto/lite';
	assert.equal(composeTaskLine(splitTaskLine(line)), line);
	assert.equal(
		replaceTaskBody('- [ ] 旧 #ioto/repeat', '新'),
		'- [ ] 新 #ioto/repeat',
	);
	assert.equal(taskBodyForEditor(line), '写日报');
});

/* ------------------------------------------------------------------ *
 * 7. pin（纯视图语义，见 [[Plan-20261022-200135]] S1 / S4）
 * ------------------------------------------------------------------ */

test('控制项识别：pin 从正文剥离，raw / value 正确', () => {
	const item = parseChecklistItems('- [ ] 常驻任务 #ioto/pin')[0];
	assert.deepEqual(item.controls, [
		{ kind: 'pin', raw: '#ioto/pin', value: true },
	]);
	assert.equal(item.text, '常驻任务');
});

test('防误剥：pin 的右边界（pinbox / pin-2 不算 pin）', () => {
	const plain = parseChecklistItems(
		'- [ ] 正文 #ioto/pinbox #ioto/pin-2',
	)[0];
	assert.deepEqual(plain.controls, []);
	assert.equal(plain.text, '正文 #ioto/pinbox #ioto/pin-2');
});

test('pin 多余段整段吞掉，不留 /x 在正文里', () => {
	const extra = parseChecklistItems('- [ ] 正文 #ioto/pin/x')[0];
	assert.deepEqual(extra.controls, [
		{ kind: 'pin', raw: '#ioto/pin/x', value: true },
	]);
	assert.equal(extra.text, '正文');
});

test('setTaskPin：加 pin 追加到行尾', () => {
	assert.equal(
		setTaskPin('- [ ] 常驻任务', true),
		'- [ ] 常驻任务 #ioto/pin',
	);
	// 与其它控制项共存：pin 追加在最后（不在中间插队）
	assert.equal(
		setTaskPin('- [ ] 常驻 #ioto/turns/120', true),
		'- [ ] 常驻 #ioto/turns/120 #ioto/pin',
	);
});

test('setTaskPin：已 pin 再加逐字节返回原行（幂等）', () => {
	const line = '- [ ] 常驻 #ioto/pin';
	assert.equal(setTaskPin(line, true), line);
});

test('setTaskPin：去 pin 不留空白与双空格', () => {
	// 行尾
	assert.equal(setTaskPin('- [ ] 常驻 #ioto/pin', false), '- [ ] 常驻');
	// 行中：剥离点两侧空白收敛为单空格
	assert.equal(
		setTaskPin('- [ ] 常驻 #ioto/pin 说明', false),
		'- [ ] 常驻 说明',
	);
	// 行首（紧跟 gap 之后）
	assert.equal(
		setTaskPin('- [ ] #ioto/pin 常驻', false),
		'- [ ] 常驻',
	);
});

test('setTaskPin：未 pin 时再去，返回原行', () => {
	const line = '- [ ] 普通任务 #ioto/turns/5';
	assert.equal(setTaskPin(line, false), line);
});

test('setTaskPin：非任务行返回 null', () => {
	assert.equal(setTaskPin('普通段落 #ioto/pin', false), null);
	assert.equal(setTaskPin('', true), null);
});

test('setTaskPin：保留 Tab 缩进与行尾 \\r', () => {
	assert.equal(
		setTaskPin('\t- [ ] 子任务 #ioto/pin\r', false),
		'\t- [ ] 子任务\r',
	);
	assert.equal(
		setTaskPin('\t- [ ] 子任务\r', true),
		'\t- [ ] 子任务 #ioto/pin\r',
	);
});

/* ------------------------------------------------------------------ *
 * setTaskRepeat（[[Plan-20261023-104335]] §4.10）
 * 与 setTaskPin 逐条对称：repeat 的右边界解析（repeatfoo / repeat-2 不算）
 * 已在 §1 覆盖，这里只测写回。
 * ------------------------------------------------------------------ */

test('setTaskRepeat：加 repeat 追加到行尾', () => {
	assert.equal(
		setTaskRepeat('- [ ] 每日站会', true),
		'- [ ] 每日站会 #ioto/repeat',
	);
	// 与其它控制项共存：repeat 追加在最后（不在中间插队）
	assert.equal(
		setTaskRepeat('- [ ] 每日站会 #ioto/pin', true),
		'- [ ] 每日站会 #ioto/pin #ioto/repeat',
	);
});

test('setTaskRepeat：已 repeat 再加逐字节返回原行（幂等）', () => {
	const line = '- [ ] 每日站会 #ioto/repeat';
	assert.equal(setTaskRepeat(line, true), line);
});

test('setTaskRepeat：去 repeat 不留空白与双空格', () => {
	// 行尾
	assert.equal(
		setTaskRepeat('- [ ] 每日站会 #ioto/repeat', false),
		'- [ ] 每日站会',
	);
	// 行中：剥离点两侧空白收敛为单空格
	assert.equal(
		setTaskRepeat('- [ ] 每日站会 #ioto/repeat 说明', false),
		'- [ ] 每日站会 说明',
	);
	// 行首（紧跟 gap 之后）
	assert.equal(
		setTaskRepeat('- [ ] #ioto/repeat 每日站会', false),
		'- [ ] 每日站会',
	);
});

test('setTaskRepeat：未 repeat 时再去，返回原行', () => {
	const line = '- [ ] 普通任务 #ioto/turns/5';
	assert.equal(setTaskRepeat(line, false), line);
});

test('setTaskRepeat：非任务行返回 null', () => {
	assert.equal(setTaskRepeat('普通段落 #ioto/repeat', false), null);
	assert.equal(setTaskRepeat('', true), null);
});

test('setTaskRepeat：保留 Tab 缩进与行尾 \\r', () => {
	assert.equal(
		setTaskRepeat('\t- [ ] 子任务 #ioto/repeat\r', false),
		'\t- [ ] 子任务\r',
	);
	assert.equal(
		setTaskRepeat('\t- [ ] 子任务\r', true),
		'\t- [ ] 子任务 #ioto/repeat\r',
	);
});
