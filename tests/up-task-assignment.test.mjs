import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildContentWithAssignedUpTask,
	buildContentWithRemovedUpTask,
	buildUpTaskWikilink,
} = await jiti.import('../src/tasks-center/up-task-assignment.ts');
const { validateTaskParentDrop } = await jiti.import(
	'../src/views/task-drag.ts',
);

function createTask(title, options = {}) {
	return {
		name: `${title}.md`,
		basename: title,
		title,
		path: options.path ?? `3-任务/项目A/${title}.md`,
		mtime: 0,
		ctime: 0,
		size: 0,
		status: {
			key: 'todo',
			label: '待开始',
			totalTaskCount: 0,
			completedTaskCount: 0,
			summary: '未识别到复选框任务',
		},
		upTaskTitles: options.upTaskTitles ?? [],
	};
}

test('UpTask 拖拽写入时会生成目标任务的简单 wikilink', () => {
	assert.equal(buildUpTaskWikilink('父任务'), '[[父任务]]');
});

test('已存在 UpTask 时会被新的目标任务覆盖', () => {
	const content = buildContentWithAssignedUpTask(
		'---\nUpTask:\n  - "[[旧父任务]]"\nProject:\n  - "项目A"\n---\n\n正文内容',
		'新父任务',
	);

	assert.equal(
		content,
		'---\nProject:\n  - "项目A"\nUpTask:\n  - "[[新父任务]]"\n---\n\n正文内容',
	);
});

test('拖拽移除父任务时会删除 UpTask 属性并保留其他 frontmatter', () => {
	const content = buildContentWithRemovedUpTask(
		'---\nProject:\n  - "项目A"\nUpTask:\n  - "[[旧父任务]]"\nStatus: todo\n---\n\n正文内容',
	);

	assert.equal(
		content,
		'---\nProject:\n  - "项目A"\nStatus: todo\n---\n\n正文内容',
	);
});

test('拖到自己身上会被拦截', () => {
	const tasks = [createTask('任务A')];
	assert.deepEqual(
		validateTaskParentDrop(tasks, '3-任务/项目A/任务A.md', '3-任务/项目A/任务A.md'),
		{ valid: false, reason: 'self' },
	);
});

test('拖到自己的子任务上会被拦截', () => {
	const tasks = [
		createTask('父任务'),
		createTask('子任务', { upTaskTitles: ['父任务'] }),
		createTask('孙任务', { upTaskTitles: ['子任务'] }),
	];

	assert.deepEqual(
		validateTaskParentDrop(
			tasks,
			'3-任务/项目A/父任务.md',
			'3-任务/项目A/孙任务.md',
		),
		{ valid: false, reason: 'descendant' },
	);
});

test('拖到普通目标任务上时允许建立父子关系', () => {
	const tasks = [
		createTask('父任务'),
		createTask('子任务'),
	];

	assert.deepEqual(
		validateTaskParentDrop(
			tasks,
			'3-任务/项目A/子任务.md',
			'3-任务/项目A/父任务.md',
		),
		{ valid: true },
	);
});
