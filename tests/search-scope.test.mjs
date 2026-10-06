import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// Ctrl/Cmd+F 搜索条的键位桥接纯逻辑（search-scope.ts 不 import obsidian，
// scope 由调用方注入），因此可直接 jiti 导入。
// 真实拦截效果（核心是否被抑制）必须真机验证。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	createSearchHandler,
	registerSearchHandler,
	SEARCH_HOTKEY_KEY,
	SEARCH_HOTKEY_MODIFIERS,
} = await jiti.import('../src/views/ioto-task/search-scope.ts');

test('createSearchHandler：命中 → 唤出搜索条并返回 false（抑制核心）', () => {
	const calls = [];
	const handler = createSearchHandler(() => ({
		canRevealSearch: () => true,
		revealSearch: () => calls.push('reveal'),
	}));

	assert.equal(handler(), false);
	assert.deepEqual(calls, ['reveal']);
});

test('createSearchHandler：不可接管 → 返回 undefined（放行核心）且不唤出', () => {
	let reveals = 0;
	const handler = createSearchHandler(() => ({
		canRevealSearch: () => false,
		revealSearch: () => {
			reveals += 1;
		},
	}));

	assert.equal(handler(), undefined);
	assert.equal(reveals, 0);
});

test('createSearchHandler：无 active 视图 → undefined；宿主每次按键重新解析', () => {
	let host = null;
	const handler = createSearchHandler(() => host);

	// 注册时视图还不存在（plugin onload 早于任何 leaf 打开）
	assert.equal(handler(), undefined);

	// 后来打开了视图但不能接管（编辑态）→ 仍放行
	host = { canRevealSearch: () => false, revealSearch: () => {} };
	assert.equal(handler(), undefined);

	// 变成可接管 → 命中
	host = { canRevealSearch: () => true, revealSearch: () => {} };
	assert.equal(handler(), false);
});

test('registerSearchHandler：把 Mod + f 注册到给定 scope', () => {
	const registered = [];
	registerSearchHandler(
		{
			register: (modifiers, key, func) => {
				registered.push({ modifiers, key, func });
			},
		},
		() => null,
	);

	assert.equal(registered.length, 1);
	assert.deepEqual(registered[0].modifiers, SEARCH_HOTKEY_MODIFIERS);
	assert.deepEqual(registered[0].modifiers, ['Mod']);
	assert.equal(registered[0].key, SEARCH_HOTKEY_KEY);
	assert.equal(SEARCH_HOTKEY_KEY, 'f');
	// 无宿主时注册出去的回调仍安全放行
	assert.equal(registered[0].func(), undefined);
});
