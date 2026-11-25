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
	assert.equal(result.deliverables, null);
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

test('物理换行折成 <br>', () => {
	const result = sanitizePolishedText('第一段\n第二段\n\n第三段');
	assert.equal(result.text, '第一段<br>第二段<br>第三段');
	assert.equal(result.flags.lineBreaksConverted, true);
});

test('纯清洗（不传 originalBody）时交付物标记保留', () => {
	const result = sanitizePolishedText('整理要点 @[[4-成果/A]]');
	assert.equal(result.text, '整理要点 @[[4-成果/A]]');
	assert.equal(result.deliverables, null);
	assert.equal(result.flags.hallucinatedDeliverablesRemoved, false);
});

test('移除模型新增的交付物标记（原文没有）', () => {
	const result = sanitizePolishedText('整理要点 @[[4-成果/伪造]]', {
		originalBody: '整理要点',
	});
	assert.equal(result.text, '整理要点');
	assert.equal(result.flags.hallucinatedDeliverablesRemoved, true);
	assert.deepEqual(result.deliverables.removedInvented, [
		'@[[4-成果/伪造]]',
	]);
});

test('句中白名单交付物原位保留', () => {
	const body = '把结论写入@[[4-成果/R-1]]。';
	const result = sanitizePolishedText(body, { originalBody: body });
	assert.equal(result.text, body);
	assert.equal(result.flags.hallucinatedDeliverablesRemoved, false);
	assert.deepEqual(result.deliverables.removedInvented, []);
	assert.deepEqual(result.deliverables.restoredMissing, []);
	assert.deepEqual(result.deliverables.repairedMarker, []);
});

test('行尾白名单交付物保留（原「预览缺失」形态）', () => {
	const body = '输出一份周报 @[[4-成果/R-1]]';
	const result = sanitizePolishedText(body, { originalBody: body });
	assert.equal(result.text, body);
	assert.equal(result.flags.hallucinatedDeliverablesRemoved, false);
});

test('模型漏写交付物 → 句尾补回', () => {
	const result = sanitizePolishedText('整理好要点', {
		originalBody: '整理要点 @[[4-成果/A]]',
	});
	assert.equal(result.text, '整理好要点 @[[4-成果/A]]');
	assert.deepEqual(result.deliverables.restoredMissing, ['@[[4-成果/A]]']);
	assert.deepEqual(result.deliverables.repairedMarker, []);
});

test('模型写成普通链接 → 就地补回 @', () => {
	const result = sanitizePolishedText('输出一份 [[4-成果/A]]', {
		originalBody: '输出 @[[4-成果/A]]',
	});
	assert.equal(result.text, '输出一份 @[[4-成果/A]]');
	assert.deepEqual(result.deliverables.repairedMarker, ['@[[4-成果/A]]']);
	assert.deepEqual(result.deliverables.restoredMissing, []);
});

test('原文同时有普通链接与 @ 形态时不误改，追加到句尾', () => {
	const result = sanitizePolishedText('参考 [[4-成果/A]] 与 写总结', {
		originalBody: '参考 [[4-成果/A]] 与 @[[4-成果/A]] 写总结',
	});
	assert.equal(result.text, '参考 [[4-成果/A]] 与 写总结 @[[4-成果/A]]');
	assert.deepEqual(result.deliverables.repairedMarker, []);
	assert.deepEqual(result.deliverables.restoredMissing, ['@[[4-成果/A]]']);
});

test('模型重复输出同一交付物 → 静默去重', () => {
	const result = sanitizePolishedText('输出 @[[4-成果/A]] 和 @[[4-成果/A]] 完成', {
		originalBody: '输出 @[[4-成果/A]] 完成',
	});
	assert.equal(result.text, '输出 @[[4-成果/A]] 和 完成');
	assert.deepEqual(result.deliverables.removedInvented, []);
	assert.equal(result.flags.hallucinatedDeliverablesRemoved, false);
});

test('别名保真：逐字节保留', () => {
	const body = '输出 @[[4-成果/A|甲]]';
	const result = sanitizePolishedText(`${body} 完成`, { originalBody: body });
	assert.ok(result.text.includes('@[[4-成果/A|甲]]'));
});

test('500 字口径排除交付物 token → ok', () => {
	const token = '@[[4-成果/很长的交付物名称用于测试]]';
	const cleaned = `${'正'.repeat(500)}${token}`;
	const validation = validatePolishedText({
		originalBody: `原${token}`,
		cleaned,
	});
	assert.equal(validation.ok, true);
});

test('纯正文 501 字 → too-long', () => {
	const validation = validatePolishedText({
		originalBody: '原',
		cleaned: '好'.repeat(501),
	});
	assert.deepEqual(validation.reasons, ['too-long']);
});

test('unchanged：整段比较', () => {
	const text = '同样的描述 @[[4-成果/A]]';
	const validation = validatePolishedText({
		originalBody: text,
		cleaned: text,
	});
	assert.deepEqual(validation.reasons, ['unchanged']);
});

test('链接集合相等 → ok', () => {
	const validation = validatePolishedText({
		originalBody: '参考 [[笔记A]] 写总结',
		cleaned: '参考 [[笔记A]] 写一份总结',
	});
	assert.equal(validation.ok, true);
});

test('多出链接 → links-changed', () => {
	const validation = validatePolishedText({
		originalBody: '参考 [[笔记A]] 写总结',
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
		originalBody: '参考 [[笔记A]] 写总结',
		cleaned: '参考写总结',
	});
	assert.deepEqual(validation.reasons, ['links-changed']);
});

test('500 字边界：500 通过、501 拒绝', () => {
	const atLimit = '好'.repeat(500);
	assert.equal(
		validatePolishedText({ originalBody: '原', cleaned: atLimit }).ok,
		true,
	);
	assert.deepEqual(
		validatePolishedText({ originalBody: '原', cleaned: '好'.repeat(501) })
			.reasons,
		['too-long'],
	);
});

test('清洗后为空 → empty', () => {
	for (const cleaned of ['', '   ', '\n\t ']) {
		const validation = validatePolishedText({
			originalBody: '原描述',
			cleaned: sanitizePolishedText(cleaned).text,
		});
		assert.deepEqual(validation.reasons, ['empty']);
	}
});