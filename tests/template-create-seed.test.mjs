import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 只锁「新建预填」的取值规则（[[Plan-20261025-080904]] §3.1 / §五）：
// 何时预填、什么时候绝不预填、标记以空格结尾。聚焦与光标落点属 DOM 行为，真机验收。

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { resolveCreateSeedContent } = await jiti.import(
	'../src/ui/template-create-seed.ts',
);

test('create + 空正文 → 返回标记（批量 / 条目各一）', () => {
	assert.equal(resolveCreateSeedContent('create', '', '- '), '- ');
	assert.equal(resolveCreateSeedContent('create', '', '- [ ] '), '- [ ] ');
});

test('create + 全空白正文（空格 / 换行 / 制表）视同空 → 仍预填', () => {
	assert.equal(resolveCreateSeedContent('create', '   \n\t', '- [ ] '), '- [ ] ');
});

test('create + 已有正文 → null（不覆盖用户内容）', () => {
	assert.equal(resolveCreateSeedContent('create', '- 任务一', '- '), null);
});

test('edit / duplicate → null（打开已有或复制都不追加标记）', () => {
	assert.equal(resolveCreateSeedContent('edit', '', '- '), null);
	assert.equal(resolveCreateSeedContent('duplicate', '', '- [ ] '), null);
	// 即便原文为空也不预填：编辑态留空是用户的显式选择
	assert.equal(resolveCreateSeedContent('duplicate', '  ', '- '), null);
});

test('预填值以空格结尾，保证光标落点与后续输入不粘连', () => {
	const batch = resolveCreateSeedContent('create', '', '- ');
	const entry = resolveCreateSeedContent('create', '', '- [ ] ');
	assert.equal(batch, '- ');
	assert.equal(batch.length, 2);
	assert.equal(entry, '- [ ] ');
	assert.equal(entry.length, 6);
	assert.ok(batch.endsWith(' '));
	assert.ok(entry.endsWith(' '));
});
