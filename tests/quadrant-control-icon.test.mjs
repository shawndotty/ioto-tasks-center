import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限窄屏过滤控件图标 helper 单测（[[Plan-20261116-095729]] §3.6）。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { QUADRANT_CONTROL_ICONS, createQuadrantControlIcon } = await jiti.import(
	'../src/views/quadrant/control-icon.ts',
);

function makeParent() {
	const created = [];
	return {
		created,
		createSpan(options) {
			const el = {
				cls: options?.cls,
				attrs: {},
				setAttribute(name, value) {
					this.attrs[name] = value;
				},
			};
			created.push(el);
			return el;
		},
	};
}

test('图标常量与既有 Lucide id 对齐', () => {
	assert.deepEqual(QUADRANT_CONTROL_ICONS, {
		status: 'list-checks',
		time: 'calendar-range',
		type: 'tags',
		unlabeled: 'inbox',
	});
});

test('createQuadrantControlIcon 写入类名、设置 aria-hidden 并返回元素', () => {
	const parent = makeParent();
	const el = createQuadrantControlIcon(
		parent,
		'ioto-pq-status-menu__icon',
		QUADRANT_CONTROL_ICONS.status,
	);

	assert.equal(parent.created.length, 1);
	assert.equal(el, parent.created[0]);
	assert.equal(el.cls, 'ioto-pq-status-menu__icon');
	assert.equal(el.attrs['aria-hidden'], 'true');
});