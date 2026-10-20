import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { isViewTooShortForToggle, TOGGLE_MIN_VIEW_HEIGHT, TOGGLE_SHOW_DELAY_MS } =
	await jiti.import('../src/view-toggle-model.ts');

test('高度闸门：低于阈值收起（键盘态 / 窄窗格）', () => {
	assert.equal(isViewTooShortForToggle(TOGGLE_MIN_VIEW_HEIGHT - 1), true);
	assert.equal(isViewTooShortForToggle(376), true); // iPhone SE 3 键盘态
	assert.equal(isViewTooShortForToggle(596), true); // iPhone 15 Pro Max 键盘态（临界）
});

test('高度闸门：达到阈值即显示', () => {
	assert.equal(isViewTooShortForToggle(TOGGLE_MIN_VIEW_HEIGHT), false);
	assert.equal(isViewTooShortForToggle(862), false); // 桌面常规窗格
});

test('高度闸门：未布局（0）视为过矮', () => {
	assert.equal(isViewTooShortForToggle(0), true);
});

test('常量口径：阈值 600、恢复延迟 150ms', () => {
	assert.equal(TOGGLE_MIN_VIEW_HEIGHT, 600);
	assert.equal(TOGGLE_SHOW_DELAY_MS, 150);
});
