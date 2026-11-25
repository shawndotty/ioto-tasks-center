import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildPolishPrompt, splitDeliverableTail } = await jiti.import(
	'../src/views/ioto-task/task-polish-prompt.ts',
);

test('无交付物尾：prose 原样（仅 trimEnd），尾部为空', () => {
	const result = splitDeliverableTail('整理一下会议纪要  ');
	assert.equal(result.prose, '整理一下会议纪要');
	assert.equal(result.trailingDeliverables, '');
});

test('单个交付物尾：正文与尾部正确切分', () => {
	const result = splitDeliverableTail('输出一份周报 @[[4-成果/周报]]');
	assert.equal(result.prose, '输出一份周报');
	assert.equal(result.trailingDeliverables, '@[[4-成果/周报]]');
});

test('多个交付物尾：整体剥离并保留顺序 / 别名', () => {
	const result = splitDeliverableTail(
		'输出报告 @[[4-成果/A|甲]]  @[[4-成果/B]]   ',
	);
	assert.equal(result.prose, '输出报告');
	assert.equal(
		result.trailingDeliverables,
		'@[[4-成果/A|甲]]  @[[4-成果/B]]',
	);
});

test('交付物在句中不剥离', () => {
	const result = splitDeliverableTail('参考 @[[4-成果/A]] 写一份总结');
	assert.equal(result.prose, '参考 @[[4-成果/A]] 写一份总结');
	assert.equal(result.trailingDeliverables, '');
});

test('prompt 含原文位置与 6 条要求', () => {
	const prompt = buildPolishPrompt('把口语化的描述改专业');
	assert.ok(prompt.includes('[任务描述]\n把口语化的描述改专业'));
	assert.ok(prompt.includes('不执行任务、不新增事实'));
	for (const index of [1, 2, 3, 4, 5, 6]) {
		assert.ok(prompt.includes(`${index}. `), `缺少第 ${index} 条要求`);
	}
	assert.ok(prompt.includes('只输出润色后的描述正文'));
});