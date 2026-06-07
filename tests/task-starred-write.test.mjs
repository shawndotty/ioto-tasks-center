import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	clearTaskFileStarred,
	setTaskFileStarred,
} = await jiti.import('../src/tasks-center/task-starred.ts');

test('设置 Starred 时会创建属性且保留其他 frontmatter', async () => {
	const app = createStarredApp(
		'---\nProject:\n  - "项目A"\nSubject:\n  - "发布复盘"\n---\n# 任务\n',
	);

	await setTaskFileStarred(app, { path: '3-任务/项目A/任务.md' });

	assert.equal(
		app.state.content,
		'---\nProject:\n  - "项目A"\nSubject:\n  - "发布复盘"\nStarred: true\n---\n# 任务\n',
	);
});

test('设置 Starred 时会创建 frontmatter', async () => {
	const app = createStarredApp('# 任务\n');

	await setTaskFileStarred(app, { path: '3-任务/项目A/任务.md' });

	assert.equal(app.state.content, '---\nStarred: true\n---\n# 任务\n');
});

test('设置 Starred 时会覆盖原有值', async () => {
	const app = createStarredApp(
		'---\nProject:\n  - "项目A"\nStarred: false\n---\n# 任务\n',
	);

	await setTaskFileStarred(app, { path: '3-任务/项目A/任务.md' });

	assert.equal(
		app.state.content,
		'---\nProject:\n  - "项目A"\nStarred: true\n---\n# 任务\n',
	);
});

test('取消 Starred 时会移除该属性且保留其他 frontmatter', async () => {
	const app = createStarredApp(
		'---\nProject:\n  - "项目A"\nStarred: true\nUpTask:\n  - "父任务"\n---\n# 任务\n',
	);

	await clearTaskFileStarred(app, { path: '3-任务/项目A/任务.md' });

	assert.equal(
		app.state.content,
		'---\nProject:\n  - "项目A"\nUpTask:\n  - "父任务"\n---\n# 任务\n',
	);
});

test('取消 Starred 后若 frontmatter 为空则清理 frontmatter 包裹', async () => {
	const app = createStarredApp('---\nStarred: true\n---\n# 任务\n');

	await clearTaskFileStarred(app, { path: '3-任务/项目A/任务.md' });

	assert.equal(app.state.content, '# 任务\n');
});

function createStarredApp(initialContent) {
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
