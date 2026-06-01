import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildSelectedTextSubtaskWikilink,
	normalizeSelectedSubtaskDisplayText,
	normalizeSelectedSubtaskName,
	resolveCurrentTaskContext,
	resolveSelectedSubtaskTargetPath,
} = await jiti.import('../src/tasks-center/selected-text-subtask.ts');

test('选中文本会折叠换行并归一化为普通任务名称', () => {
	assert.equal(
		normalizeSelectedSubtaskName('  阶段一\n\n需要推进  '),
		'阶段一 需要推进',
	);
});

test('非法路径字符会在子任务名称中被替换', () => {
	assert.equal(
		normalizeSelectedSubtaskName('计划/主题: 阶段一'),
		'计划-主题- 阶段一',
	);
});

test('选中文本展示内容会折叠空白，便于替换为单个 wikilink', () => {
	assert.equal(
		normalizeSelectedSubtaskDisplayText('  阶段一 \n\n 需要推进  '),
		'阶段一 需要推进',
	);
});

test('文件名与选中文本一致时，生成简洁 wikilink', () => {
	assert.equal(
		buildSelectedTextSubtaskWikilink({
			linktext: '阶段一 需要推进',
			selectedText: '阶段一 需要推进',
		}),
		'[[阶段一 需要推进]]',
	);
});

test('特殊字符导致文件名变化时，生成带 alias 的可跳转 wikilink', () => {
	assert.equal(
		buildSelectedTextSubtaskWikilink({
			linktext: '计划-主题- 阶段一',
			selectedText: '计划/主题: 阶段一',
		}),
		'[[计划-主题- 阶段一|计划/主题: 阶段一]]',
	);
});

test('当前任务文件路径可解析出项目名、当前目录和父任务标题', () => {
	const file = {
		path: '3-任务/项目A/子目录/父任务.md',
		basename: '父任务',
		parent: {
			path: '3-任务/项目A/子目录',
		},
	};

	assert.deepEqual(resolveCurrentTaskContext(file, '3-任务'), {
		projectName: '项目A',
		currentDirectoryPath: '3-任务/项目A/子目录',
		parentTaskTitle: '父任务',
	});
});

test('不在任务根目录下的文件会被拒绝', () => {
	const file = {
		path: '2-项目/项目A/父任务.md',
		basename: '父任务',
		parent: {
			path: '2-项目/项目A',
		},
	};

	assert.throws(
		() => resolveCurrentTaskContext(file, '3-任务'),
		/当前文件不在任务根目录下/,
	);
});

test('选中文本可解析出当前目录下的普通任务目标路径', () => {
	const file = {
		path: '3-任务/项目A/子目录/父任务.md',
		basename: '父任务',
		parent: {
			path: '3-任务/项目A/子目录',
		},
	};

	assert.equal(
		resolveSelectedSubtaskTargetPath({
			tasksRootPath: '3-任务',
			file,
			selection: '阶段一\n拆分',
			dateTaskDateFormat: 'YYYY-MM-DD',
		}),
		'3-任务/项目A/子目录/阶段一 拆分.md',
	);
});

test('选中文本归一化后为空时，不会生成目标路径', () => {
	const file = {
		path: '3-任务/项目A/父任务.md',
		basename: '父任务',
		parent: {
			path: '3-任务/项目A',
		},
	};

	assert.equal(
		resolveSelectedSubtaskTargetPath({
			tasksRootPath: '3-任务',
			file,
			selection: '   \n   ',
			dateTaskDateFormat: 'YYYY-MM-DD',
		}),
		null,
	);
});
