import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 「编辑态 Shift+Enter 新增续写区」的草稿生命周期回归（[[Plan-20261004-222507]] §5.5-5.7）。
// 直接调用视图私有方法（TS private 在运行时只是普通属性），用手写假 DOM 承载：
// 断言「空草稿不落盘」「落盘走任务行展开、缩进 6 空格」「草稿容器不成空壳」三条不变量。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { IOTOTaskView } = await jiti.import('../src/views/iotoTaskView.ts');

const CARD_CONTINUATION = 'ioto-task-view__card-continuation';
const CONTINUATION_EDITOR = 'ioto-task-view__continuation-editor';

/** 最小假元素：class / createDiv / remove / querySelector(后代) / querySelectorAll(:scope >)。 */
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
	/** 只支持 `.cls`：在后代里找第一个命中。 */
	querySelector(selector) {
		const cls = selector.startsWith('.') ? selector.slice(1) : null;
		if (!cls) {
			return null;
		}
		const walk = (el) => {
			for (const child of el.children) {
				if (child.hasClass(cls)) {
					return child;
				}
				const found = walk(child);
				if (found) {
					return found;
				}
			}
			return null;
		};
		return walk(this);
	}
	querySelectorAll(selector) {
		const match = /^:scope > \.([\w-]+)$/u.exec(selector.trim());
		if (!match) {
			return [];
		}
		return this.children.filter((c) => c.hasClass(match[1]));
	}
}

const descendants = (el, cls, out = []) => {
	for (const child of el.children) {
		if (child.hasClass(cls)) {
			out.push(child);
		}
		descendants(child, cls, out);
	}
	return out;
};

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

/* ------------------------------------------------------------------ *
 * beginContinuationOrNew：路由
 * ------------------------------------------------------------------ */

test('beginContinuationOrNew：有续行 → beginContinuationEdit；无续行 → beginNewContinuationEdit', async () => {
	const calls = [];
	const base = {
		supportsInlineEdit: () => true,
		file: { path: '3-任务/Demo/T.md' },
		continuationLine: null,
		continuationHandle: null,
		async beginContinuationEdit(line) {
			calls.push(['edit', line]);
		},
		async beginNewContinuationEdit(line) {
			calls.push(['new', line]);
		},
	};

	await IOTOTaskView.prototype.beginContinuationOrNew.call(
		{ ...base, countContinuationLines: () => 2 },
		5,
	);
	assert.deepEqual(calls, [['edit', 5]]);

	calls.length = 0;
	await IOTOTaskView.prototype.beginContinuationOrNew.call(
		{ ...base, countContinuationLines: () => 0 },
		7,
	);
	assert.deepEqual(calls, [['new', 7]]);
});

test('beginContinuationOrNew：只读降级静默不进入；同卡重复 = no-op', async () => {
	const calls = [];
	const base = {
		file: { path: '3-任务/Demo/T.md' },
		continuationLine: null,
		continuationHandle: null,
		countContinuationLines: () => 0,
		async beginContinuationEdit(line) {
			calls.push(['edit', line]);
		},
		async beginNewContinuationEdit(line) {
			calls.push(['new', line]);
		},
	};

	await IOTOTaskView.prototype.beginContinuationOrNew.call(
		{ ...base, supportsInlineEdit: () => false },
		1,
	);
	assert.deepEqual(calls, [], '只读降级不应进入任一分支');

	await IOTOTaskView.prototype.beginContinuationOrNew.call(
		{
			...base,
			supportsInlineEdit: () => true,
			continuationLine: 3,
			continuationHandle: { getValue: () => '' },
		},
		3,
	);
	assert.deepEqual(calls, [], '同一张卡已在草稿编辑中应短路');
});

/* ------------------------------------------------------------------ *
 * beginNewContinuationEdit：挂草稿 / 降级回收
 * ------------------------------------------------------------------ */

test('beginNewContinuationEdit：降级（无核心编辑器）时临时容器被回收，不留空壳', async () => {
	const cardEl = new FakeEl('ioto-task-view__card');
	const ctx = {
		data: ['# 任务', '- [ ] 甲'].join('\n'),
		file: { path: '3-任务/Demo/T.md' },
		supportsInlineEdit: () => true,
		continuationLine: null,
		continuationHandle: null,
		continuationHostEl: null,
		continuationDraftContainerEl: null,
		continuationIsNew: false,
		async commitEdit() {},
		async commitContinuationEdit() {},
		queryCard: () => cardEl,
		app: {}, // 无 embedRegistry → mountEmbeddedEditor 返回 null → 走降级分支
		lineAt: IOTOTaskView.prototype.lineAt,
	};

	await IOTOTaskView.prototype.beginNewContinuationEdit.call(ctx, 1);

	assert.equal(
		cardEl.children.filter((c) => c.hasClass(CARD_CONTINUATION)).length,
		0,
		'降级时临时建的续行容器应被移除',
	);
	assert.equal(descendants(cardEl, CONTINUATION_EDITOR).length, 0);
	assert.equal(ctx.continuationHostEl, null, '降级后宿主持有字段应置空');
	assert.equal(ctx.continuationDraftContainerEl, null, '降级后草稿容器字段应置空');
	assert.equal(ctx.continuationHandle, null, '降级后不应持有 handle');
	assert.equal(ctx.continuationIsNew, false, '降级后不应标记为草稿');
});

