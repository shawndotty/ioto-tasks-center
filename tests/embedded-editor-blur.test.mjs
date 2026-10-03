import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { isOverlayFocusTarget, OVERLAY_FOCUS_SELECTOR } = await jiti.import(
	'../src/views/ioto-task/embedded-editor.ts',
);

// 只锁「选择器契约 + null/异常兜底」；defer 时序与真实提交语义靠真机验证
// （Plan-20261003-101010 §5.5、Research-20261003-100337 §3.2）。

test('OVERLAY_FOCUS_SELECTOR：契约覆盖 modal / suggestion / prompt 三类浮层', () => {
	assert.equal(typeof OVERLAY_FOCUS_SELECTOR, 'string');
	for (const cls of ['.modal-container', '.suggestion-container', '.prompt']) {
		assert.ok(
			OVERLAY_FOCUS_SELECTOR.includes(cls),
			`选择器应包含 ${cls}`,
		);
	}
});

test('isOverlayFocusTarget：命中选择器 → true', () => {
	assert.equal(
		isOverlayFocusTarget({ closest: () => ({}) }),
		true,
	);
	// 模拟真实 .closest：只在匹配到 modal-container 时返回元素
	assert.equal(
		isOverlayFocusTarget({
			closest: (s) => (s.includes('modal-container') ? {} : null),
		}),
		true,
	);
	assert.equal(
		isOverlayFocusTarget({
			closest: (s) => (s.includes('suggestion-container') ? {} : null),
		}),
		true,
	);
	assert.equal(
		isOverlayFocusTarget({
			closest: (s) => (s.includes('.prompt') ? {} : null),
		}),
		true,
	);
});

test('isOverlayFocusTarget：不落浮层（body / 卡片）→ false', () => {
	assert.equal(
		isOverlayFocusTarget({ closest: () => null }),
		false,
	);
});

test('isOverlayFocusTarget：null / undefined / 无 closest → false', () => {
	assert.equal(isOverlayFocusTarget(null), false);
	assert.equal(isOverlayFocusTarget(undefined), false);
	assert.equal(isOverlayFocusTarget({}), false);
	// 纯文本节点这类没有 closest 的对象
	assert.equal(isOverlayFocusTarget({ nodeType: 3 }), false);
	// closest 不是函数
	assert.equal(isOverlayFocusTarget({ closest: 'not-a-function' }), false);
});

test('isOverlayFocusTarget：closest 抛异常 → false（防御性）', () => {
	assert.equal(
		isOverlayFocusTarget({
			closest: () => {
				throw new Error('boom');
			},
		}),
		false,
	);
});
