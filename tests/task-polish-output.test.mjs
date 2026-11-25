import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { sanitizePolishedText, validatePolishedText } = await jiti.import(
	'../src/views/ioto-task/task-polish-output.ts',
);

test('剥离外层代码围栏', () => {
	const result = sanitizePolishedText('```text\n整理会议要点\n```');
	assert.equal(result.text, '整理会议要点');
	assert.equal(result.flags.fenceStripped, true);
});

test('剥离首行前缀与成对引号', () => {
	const result = sanitizePolishedText('润色后：“整理会议要点”');
	assert.equal(result.text, '整理会议要点');
	assert.equal(result.flags.prefixStripped, true);
	assert.equal(result.flags.quotesStripped, true);
});

test('移除模型注入的控制语法', () => {
	const result = sanitizePolishedText(
		'整理要点 <!-- note --> #ioto/lite [model:: gpt]',
	);
	assert.equal(result.text, '整理要点');
	assert.equal(result.flags.controlsRemoved, true);
});

test('移除模型自造的交付物标记', () => {
	const result = sanitizePolishedText('整理要点 @[[4-成果/伪造]]');
	assert.equal(result.text, '整理要点');
	assert.equal(result.flags.hallucinatedDeliverablesRemoved, true);
});

test('物理换行折成 <br>', () => {
	const result = sanitizePolishedText('第一段\n第二段\n\n第三段');
	assert.equal(result.text, '第一段<br>第二段<br>第三段');
	assert.equal(result.flags.lineBreaksConverted, true);
});

test('链接集合相等 → ok', () => {
	const validation = validatePolishedText({
		originalProse: '参考 [[笔记A]] 写总结',
		cleaned: '参考 [[笔记A]] 写一份总结',
	});
	assert.equal(validation.ok, true);
});

test('多出链接 → links-changed', () => {
	const validation = validatePolishedText({
		originalProse: '参考 [[笔记A]] 写总结',
		cleaned: '参考 [[笔记A]] 与 [[笔记B]] 写总结',
	});
	assert.deepEqual(validation, {
		ok: false,
		text: '参考 [[笔记A]] 与 [[笔记B]] 写总结',
		reasons: ['links-changed'],
	});
});

test('缺失链接 → links-changed', () => {
	const validation = validatePolishedText({
		originalProse: '参考 [[笔记A]] 写总结',
		cleaned: '参考写总结',
	});
	assert.deepEqual(validation.reasons, ['links-changed']);
});

test('500 字边界：500 通过、501 拒绝', () => {
	const original = '原';
	const atLimit = '好'.repeat(500);
	assert.equal(
		validatePolishedText({ originalProse: original, cleaned: atLimit }).ok,
		true,
	);
	const overLimit = '好'.repeat(501);
	assert.deepEqual(
		validatePolishedText({ originalProse: original, cleaned: overLimit })
			.reasons,
		['too-long'],
	);
});

test('与原文相同 → unchanged', () => {
	const validation = validatePolishedText({
		originalProse: '同样的描述',
		cleaned: '同样的描述',
	});
	assert.deepEqual(validation.reasons, ['unchanged']);
});

test('清洗后为空 → empty', () => {
	for (const cleaned of ['', '   ', '\n\t ']) {
		const validation = validatePolishedText({
			originalProse: '原描述',
			cleaned: sanitizePolishedText(cleaned).text,
		});
		assert.deepEqual(validation.reasons, ['empty']);
	}
});