/* ------------------------------------------------------------------ *
 * commitContinuationEdit：草稿分流
 * ------------------------------------------------------------------ */

test('commitContinuationEdit：草稿有内容 → 任务行展开写入 6 空格缩进续行', async () => {
	const app = makeApp(['# 任务', '- [ ] 甲', '- [ ] 乙'].join('\n'));
	const draft = new FakeEl(`${CARD_CONTINUATION} is-editing`);
	const hostEl = draft.createDiv({ cls: CONTINUATION_EDITOR });
	const ctx = {
		app,
		file: { path: '3-任务/Demo/T.md' },
		data: app.content,
		lastLoadedText: app.content,
		autosave: { cancel() {} },
		continuationHandle: { getValue: () => '甲补充', destroy() {} },
		continuationHostEl: hostEl,
		continuationLine: 1,
		continuationStartLine: 2,
		continuationEndLine: 1,
		continuationOriginalLines: [],
		continuationIsNew: true,
		continuationDraftContainerEl: draft,
		queryCard: () => ({ querySelector: () => null }),
		renderNote() {},
		lineAt: IOTOTaskView.prototype.lineAt,
		destroyContinuationEditor: IOTOTaskView.prototype.destroyContinuationEditor,
		applyOutcome(outcome) {
			if (outcome.status === 'ok') {
				this.data = outcome.content;
				this.lastLoadedText = outcome.content;
			}
		},
	};

	await IOTOTaskView.prototype.commitContinuationEdit.call(ctx);

	assert.equal(
		app.content,
		['# 任务', '- [ ] 甲', '      甲补充', '- [ ] 乙'].join('\n'),
		'新续行应紧跟任务行、缩进 6 空格与正文左对齐',
	);
	assert.equal(ctx.continuationLine, null);
	assert.equal(ctx.continuationIsNew, false);
	assert.equal(draft.removed, 1, '草稿临时容器随提交一并回收');
	assert.equal(descendants(draft, CONTINUATION_EDITOR).length, 0);
});

test('commitContinuationEdit：空草稿 → 磁盘零变化、无残留空壳', async () => {
	const app = makeApp(['# 任务', '- [ ] 甲', '- [ ] 乙'].join('\n'));
	const draft = new FakeEl(`${CARD_CONTINUATION} is-editing`);
	const hostEl = draft.createDiv({ cls: CONTINUATION_EDITOR });
	const ctx = {
		app,
		file: { path: '3-任务/Demo/T.md' },
		data: app.content,
		lastLoadedText: app.content,
		autosave: { cancel() {} },
		continuationHandle: { getValue: () => '', destroy() {} },
		continuationHostEl: hostEl,
		continuationLine: 1,
		continuationStartLine: 2,
		continuationEndLine: 1,
		continuationOriginalLines: [],
		continuationIsNew: true,
		continuationDraftContainerEl: draft,
		queryCard: () => ({ querySelector: () => null }),
		renderNote() {},
		lineAt: IOTOTaskView.prototype.lineAt,
		destroyContinuationEditor: IOTOTaskView.prototype.destroyContinuationEditor,
		applyOutcome() {},
	};

	await IOTOTaskView.prototype.commitContinuationEdit.call(ctx);

	assert.equal(app.processed, 0, '空草稿不落盘');
	assert.equal(app.content, ['# 任务', '- [ ] 甲', '- [ ] 乙'].join('\n'));
	assert.equal(ctx.continuationLine, null);
	assert.equal(ctx.continuationIsNew, false);
	assert.equal(draft.removed, 1);
	assert.equal(descendants(draft, CONTINUATION_EDITOR).length, 0);
});

/* ------------------------------------------------------------------ *
 * 自动落盘短路 / 销毁回收
 * ------------------------------------------------------------------ */

test('autosaveContinuation：新建草稿不自动落盘（短路）', async () => {
	const app = makeApp(['- [ ] 甲'].join('\n'));
	const ctx = {
		app,
		file: { path: '3-任务/Demo/T.md' },
		continuationLine: 0,
		continuationHandle: { getValue: () => '草稿' },
		continuationIsNew: true,
		autosaveRunning: false,
	};

	await IOTOTaskView.prototype.autosaveContinuation.call(ctx);

	assert.equal(app.processed, 0, '草稿期不应触发任何写盘');
});

test('destroyContinuationEditor：回收草稿临时容器并复位 continuationIsNew', () => {
	const draft = new FakeEl(`${CARD_CONTINUATION} is-editing`);
	const hostEl = draft.createDiv({ cls: CONTINUATION_EDITOR });
	let destroyed = false;
	const ctx = {
		autosave: { cancel() {} },
		continuationHandle: {
			destroy() {
				destroyed = true;
			},
		},
		continuationHostEl: hostEl,
		continuationLine: 2,
		continuationIsNew: true,
		continuationDraftContainerEl: draft,
		queryCard: () => ({ querySelector: () => null }),
	};

	IOTOTaskView.prototype.destroyContinuationEditor.call(ctx);

	assert.equal(destroyed, true);
	assert.equal(hostEl.removed, 1, '宿主 div 应被显式移除');
	assert.equal(draft.removed, 1, '草稿临时容器应被回收（绝不留空壳）');
	assert.equal(ctx.continuationDraftContainerEl, null);
	assert.equal(ctx.continuationIsNew, false);
});
