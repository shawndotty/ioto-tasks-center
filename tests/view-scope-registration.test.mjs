import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// 只锁「热键挂在 View.scope、插件不压常驻 scope」这条源码契约；
// 真实分发效果（笔记 Cmd+F、TaskView Cmd+Enter、多 leaf 只响应 active）必须真机验证，
// 见 Plan-20261024-193141 §六 / §七。

const mainSrc = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const viewSrc = readFileSync(
	new URL('../src/views/iotoTaskView.ts', import.meta.url),
	'utf8',
);

test('main.ts 不得再压常驻 scope（会把 DeferredScope 埋进 prevScopes）', () => {
	assert.equal(mainSrc.includes('pushScope'), false);
	assert.equal(mainSrc.includes('popScope'), false);
});

test('IOTOTaskView 在构造函数里把两条热键挂到 view.scope', () => {
	assert.match(viewSrc, /new Scope\(this\.app\.scope\)/);
	assert.match(viewSrc, /this\.scope = scope/);
	assert.match(viewSrc, /registerSearchHandler\(scope,/);
	assert.match(viewSrc, /registerModEnterHandler\(scope,/);
});
