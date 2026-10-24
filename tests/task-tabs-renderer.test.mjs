import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/task-tabs-obsidian.mjs', import.meta.url).pathname,
	},
});
const { renderTaskTabs } = await jiti.import(
	'../src/views/tasks-center/task-tabs-renderer.ts',
);

test('regular tabs show the batch edit button before presentation settings', () => {
	const container = new FakeElement();
	renderTaskTabs(createView(), container);

	const settings = container.children[0].children[1];
	const [batchEditButton, settingsButton] = settings.children;

	assert.equal(batchEditButton.cls, 'ioto-tasks-center__tab-batch-edit-button');
	assert.equal(batchEditButton.type, 'button');
	assert.ok(batchEditButton.ariaLabel);
	assert.equal(batchEditButton.title, batchEditButton.ariaLabel);
	assert.equal(batchEditButton.iconName, 'check-square');
	assert.equal(settingsButton.cls, 'ioto-tasks-center__tab-settings-button');
});

test('batch edit button delegates to the existing toggle and settings still opens its menu', () => {
	const container = new FakeElement();
	const view = createView();
	renderTaskTabs(view, container);

	const settings = container.children[0].children[1];
	settings.children[0].listeners.click();
	const event = { source: 'settings-button' };
	settings.children[1].listeners.click(event);

	assert.equal(view.toggleCalls, 1);
	assert.equal(view.settingsEvent, event);
});

test('batch edit button is hidden while batch edit mode is active', () => {
	const container = new FakeElement();
	renderTaskTabs(createView({ isBatchEditMode: true }), container);

	const settings = container.children[0].children[1];
	assert.deepEqual(
		settings.children.map((button) => button.cls),
		['ioto-tasks-center__tab-settings-button'],
	);
});

test('compact layout also shows the batch edit button before presentation settings', () => {
	const container = new FakeElement();
	renderTaskTabs(createView({ isCompactLayout: true }), container);

	const settings = container.children[0].children[1];
	assert.equal(settings.children[0].cls, 'ioto-tasks-center__tab-batch-edit-button');
	assert.equal(settings.children[1].cls, 'ioto-tasks-center__tab-settings-button');
});

function createView(overrides = {}) {
	return {
		isBatchEditMode: false,
		isCompactLayout: false,
		activeTaskFilterTab: 'core',
		toggleCalls: 0,
		settingsEvent: null,
		getVisibleTaskFilterTabs: () => [
			{ key: 'core', label: 'Core' },
			{ key: 'all', label: 'All' },
		],
		getTaskFilterCounts: () => ({ core: 1, all: 2 }),
		getTaskFilterSwitcherLabel: () => 'Filter tasks',
		toggleBatchEditMode() {
			this.toggleCalls += 1;
		},
		showTaskPresentationMenu(event) {
			this.settingsEvent = event;
		},
		...overrides,
	};
}

class FakeElement {
	constructor({ cls = '', text = '' } = {}) {
		this.cls = cls;
		this.text = text;
		this.children = [];
		this.listeners = {};
		this.dataset = {};
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

	addEventListener(type, listener) {
		this.listeners[type] = listener;
	}
}
