import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 选中态 Mod+Enter 的键位桥接纯逻辑（select-mode-scope.ts 不 import obsidian，
// scope 由调用方注入），因此可直接 jiti 导入。
// 真实拦截效果（核心是否被抑制、macOS 是否落到 Command）必须真机验证。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	createModEnterHandler,
	registerModEnterHandler,
	SELECT_MODE_HOTKEY_KEY,
	SELECT_MODE_HOTKEY_MODIFIERS,
} = await jiti.import('../src/views/ioto-task/select-mode-scope.ts');

test('createModEnterHandler：命中 → 切换一次并返回 false（抑制核心）', () => {
	const calls = [];
	const handler = createModEnterHandler(() => ({
		canToggleSelected: () => true,
		toggleSelected: () => calls.push('toggle'),
	}));

	assert.equal(handler(), false);
	assert.deepEqual(calls, ['toggle']);
});

test('createModEnterHandler：不可接管 → 返回 undefined（放行核心）且不切换', () => {
	let toggles = 0;
	const handler = createModEnterHandler(() => ({
		canToggleSelected: () => false,
		toggleSelected: () => {
			toggles += 1;
		},
	}));

	assert.equal(handler(), undefined);
	assert.equal(toggles, 0);
});

test('createModEnterHandler：无 active 视图 → undefined；宿主每次按键重新解析', () => {
	let host = null;
	const handler = createModEnterHandler(() => host);

	// 注册时视图还不存在（plugin onload 早于任何 leaf 打开）
	assert.equal(handler(), undefined);

	// 后来打开了视图但不能接管 → 仍放行
	host = { canToggleSelected: () => false, toggleSelected: () => {} };
	assert.equal(handler(), undefined);

	// 变成可接管 → 命中
	host = { canToggleSelected: () => true, toggleSelected: () => {} };
	assert.equal(handler(), false);
});

test('registerModEnterHandler：把 Mod + Enter 注册到给定 scope', () => {
	const registered = [];
	registerModEnterHandler(
		{
			register: (modifiers, key, func) => {
				registered.push({ modifiers, key, func });
			},
		},
		() => null,
	);

	assert.equal(registered.length, 1);
	assert.deepEqual(registered[0].modifiers, SELECT_MODE_HOTKEY_MODIFIERS);
	assert.deepEqual(registered[0].modifiers, ['Mod']);
	assert.equal(registered[0].key, SELECT_MODE_HOTKEY_KEY);
	assert.equal(SELECT_MODE_HOTKEY_KEY, 'Enter');
	// 无宿主时注册出去的回调仍安全放行
	assert.equal(registered[0].func(), undefined);
});
