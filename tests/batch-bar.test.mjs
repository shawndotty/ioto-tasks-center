import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { renderBatchBar } = await jiti.import(
	'../src/views/tasks-center/batch-bar-renderer.ts',
);
const en = (await jiti.import('../src/lang/locale/en.ts')).default;

test('选中 0 项时计数位提示先选任务，属性区与危险区全部禁用', () => {
	const container = new FakeElement();
	renderBatchBar(createView(), container);

	const bar = container.children[0];
	const buttons = buttonsOf(bar);

	assert.equal(buttons.length, 5);
	assert.equal(buttons[0].disabled, false);
	assert.ok(buttons.slice(1).every((button) => button.disabled));

	const count = findByClass(bar, 'ioto-tasks-center__batch-bar-count');
	assert.equal(count.text, en['view.batchBar.emptyHint']);
	assert.ok(count.cls.includes('is-empty'));
	assert.equal(count.attributes['aria-live'], 'polite');
});

test('窄栏只渲染 2 个控件：全选 + 操作下拉', () => {
	const container = new FakeElement();
	renderBatchBar(createView({ isCompactLayout: true }), container);

	const bar = container.children[0];
	assert.ok(bar.cls.includes('is-compact'));

	const buttons = buttonsOf(bar);
	assert.deepEqual(
		buttons.map(labelOf),
		[en['view.batchBar.selectAll'], en['view.batchBar.actions']],
	);
	assert.equal(buttons[1].attributes['aria-haspopup'], 'menu');
	assert.ok(
		buttons[1].children.some((child) =>
			child.cls.includes('ioto-tasks-center__batch-bar-caret'),
		),
	);
});

test('常规布局分三段：全选 / 三个属性下拉 / 右贴边的删除', () => {
	const container = new FakeElement();
	renderBatchBar(
		createView({ selectedTasks: [task('a.md')], visibleTasks: [task('a.md')] }),
		container,
	);

	const bar = container.children[0];
	const groups = findByClassAll(bar, 'ioto-tasks-center__batch-bar-group');
	assert.equal(groups.length, 3);
	assert.ok(
		findByClass(bar, 'ioto-tasks-center__batch-bar-groups'),
		'三段外要有一个右贴边的容器承载',
	);

	const buttons = buttonsOf(bar);
	assert.deepEqual(
		buttons.map(labelOf),
		[
			en['view.batchBar.selectAll'],
			en['view.batchBar.menuPriority'],
			en['view.batchBar.menuStarred'],
			en['view.batchBar.menuUpTask'],
			en['view.batchBar.menuDelete'],
		],
	);

	const deleteButton = buttons.at(-1);
	assert.ok(deleteButton.cls.includes('ioto-tasks-center__batch-bar-button--danger'));
	assert.equal(deleteButton.attributes['aria-haspopup'], undefined);
	for (const button of buttons.slice(1, 4)) {
		assert.equal(button.attributes['aria-haspopup'], 'menu');
	}
});

test('全部可见任务已选时，全选按钮文案翻转为取消全选', () => {
	const tasks = [task('a.md'), task('b.md')];
	const container = new FakeElement();
	renderBatchBar(
		createView({
			selectedTasks: tasks,
			visibleTasks: tasks,
			selectedTaskPaths: new Set(tasks.map((entry) => entry.path)),
		}),
		container,
	);

	assert.equal(
		labelOf(buttonsOf(container.children[0])[0]),
		en['view.batchBar.selectAllActive'],
	);
});

test('计数取生效值 getSelectedTasks()，而不是可能虚高的 selectedTaskPaths', () => {
	const container = new FakeElement();
	renderBatchBar(
		createView({
			selectedTasks: [task('a.md'), task('b.md')],
			selectedTaskPaths: new Set(['a.md', 'b.md', 'c.md', 'd.md', 'e.md']),
		}),
		container,
	);

	const count = findByClass(
		container.children[0],
		'ioto-tasks-center__batch-bar-count',
	);
	assert.equal(count.text, en['view.batchBar.count'].replace('{0}', '2'));
	assert.ok(!count.cls.includes('is-empty'));
});

test('全选按钮恒可点，点击后走视图的既有入口', () => {
	const view = createView();
	const container = new FakeElement();
	renderBatchBar(view, container);

	const selectAllButton = buttonsOf(container.children[0])[0];
	let prevented = false;
	let stopped = false;
	selectAllButton.listeners.click({
		preventDefault() {
			prevented = true;
		},
		stopPropagation() {
			stopped = true;
		},
	});

	assert.equal(view.selectAllCalls, 1);
	assert.equal(prevented, true);
	assert.equal(stopped, true);
});

test('禁用态按钮的点击不会触发任何操作', () => {
	let opened = 0;
	const view = createView();
	const container = new FakeElement();
	renderBatchBar(view, container);

	const priorityButton = buttonsOf(container.children[0])[1];
	priorityButton.listeners.click({
		preventDefault() {},
		stopPropagation() {
			opened += 1;
		},
	});

	assert.equal(opened, 0);
});

function task(path) {
	return { path, title: path };
}

function labelOf(button) {
	return button.children[0]?.text ?? '';
}

function buttonsOf(root) {
	return findByClassAll(root, 'ioto-tasks-center__batch-bar-button').filter(
		(element) => element.cls.includes('ioto-tasks-center__batch-bar-button'),
	);
}

function findByClass(root, cls) {
	return findByClassAll(root, cls)[0] ?? null;
}

function findByClassAll(root, cls) {
	const matches = [];
	const walk = (node) => {
		for (const child of node.children ?? []) {
			if (typeof child.cls === 'string' && child.cls.split(' ').includes(cls)) {
				matches.push(child);
			}

			walk(child);
		}
	};

	walk(root);
	return matches;
}

function createView(overrides = {}) {
	return Object.assign(
		{
			isBatchEditMode: true,
			isCompactLayout: false,
			selectedTaskPaths: new Set(),
			selectedTasks: [],
			visibleTasks: [],
			selectAllCalls: 0,
			isMobileTaskListLayout() {
				return this.isCompactLayout;
			},
			getSelectedTasks() {
				return this.selectedTasks;
			},
			getVisibleTasks() {
				return this.visibleTasks;
			},
			selectAllVisibleTasks() {
				this.selectAllCalls += 1;
			},
		},
		overrides,
	);
}

class FakeElement {
	constructor({ cls = '', text = '' } = {}) {
		this.cls = cls;
		this.text = text;
		this.children = [];
		this.listeners = {};
		this.attributes = {};
	}

	createDiv(options = {}) {
		return this.append(new FakeElement(options));
	}

	createEl(_tag, options = {}) {
		return this.append(new FakeElement(options));
	}

	createSpan(options = {}) {
		return this.append(new FakeElement(options));
	}

	append(element) {
		this.children.push(element);
		return element;
	}

	addClass(cls) {
		this.cls = `${this.cls} ${cls}`.trim();
	}

	toggleClass(cls, on) {
		const classes = this.cls.split(' ').filter(Boolean);
		const has = classes.includes(cls);
		const next = on ?? !has;
		if (next && !has) {
			classes.push(cls);
		}

		if (!next && has) {
			classes.splice(classes.indexOf(cls), 1);
		}

		this.cls = classes.join(' ');
	}

	setAttribute(name, value) {
		this.attributes[name] = value;
	}

	getAttribute(name) {
		return this.attributes[name];
	}

	addEventListener(type, listener) {
		this.listeners[type] = listener;
	}
}
