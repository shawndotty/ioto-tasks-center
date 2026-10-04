import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// frontmatter 标量读写原语（[[Plan-20261004-110845]] 批次 A/H）。
// 源码经由 task-creation 间接依赖 obsidian 运行时，故按既有惯例 alias 到桩。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const {
	readScalarProperty,
	readBooleanProperty,
	upsertScalarProperty,
	writeScalarProperties,
} = await jiti.import('../src/tasks-center/frontmatter-properties.ts');

function createApp(initialContent) {
	const state = { content: initialContent };
	return {
		state,
		vault: {
			process: async (_file, transform) => {
				state.content = transform(state.content);
				return state.content;
			},
		},
	};
}

test('readScalarProperty：读顶层标量值，缺失返回 null', () => {
	const content = '---\nStarred: true\nProject: ["Demo"]\n---\n# 任务\n';
	assert.equal(readScalarProperty(content, 'Starred'), 'true');
	assert.equal(readScalarProperty(content, 'Project'), '["Demo"]');
	assert.equal(readScalarProperty(content, 'Missing'), null);
	assert.equal(readScalarProperty('# 无 frontmatter\n', 'Starred'), null);
});

test('readBooleanProperty：显式 true 为真，false / 缺失为假', () => {
	assert.equal(
		readBooleanProperty('---\niotoTaskViewOnlyPending: true\n---\n', 'iotoTaskViewOnlyPending'),
		true,
	);
	assert.equal(
		readBooleanProperty('---\niotoTaskViewOnlyPending: false\n---\n', 'iotoTaskViewOnlyPending'),
		false,
	);
	assert.equal(readBooleanProperty('# 任务\n', 'iotoTaskViewOnlyPending'), false);
});

test('upsertScalarProperty：显式 true/false，保留其他 frontmatter', () => {
	const next = upsertScalarProperty(
		'---\nProject: ["Demo"]\n---\n# 任务\n',
		'iotoTaskViewOnlyTaskBlocks',
		'true',
	);
	assert.equal(
		next,
		'---\nProject: ["Demo"]\niotoTaskViewOnlyTaskBlocks: true\n---\n# 任务\n',
	);
});

test('upsertScalarProperty：无 frontmatter 时新建包裹', () => {
	assert.equal(
		upsertScalarProperty('# 任务\n', 'iotoTaskViewOnlyPending', 'false'),
		'---\niotoTaskViewOnlyPending: false\n---\n# 任务\n',
	);
});

test('writeScalarProperties：首次补齐双 key，此后只改值、行数稳定', async () => {
	const app = createApp('---\nProject: ["Demo"]\n---\n# 任务\n');
	const file = { path: '3-任务/项目A/任务.md' };

	const first = await writeScalarProperties(app, file, {
		iotoTaskViewOnlyTaskBlocks: 'true',
		iotoTaskViewOnlyPending: 'false',
	});
	assert.equal(readBooleanProperty(first, 'iotoTaskViewOnlyTaskBlocks'), true);
	assert.equal(readBooleanProperty(first, 'iotoTaskViewOnlyPending'), false);
	const firstLines = first.split('\n').length;

	// 值改写（true → false）不得改变 frontmatter 行数
	const second = await writeScalarProperties(app, file, {
		iotoTaskViewOnlyTaskBlocks: 'false',
	});
	assert.equal(readBooleanProperty(second, 'iotoTaskViewOnlyTaskBlocks'), false);
	assert.equal(second.split('\n').length, firstLines);
	assert.equal(app.state.content, second);
});
