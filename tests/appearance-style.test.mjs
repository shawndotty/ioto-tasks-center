import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { applyAppearanceStyleClasses } = await jiti.import(
	'../src/views/appearance-style.ts',
);

const APPEARANCE_CLASSES = ['is-glass', 'is-modern', 'is-simple', 'is-morandi'];

function createTarget() {
	const classes = new Set();
	return {
		classes,
		toggleClass(cls, on) {
			if (on) classes.add(cls);
			else classes.delete(cls);
		},
		active() {
			return APPEARANCE_CLASSES.filter((cls) => classes.has(cls));
		},
	};
}

test('四档风格各挂且只挂一个对应的类', () => {
	const expected = new Map([
		['glass', 'is-glass'],
		['modern', 'is-modern'],
		['simple', 'is-simple'],
		['morandi', 'is-morandi'],
	]);
	for (const [style, cls] of expected) {
		const target = createTarget();
		applyAppearanceStyleClasses(target, style);
		assert.deepEqual(target.active(), [cls], `style=${style}`);
	}
});

test('card 基线不挂任何风格类', () => {
	const target = createTarget();
	applyAppearanceStyleClasses(target, 'card');
	assert.deepEqual(target.active(), []);
});

test('连续切换不残留旧类', () => {
	const target = createTarget();
	applyAppearanceStyleClasses(target, 'glass');
	applyAppearanceStyleClasses(target, 'card');
	assert.deepEqual(target.active(), []);
	applyAppearanceStyleClasses(target, 'morandi');
	assert.deepEqual(target.active(), ['is-morandi']);
	applyAppearanceStyleClasses(target, 'simple');
	assert.deepEqual(target.active(), ['is-simple']);
});

test('互斥不变量：任一时刻至多一个风格类', () => {
	const target = createTarget();
	const sequence = ['glass', 'modern', 'simple', 'card', 'morandi', 'modern'];
	for (const style of sequence) {
		applyAppearanceStyleClasses(target, style);
		assert.ok(
			target.active().length <= 1,
			`style=${style} 命中 ${target.active().join(',')}`,
		);
	}
});
