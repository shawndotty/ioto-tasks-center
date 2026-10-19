import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 「退出编辑必重绘」不变量（[[Plan-20261019-114027]] §3.4，[[Research-20261019-113227]] §4.1）：
// 编辑期的节流自动落盘已把新正文写盘并同步 `view.data`（设计上不重绘），
// 退出时最后一次提交因此判 `unchanged`；若此时仍按旧约定 return，只读 DOM 会停在
// 进入编辑前的快照。这里锁住「unchanged 也必须整树重建」。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { IOTOTaskView } = await jiti.import('../src/views/iotoTaskView.ts');

const CONTINUATION_EDITOR = 'ioto-task-view__continuation-editor';

/** 最小假元素：只承载 destroyContinuationEditor 需要的 createDiv / querySelector。 */
class FakeEl {
	constructor(cls = '') {
		this._classes = new Set(cls.split(' ').filter(Boolean));
		this.children = [];
		this.parent = null;
		this.attrs = {};
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
		el.attrs = opts.attr ?? {};
		el.parent = this;
		this.children.push(el);
		return el;
	}
	remove() {
		if (this.parent) {
			this.parent.children = this.parent.children.filter((c) => c !== this);
			this.parent = null;
		}
	}
	querySelector() {
		return null;
	}
	querySelectorAll() {
		return [];
	}
}

/** 假 vault.process：计数 + 返回加工后的内容（与真实实现同形状）。 */
function makeApp(initial) {
	let current = initial;
	let processed = 0;
	return {
		get content() {
			return current;
		},
		get processed() {
			return processed;
		},
		vault: {
			process: async (_file, fn) => {
				processed += 1;
				current = fn(current);
				return current;
			},
		},
	};
}

test('commitContinuationEdit：既有多行续行判 unchanged 时仍整树重建', async () => {
	// 磁盘 = 已是编辑器里的最新正文（模拟自动落盘已完成、DOM 仍旧）
	const app = makeApp(
		['# 任务', '- [ ] 甲', '      甲补充', '      乙补充', '- [ ] 乙'].join(
			'\n',
		),
	);
	const contEl = new FakeEl('ioto-task-view__card-continuation is-editing');
	const hostEl = contEl.createDiv({ cls: CONTINUATION_EDITOR });

	const renderCalls = [];
	const ctx = {
		app,
		file: { path: '3-任务/Demo/T.md' },
		data: app.content,
		lastLoadedText: app.content,
		autosave: { cancel() {} },
		// 编辑器内容是 dedent 后的（两行都去掉 6 空格公共前缀）
		continuationHandle: {
			getValue: () => '甲补充\n乙补充',
			destroy() {},
		},
		continuationHostEl: hostEl,
		continuationLine: 1,
		continuationStartLine: 2,
		continuationEndLine: 3,
		continuationOriginalLines: ['      甲补充', '      乙补充'],
		continuationIsNew: false,
		continuationDraftContainerEl: null,
		selectedLine: null,
		queryCard: () => ({ querySelector: () => contEl }),
		renderNote(data, options) {
			renderCalls.push([data, options]);
		},
		destroyContinuationEditor: IOTOTaskView.prototype.destroyContinuationEditor,
		applyOutcome(outcome) {
			if (outcome.status === 'ok') {
				this.data = outcome.content;
				this.lastLoadedText = outcome.content;
			}
		},
	};

	await IOTOTaskView.prototype.commitContinuationEdit.call(ctx);

	assert.equal(app.processed, 1, '提交仍走一次写盘事务');
	assert.equal(
		app.content,
		['# 任务', '- [ ] 甲', '      甲补充', '      乙补充', '- [ ] 乙'].join('\n'),
		'unchanged 语义：磁盘内容零变化',
	);
	assert.equal(renderCalls.length, 1, 'unchanged 退出后必须重建一次');
	assert.equal(renderCalls[0][0], ctx.data, '重建必须用最新 view.data');
	assert.equal(ctx.selectedLine, 1, '选中回填到本卡');
	assert.equal(ctx.continuationLine, null, '编辑态字段已清空');
});
