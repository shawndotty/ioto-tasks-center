import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const { TFile } = await jiti.import('./stubs/obsidian.mjs');
const { shouldOpenTaskFileInTaskView } = await jiti.import(
	'../src/views/ioto-task/task-file-link-open.ts',
);

const TASKS_ROOT = '3-任务';

function decide(overrides) {
	return shouldOpenTaskFileInTaskView({
		mode: 'inherit',
		subpath: '',
		target: new TFile('3-任务/项目A/任务.md'),
		tasksRootPath: TASKS_ROOT,
		...overrides,
	});
}

test('默认设置下，任务笔记链接用任务视图打开', () => {
	assert.equal(decide({}), true);
});

test('任务根目录深层子目录的笔记仍算任务笔记', () => {
	assert.equal(
		decide({ target: new TFile('3-任务/项目A/子目录/任务.md') }),
		true,
	);
});

test('设置改为 markdown 时一律交回核心', () => {
	assert.equal(decide({ mode: 'markdown' }), false);
});

test('带标题锚点的链接交回核心', () => {
	assert.equal(decide({ subpath: '#目标' }), false);
});

test('带块锚点的链接交回核心', () => {
	assert.equal(decide({ subpath: '#^abc123' }), false);
});

test('目标未解析（笔记不存在）时交回核心以自动建文件', () => {
	assert.equal(decide({ target: null }), false);
});

test('指向任务目录之外的笔记时交回核心', () => {
	assert.equal(
		decide({ target: new TFile('4-成果/IOTO Task Center/Report/Report-x.md') }),
		false,
	);
});

test('非 markdown 附件即便在任务目录下也交回核心', () => {
	assert.equal(decide({ target: new TFile('3-任务/项目A/附件.png') }), false);
});

test('仅前缀相同的兄弟目录不算任务笔记（需要 / 分隔）', () => {
	assert.equal(decide({ target: new TFile('3-任务B/任务.md') }), false);
});
