import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildPolishPrompt, collectDeliverableTokens } = await jiti.import(
	'../src/views/ioto-task/task-polish-prompt.ts',
);

test('collectDeliverableTokens：无 token → 空数组', () => {
	assert.deepEqual(collectDeliverableTokens('整理一下会议纪要'), []);
});

test('collectDeliverableTokens：句中单个', () => {
	assert.deepEqual(collectDeliverableTokens('把结论写入@[[4-成果/A]]。'), [
		'@[[4-成果/A]]',
	]);
});

test('collectDeliverableTokens：多个含别名，顺序与别名原样', () => {
	assert.deepEqual(
		collectDeliverableTokens(
			'参考@[[4-成果/B]]并输出@[[4-成果/A|甲]]',
		),
		['@[[4-成果/B]]', '@[[4-成果/A|甲]]'],
	);
});

test('collectDeliverableTokens：重复 token 按次数记录', () => {
	assert.deepEqual(
		collectDeliverableTokens('@[[4-成果/A]] 与 @[[4-成果/A]]'),
		['@[[4-成果/A]]', '@[[4-成果/A]]'],
	);
});

test('collectDeliverableTokens：普通 [[X]] 与 depends：[[X]] 不计入', () => {
	assert.deepEqual(
		collectDeliverableTokens('depends：[[任务B]] 参考 [[笔记A]]'),
		[],
	);
});

test('buildPolishPrompt：整段正文 + 7 条要求', () => {
	const body = '把口语化的描述改专业 @[[4-成果/周报]]';
	const prompt = buildPolishPrompt(body);
	assert.ok(prompt.includes(`[任务描述]\n${body}`));
	assert.ok(prompt.includes('不执行任务、不新增事实'));
	for (const index of [1, 2, 3, 4, 5, 6, 7]) {
		assert.ok(prompt.includes(`${index}. `), `缺少第 ${index} 条要求`);
	}
	assert.ok(prompt.includes('只输出润色后的描述正文'));
	assert.ok(prompt.includes('每个 @[[…]] 交付物标记必须原样保留'));
});

test('buildPolishPrompt：有交付物时出现上下文行，去重保序', () => {
	const prompt = buildPolishPrompt(
		'参考@[[4-成果/B]]并输出@[[4-成果/A]]，再核对@[[4-成果/B]]',
	);
	assert.ok(
		prompt.includes('- 本行的交付物：@[[4-成果/B]]、@[[4-成果/A]]'),
	);
});

test('buildPolishPrompt：无交付物时不出现交付物上下文行', () => {
	const prompt = buildPolishPrompt('整理会议纪要');
	assert.ok(!prompt.includes('本行的交付物'));
});