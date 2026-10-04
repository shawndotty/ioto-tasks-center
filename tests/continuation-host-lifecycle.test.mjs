import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 续行编辑器宿主的生命周期回归（[[Plan-20261004-215814]] §4）。
// 直接调用视图私有方法（TS private 在运行时只是普通属性），用手写假 DOM 承载：
// 断言「退时删壳」「进前清壳」「降级回收」三条不变量，防止空壳再次累积。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { IOTOTaskView } = await jiti.import('../src/views/iotoTaskView.ts');

const CONTINUATION_EDITOR = 'ioto-task-view__continuation-editor';

/** 最小假元素：只实现本测试用到的 class / createDiv / remove / querySelectorAll。 */
class FakeEl {
	constructor(cls = '') {
		this._classes = new Set(cls.split(' ').filter(Boolean));
		this.children = [];
		this.parent = null;
		this.removed = 0;
	}
	addClass(c) {
		this._classes.add(c);
	}
	removeClass(c) {
		this._classes.delete(c);
	}
	hasClass(c) {
		return this._classes.has(c);
	}
	createDiv(opts = {}) {
		const el = new FakeEl(opts.cls ?? '');
		el.parent = this;
		this.children.push(el);
		return el;
	}
	remove() {
		this.removed += 1;
		if (this.parent) {
			this.parent.children = this.parent.children.filter((c) => c !== this);
			this.parent = null;
		}
	}
	querySelectorAll(selector) {
		const match = /^:scope > \.([\w-]+)$/u.exec(selector.trim());
		if (!match) {
			return [];
		}
		return this.children.filter((c) => c.hasClass(match[1]));
	}
}

function shellCount(contEl) {
	return contEl.children.filter((c) => c.hasClass(CONTINUATION_EDITOR)).length;
}

test('destroyContinuationEditor：销毁时连同宿主空壳一起移除，并置空字段', () => {
	const contEl = new FakeEl('ioto-task-view__card-continuation');
	contEl.addClass('is-editing');
	const hostEl = contEl.createDiv({ cls: CONTINUATION_EDITOR });
	let destroyed = false;
	let canceled = false;
	const ctx = {
		autosave: {
			cancel() {
				canceled = true;
			},
		},
		continuationHandle: {
			destroy() {
				destroyed = true;
			},
		},
		continuationHostEl: hostEl,
		continuationLine: 3,
		queryCard: () => ({
			querySelector: (s) =>
				s === '.ioto-task-view__card-continuation' ? contEl : null,
		}),
	};

	IOTOTaskView.prototype.destroyContinuationEditor.call(ctx);

	assert.equal(destroyed, true, 'handle.destroy() 应被调用');
	assert.equal(canceled, true, 'autosave.cancel() 应被调用');
	assert.equal(hostEl.removed, 1, '宿主 div 应被显式移除（不能只 empty）');
	assert.equal(ctx.continuationHostEl, null, '宿主持有字段应置空');
	assert.equal(ctx.continuationHandle, null, 'handle 字段应置空');
	assert.equal(contEl.hasClass('is-editing'), false, '续行容器应摘掉编辑态');
	assert.equal(shellCount(contEl), 0, '续行容器下不应残留空壳');
});

test('destroyContinuationEditor：重复调用幂等，非编辑态不再报错', () => {
	const ctx = {
		autosave: { cancel() {} },
		continuationHandle: null,
		continuationHostEl: null,
		continuationLine: null,
	};
	assert.doesNotThrow(() =>
		IOTOTaskView.prototype.destroyContinuationEditor.call(ctx),
	);
	assert.equal(ctx.continuationHostEl, null);
});

test('beginContinuationEdit：进前清掉历史空壳；降级时新宿主也一并回收', async () => {
	const contEl = new FakeEl('ioto-task-view__card-continuation');
	// 预置两个历史空壳（模拟修复前累积的残留）
	contEl.createDiv({ cls: CONTINUATION_EDITOR });
	contEl.createDiv({ cls: CONTINUATION_EDITOR });
	assert.equal(shellCount(contEl), 2);

	const cardEl = {
		querySelector: (s) =>
			s === '.ioto-task-view__card-continuation' ? contEl : null,
	};
	const ctx = {
		data: ['- [ ] 甲', '      续行一', '- [ ] 乙'].join('\n'),
		file: { path: '3-任务/Demo/T.md' },
		supportsInlineEdit: () => true,
		continuationLine: null,
		continuationHandle: null,
		continuationHostEl: null,
		async commitEdit() {},
		async commitContinuationEdit() {},
		queryCard: () => cardEl,
		app: {}, // 无 embedRegistry → mountEmbeddedEditor 返回 null → 走降级分支
	};

	await IOTOTaskView.prototype.beginContinuationEdit.call(ctx, 0);

	// 若「进前清壳」缺失，两个历史空壳会留存（降级只移除新建的宿主）→ 这里应为 2；
	// 修复后应为 0：历史空壳被清、新宿主也被降级回收。
	assert.equal(shellCount(contEl), 0, '历史空壳与新宿主都不应残留');
	assert.equal(ctx.continuationHostEl, null, '降级后宿主持有字段应置空');
	assert.equal(ctx.continuationHandle, null, '降级后不应持有 handle');
	assert.equal(contEl.hasClass('is-editing'), false, '降级后应退出编辑态');
});
