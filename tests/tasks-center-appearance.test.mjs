/**
 * 任务中心外观跟随（[[Plan-20261116-183314]] S1）：
 * `mode × style` 矩阵、类集合、归一化与 updater 早退 / 广播。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: { obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname },
});

const {
	applyTasksCenterAppearance,
	resolveTasksCenterAppearanceStyle,
} = await jiti.import('../src/views/appearance-style.ts');

const { normalizeTasksCenterAppearanceMode } = await jiti.import(
	'../src/settings-normalizers.ts',
);

const { updateTasksCenterAppearanceMode } = await jiti.import(
	'../src/settings-updaters.ts',
);

const { DEFAULT_SETTINGS } = await jiti.import('../src/settings-types.ts');

const STYLES = ['glass', 'modern', 'simple', 'card', 'morandi'];
const APPEARANCE_CLASSES = ['is-glass', 'is-modern', 'is-simple', 'is-morandi'];

function createTarget() {
	const classes = new Set();
	return {
		toggleClass(cls, on) {
			if (on) classes.add(cls);
			else classes.delete(cls);
		},
		active() {
			return APPEARANCE_CLASSES.filter((cls) => classes.has(cls));
		},
	};
}

function createHost(mode = 'default') {
	return {
		settings: { ...DEFAULT_SETTINGS, tasksCenterAppearanceMode: mode },
		saveCalls: 0,
		applyCalls: 0,
		async saveSettings() {
			this.saveCalls += 1;
		},
		applySettingsToOpenViews() {
			this.applyCalls += 1;
		},
	};
}

test('default × 五档一律返回 null', () => {
	for (const style of STYLES) {
		assert.equal(
			resolveTasksCenterAppearanceStyle('default', style),
			null,
			`style=${style}`,
		);
	}
});

test('follow × 四档返回自身，follow + card 返回 null', () => {
	for (const style of STYLES) {
		const expected = style === 'card' ? null : style;
		assert.equal(
			resolveTasksCenterAppearanceStyle('follow', style),
			expected,
			`style=${style}`,
		);
	}
});

test('applyTasksCenterAppearance：默认 / 跟随 + card 不挂类', () => {
	for (const [mode, style] of [
		['default', 'glass'],
		['default', 'morandi'],
		['follow', 'card'],
	]) {
		const target = createTarget();
		applyTasksCenterAppearance(target, mode, style);
		assert.deepEqual(target.active(), [], `${mode}/${style}`);
	}
});

test('applyTasksCenterAppearance：跟随 + 四档恰挂一个类且切换不残留', () => {
	const target = createTarget();
	for (const style of ['glass', 'modern', 'simple', 'morandi']) {
		applyTasksCenterAppearance(target, 'follow', style);
		assert.deepEqual(target.active(), [`is-${style}`], `style=${style}`);
	}

	applyTasksCenterAppearance(target, 'default', 'glass');
	assert.deepEqual(target.active(), []);
});

test('normalizeTasksCenterAppearanceMode：非法值回落 default', () => {
	assert.equal(normalizeTasksCenterAppearanceMode('default'), 'default');
	assert.equal(normalizeTasksCenterAppearanceMode('follow'), 'follow');
	for (const value of [undefined, null, '', 'glass', 1, {}, []]) {
		assert.equal(
			normalizeTasksCenterAppearanceMode(value),
			'default',
			`value=${String(value)}`,
		);
	}
});

test('updateTasksCenterAppearanceMode：同值早退，不写盘不广播', async () => {
	const host = createHost('default');
	await updateTasksCenterAppearanceMode(host, 'default');
	assert.equal(host.saveCalls, 0);
	assert.equal(host.applyCalls, 0);
});

test('updateTasksCenterAppearanceMode：异值写盘并广播', async () => {
	const host = createHost('default');
	await updateTasksCenterAppearanceMode(host, 'follow');
	assert.equal(host.settings.tasksCenterAppearanceMode, 'follow');
	assert.equal(host.saveCalls, 1);
	assert.equal(host.applyCalls, 1);
});
