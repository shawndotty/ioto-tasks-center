import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// task-operations 间接依赖 obsidian 运行时，按既有惯例 alias 到桩。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { getAddTaskButtonTooltip } = await jiti.import(
	'../src/views/tasks-center/task-operations.ts',
);

const HINT = ' (Shift+click: batch create from template)';

function makeView({ enabled, templates, ...overrides } = {}) {
	return {
		isCreatingTask: false,
		selectedProject: 'ProjectA',
		isProjectsLoading: false,
		isTasksLoading: false,
		getBatchTemplateConfig: () => ({
			enabled: enabled ?? true,
			templates: templates ?? [{ name: 'tpl' }],
		}),
		...overrides,
	};
}

test('有可用模板时 title 追加 Shift 提示', () => {
	const tooltip = getAddTaskButtonTooltip(makeView());
	assert.ok(tooltip.endsWith(HINT), `expected hint suffix, got: ${tooltip}`);
	assert.equal(tooltip, `Add task in ProjectA${HINT}`);
});

test('未启用批量创建时 title 不含提示', () => {
	const tooltip = getAddTaskButtonTooltip(makeView({ enabled: false }));
	assert.equal(tooltip, 'Add task in ProjectA');
});

test('启用但 0 个模板时 title 不含提示', () => {
	const tooltip = getAddTaskButtonTooltip(makeView({ templates: [] }));
	assert.equal(tooltip, 'Add task in ProjectA');
});
