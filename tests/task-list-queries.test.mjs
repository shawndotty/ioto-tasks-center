import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { areAllVisibleTasksSelected, selectAllVisibleTasks } = await jiti.import(
	'../src/views/tasks-center/task-list-queries.ts',
);

test('areAllVisibleTasksSelected：空列表判否', () => {
	assert.equal(areAllVisibleTasksSelected(createView([], [])), false);
});

test('areAllVisibleTasksSelected：只选了一部分判否', () => {
	const view = createView(['a.md', 'b.md'], ['a.md']);
	assert.equal(areAllVisibleTasksSelected(view), false);
});

test('areAllVisibleTasksSelected：可见任务全选判是', () => {
	const view = createView(['a.md', 'b.md'], ['a.md', 'b.md']);
	assert.equal(areAllVisibleTasksSelected(view), true);
});

test('selectAllVisibleTasks：未全选时补齐，已全选时清空', () => {
	const view = createView(['a.md', 'b.md'], []);
	selectAllVisibleTasks(view);
	assert.deepEqual([...view.selectedTaskPaths], ['a.md', 'b.md']);

	const rerendered = view.renderCalls;
	selectAllVisibleTasks(view);
	assert.deepEqual([...view.selectedTaskPaths], []);
	assert.equal(view.renderCalls, rerendered + 1);
});

function createView(visiblePaths, selectedPaths) {
	const tasks = visiblePaths.map((path) => ({ path, title: path }));
	const view = {
		selectedTaskPaths: new Set(selectedPaths),
		renderCalls: 0,
		getVisibleTasks: () => tasks,
		render() {
			view.renderCalls += 1;
		},
	};
	return view;
}
