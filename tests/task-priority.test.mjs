import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	getPriorityFromContent,
	parsePriorityFrontmatterValue,
	resolvePriorityFromSources,
} = await jiti.import('../src/tasks-center/data.ts');
const {
	clearTaskFilePriority,
	isTaskPriorityValue,
	setTaskFilePriority,
	TASK_PRIORITY_VALUES,
} = await jiti.import('../src/tasks-center/task-priority.ts');

test('Priority 整数值可正常解析', () => {
	assert.equal(parsePriorityFrontmatterValue(0), 0);
	assert.equal(parsePriorityFrontmatterValue(1), 1);
	assert.equal(parsePriorityFrontmatterValue(2), 2);
	assert.equal(parsePriorityFrontmatterValue(3), 3);
	assert.equal(parsePriorityFrontmatterValue(4), 4);
	assert.equal(parsePriorityFrontmatterValue(5), 5);
});

test('Priority 字符串数字可正常解析', () => {
	assert.equal(parsePriorityFrontmatterValue('2'), 2);
	assert.equal(parsePriorityFrontmatterValue(' 4 '), 4);
	assert.equal(parsePriorityFrontmatterValue('"5"'), 5);
});

test('非法 Priority 值会返回 undefined', () => {
	assert.equal(parsePriorityFrontmatterValue(''), undefined);
	assert.equal(parsePriorityFrontmatterValue('   '), undefined);
	assert.equal(parsePriorityFrontmatterValue('1.5'), undefined);
	assert.equal(parsePriorityFrontmatterValue(-1), undefined);
	assert.equal(parsePriorityFrontmatterValue('abc'), undefined);
	assert.equal(parsePriorityFrontmatterValue([]), undefined);
});

test('可从 frontmatter 内容中解析 Priority', () => {
	assert.equal(getPriorityFromContent(`---\nPriority: 2\n---\n# 任务\n`), 2);
	assert.equal(
		getPriorityFromContent(`---\nPriority: "3"\n---\n# 任务\n`),
		3,
	);
});

test('frontmatter 内容中的 Priority 优先于 metadata cache', () => {
	assert.equal(
		resolvePriorityFromSources({
			content: `---\nPriority: 1\n---\n正文`,
			metadataValue: 5,
		}),
		1,
	);
});

test('缺少内容时会回退到 metadata cache Priority', () => {
	assert.equal(
		resolvePriorityFromSources({
			metadataValue: '4',
		}),
		4,
	);
});

test('TASK_PRIORITY_VALUES 仅包含 P0 到 P3', () => {
	assert.deepEqual(TASK_PRIORITY_VALUES, [0, 1, 2, 3]);
	assert.equal(isTaskPriorityValue(0), true);
	assert.equal(isTaskPriorityValue(3), true);
	assert.equal(isTaskPriorityValue(4), false);
	assert.equal(isTaskPriorityValue(-1), false);
});

test('设置 Priority 时会创建属性且保留其他 frontmatter', async () => {
	const app = createPriorityApp(
		'---\nProject:\n  - "项目A"\nSubject:\n  - "发布复盘"\n---\n# 任务\n',
	);

	await setTaskFilePriority(app, { path: '3-任务/项目A/任务.md' }, 3);

	assert.equal(
		app.state.content,
		'---\nProject:\n  - "项目A"\nSubject:\n  - "发布复盘"\nPriority: 3\n---\n# 任务\n',
	);
});

test('设置 Priority 时会覆盖原有值', async () => {
	const app = createPriorityApp(
		'---\nProject:\n  - "项目A"\nPriority: 7\n---\n# 任务\n',
	);

	await setTaskFilePriority(app, { path: '3-任务/项目A/任务.md' }, 1);

	assert.equal(
		app.state.content,
		'---\nProject:\n  - "项目A"\nPriority: 1\n---\n# 任务\n',
	);
});

test('取消 Priority 时会移除该属性且保留其他 frontmatter', async () => {
	const app = createPriorityApp(
		'---\nProject:\n  - "项目A"\nPriority: 5\nUpTask:\n  - "父任务"\n---\n# 任务\n',
	);

	await clearTaskFilePriority(app, { path: '3-任务/项目A/任务.md' });

	assert.equal(
		app.state.content,
		'---\nProject:\n  - "项目A"\nUpTask:\n  - "父任务"\n---\n# 任务\n',
	);
});

function createPriorityApp(initialContent) {
	const state = {
		content: initialContent,
	};
	return {
		state,
		vault: {
			read: async () => state.content,
			modify: async (_file, nextContent) => {
				state.content = nextContent;
			},
		},
	};
}
