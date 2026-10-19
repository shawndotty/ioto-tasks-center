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
		this.removed = 0;
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
		this.removed += 1;
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

/** 假 vault.process：写盘挂起，直到 `release()` —— 用于断言「await 期间 DOM 不动」。 */
function makeDeferredApp(initial) {
	let current = initial;
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	return {
		get content() {
			return current;
		},
		release: () => release(),
		vault: {
			process: async (_file, fn) => {
				await gate;
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

test('commitContinuationEdit：写盘挂起期间不拆编辑器 DOM（防「先缩小再扩大」）', async () => {
	// [[Report-20261019-115725]] §2：`.is-editing` 一撤，只读区立刻回到**编辑前**的
	// 旧内容；若这发生在写盘 await 之前，浏览器会先画一帧塌缩态，写完再撑开。
	// 这里用挂起的 vault.process 把 await 拉长，断言期间 DOM 与编辑态都不动。
	const app = makeDeferredApp(
		['# 任务', '- [ ] 甲', '      甲补充', '- [ ] 乙'].join('\n'),
	);
	const contEl = new FakeEl('ioto-task-view__card-continuation is-editing');
	const hostEl = contEl.createDiv({ cls: CONTINUATION_EDITOR });

	let destroyed = false;
	const renderCalls = [];
	const ctx = {
		app,
		file: { path: '3-任务/Demo/T.md' },
		data: app.content,
		lastLoadedText: app.content,
		autosave: { cancel() {} },
		continuationHandle: {
			getValue: () => '甲补充\n新增一行',
			destroy() {
				destroyed = true;
			},
		},
		continuationHostEl: hostEl,
		continuationLine: 1,
		continuationStartLine: 2,
		continuationEndLine: 2,
		continuationOriginalLines: ['      甲补充'],
		continuationIsNew: false,
		continuationDraftContainerEl: null,
		selectedLine: null,
		queryCard: () => ({ querySelector: () => contEl }),
		renderNote(data, options) {
			renderCalls.push([data, options]);
		},
		applyOutcome(outcome) {
			if (outcome.status === 'ok') {
				this.data = outcome.content;
				this.lastLoadedText = outcome.content;
			}
		},
	};

	const pending = IOTOTaskView.prototype.commitContinuationEdit.call(ctx);
	// 让提交跑到 vault.process 的 await gate
	await new Promise((resolve) => setTimeout(resolve, 0));

	assert.equal(destroyed, false, '写盘未落定前不得卸载 handle');
	assert.equal(
		contEl.hasClass('is-editing'),
		true,
		'写盘未落定前卡片须保持编辑态（高度不塌回旧内容）',
	);
	assert.equal(hostEl.removed, 0, '编辑器宿主不得先被移除');
	assert.equal(renderCalls.length, 0, '写盘未落定前不得重绘');
	assert.equal(ctx.continuationHandle, null, '逻辑退出仍要立刻生效（挡住 blur 重入）');

	app.release();
	await pending;

	assert.equal(destroyed, true, '写盘落定后才拆 DOM');
	assert.equal(contEl.hasClass('is-editing'), false, '退出编辑态');
	assert.equal(renderCalls.length, 1, '拆 DOM 与重绘在同一同步任务内完成');
	assert.equal(renderCalls[0][0], ctx.data, '重建用最新 view.data');
});
