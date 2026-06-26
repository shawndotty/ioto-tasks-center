import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import moment from 'moment';

moment.locale('en');
const jiti = createJiti(import.meta.url, { moduleCache: false });

const {
	applyPrefix,
	buildBatchTaskTitleForUpTask,
	createBatchTemplateId,
	isBatchTemplateValid,
	isBatchTaskType,
	normalizeBatchTemplateConfig,
	normalizeBatchTemplate,
	parseBatchList,
	formatBatchItemsForPreview,
	areBatchTemplateConfigsEqual,
} = await jiti.import(
	'../src/tasks-center/batch-task-template.ts',
);

test('parseBatchList 解析平级列表', () => {
	const items = parseBatchList('- 任务一\n- 任务二\n- 任务三');
	assert.equal(items.length, 3);
	assert.deepEqual(
		items.map((item) => item.name),
		['任务一', '任务二', '任务三'],
	);
	for (const item of items) {
		assert.equal(item.level, 0);
		assert.equal(item.parentIndex, null);
	}
});

test('parseBatchList 解析一级父子关系', () => {
	const content = '- 父任务\n    - 子任务A\n    - 子任务B\n- 另一个父任务';
	const items = parseBatchList(content);
	assert.equal(items.length, 4);
	assert.equal(items[0].name, '父任务');
	assert.equal(items[0].level, 0);
	assert.equal(items[0].parentIndex, null);
	assert.equal(items[1].name, '子任务A');
	assert.equal(items[1].level, 1);
	assert.equal(items[1].parentIndex, 0);
	assert.equal(items[2].name, '子任务B');
	assert.equal(items[2].level, 1);
	assert.equal(items[2].parentIndex, 0);
	assert.equal(items[3].name, '另一个父任务');
	assert.equal(items[3].level, 0);
	assert.equal(items[3].parentIndex, null);
});

test('parseBatchList 解析多级嵌套', () => {
	const content =
		'- L0\n    - L1-a\n        - L2\n    - L1-b\n- L0-2';
	const items = parseBatchList(content);
	assert.equal(items.length, 5);
	assert.equal(items[0].level, 0);
	assert.equal(items[0].parentIndex, null);
	assert.equal(items[1].level, 1);
	assert.equal(items[1].parentIndex, 0);
	assert.equal(items[2].level, 2);
	assert.equal(items[2].parentIndex, 1);
	assert.equal(items[3].level, 1);
	assert.equal(items[3].parentIndex, 0);
	assert.equal(items[4].level, 0);
	assert.equal(items[4].parentIndex, null);
});

test('parseBatchList 支持 tab 与空格混用', () => {
	const content = '- 父\n\t- 子（tab 缩进）\n    - 子（空格缩进）';
	const items = parseBatchList(content);
	assert.equal(items.length, 3);
	assert.equal(items[0].level, 0);
	assert.equal(items[1].level, 1);
	assert.equal(items[1].parentIndex, 0);
	assert.equal(items[2].level, 1);
	assert.equal(items[2].parentIndex, 0);
});

test('parseBatchList 忽略空行与非列表行', () => {
	const content =
		'- 任务一\n\n这是一段普通文本，不是列表项。\n- 任务二\n';
	const items = parseBatchList(content);
	assert.equal(items.length, 2);
	assert.deepEqual(
		items.map((item) => item.name),
		['任务一', '任务二'],
	);
});

test('parseBatchList 忽略空名列表项', () => {
	const content = '- 任务一\n-   \n- 任务二';
	const items = parseBatchList(content);
	assert.equal(items.length, 2);
	assert.deepEqual(
		items.map((item) => item.name),
		['任务一', '任务二'],
	);
});

test('parseBatchList 空内容返回空数组', () => {
	assert.deepEqual(parseBatchList(''), []);
	assert.deepEqual(parseBatchList(null), []);
	assert.deepEqual(parseBatchList(undefined), []);
});

test('parseBatchList 去除任务名首尾空格', () => {
	const items = parseBatchList('-   带空格的任务名   ');
	assert.equal(items.length, 1);
	assert.equal(items[0].name, '带空格的任务名');
});

test('applyPrefix 空前缀返回原名', () => {
	assert.equal(applyPrefix('任务A', ''), '任务A');
});

test('applyPrefix 非空前缀拼接', () => {
	assert.equal(applyPrefix('任务A', 'Sprint1-'), 'Sprint1-任务A');
});

test('formatBatchItemsForPreview 按层级输出缩进文本', () => {
	const items = parseBatchList('- 父\n    - 子');
	const preview = formatBatchItemsForPreview(items, '前缀-');
	assert.equal(preview.length, 2);
	assert.equal(preview[0].indent, 0);
	assert.equal(preview[0].text, '前缀-父');
	assert.equal(preview[1].indent, 1);
	assert.equal(preview[1].text, '前缀-子');
});

test('isBatchTaskType 仅接受 normal/topic/plan', () => {
	assert.equal(isBatchTaskType('normal'), true);
	assert.equal(isBatchTaskType('topic'), true);
	assert.equal(isBatchTaskType('plan'), true);
	assert.equal(isBatchTaskType('date'), false);
	assert.equal(isBatchTaskType('unknown'), false);
	assert.equal(isBatchTaskType(null), false);
});

test('createBatchTemplateId 返回非空字符串', () => {
	const id = createBatchTemplateId();
	assert.equal(typeof id, 'string');
	assert.ok(id.length > 0);
});

test('createBatchTemplateId 多次调用返回不同值', () => {
	const ids = new Set();
	for (let i = 0; i < 100; i += 1) {
		ids.add(createBatchTemplateId());
	}
	assert.equal(ids.size, 100);
});

test('normalizeBatchTemplate 合法对象保留字段', () => {
	const template = normalizeBatchTemplate({
		id: 'fixed-id',
		name: '入职 SOP',
		taskType: 'normal',
		listContent: '- 任务一',
	});
	assert.deepEqual(template, {
		id: 'fixed-id',
		name: '入职 SOP',
		taskType: 'normal',
		listContent: '- 任务一',
	});
});

test('normalizeBatchTemplate 非法 taskType 回退为 normal', () => {
	const template = normalizeBatchTemplate({
		name: '测试',
		taskType: 'date',
		listContent: '- 任务',
	});
	assert.equal(template.taskType, 'normal');
});

test('normalizeBatchTemplate 缺失 id 时自动生成', () => {
	const template = normalizeBatchTemplate({
		name: '测试',
		listContent: '- 任务',
	});
	assert.ok(template.id.length > 0);
});

test('normalizeBatchTemplate 非对象输入返回 null', () => {
	assert.equal(normalizeBatchTemplate(null), null);
	assert.equal(normalizeBatchTemplate('字符串'), null);
	assert.equal(normalizeBatchTemplate(123), null);
});

test('normalizeBatchTemplateConfig 非对象返回默认值', () => {
	const config = normalizeBatchTemplateConfig(null);
	assert.equal(config.enabled, false);
	assert.deepEqual(config.templates, []);
});

test('normalizeBatchTemplateConfig 合法对象保留', () => {
	const config = normalizeBatchTemplateConfig({
		enabled: true,
		templates: [
			{
				id: 't1',
				name: '模板一',
				taskType: 'topic',
				listContent: '- 任务',
			},
		],
	});
	assert.equal(config.enabled, true);
	assert.equal(config.templates.length, 1);
	assert.equal(config.templates[0].name, '模板一');
});

test('normalizeBatchTemplateConfig 缺失 enabled 回退为 false', () => {
	const config = normalizeBatchTemplateConfig({
		templates: [],
	});
	assert.equal(config.enabled, false);
});

test('normalizeBatchTemplateConfig templates 非数组时回退为空数组', () => {
	const config = normalizeBatchTemplateConfig({
		enabled: true,
		templates: '不是数组',
	});
	assert.deepEqual(config.templates, []);
});

test('normalizeBatchTemplateConfig 过滤无效模板条目', () => {
	const config = normalizeBatchTemplateConfig({
		enabled: true,
		templates: [
			{ id: 't1', name: '有效', taskType: 'normal', listContent: '- x' },
			null,
			'string',
			{ name: '无 id 但有效', taskType: 'plan', listContent: '- y' },
		],
	});
	assert.equal(config.templates.length, 2);
	assert.deepEqual(
		config.templates.map((t) => t.name),
		['有效', '无 id 但有效'],
	);
});

test('isBatchTemplateValid 合法模板返回 true', () => {
	assert.equal(
		isBatchTemplateValid({
			id: 't1',
			name: '入职 SOP',
			taskType: 'normal',
			listContent: '- 任务一\n- 任务二',
		}),
		true,
	);
});

test('isBatchTemplateValid 空 name 返回 false', () => {
	assert.equal(
		isBatchTemplateValid({
			id: 't1',
			name: '   ',
			taskType: 'normal',
			listContent: '- 任务',
		}),
		false,
	);
});

test('isBatchTemplateValid 空 listContent 返回 false', () => {
	assert.equal(
		isBatchTemplateValid({
			id: 't1',
			name: '模板',
			taskType: 'normal',
			listContent: '',
		}),
		false,
	);
});

test('isBatchTemplateValid 仅含非列表文本的 content 返回 false', () => {
	assert.equal(
		isBatchTemplateValid({
			id: 't1',
			name: '模板',
			taskType: 'normal',
			listContent: '这是普通文本，没有列表项',
		}),
		false,
	);
});

test('buildBatchTaskTitleForUpTask normal 类型等于 customName', () => {
	const title = buildBatchTaskTitleForUpTask('项目A', 'normal', '任务名');
	assert.equal(title, '任务名');
});

test('buildBatchTaskTitleForUpTask plan 类型包含项目名与类型标签', () => {
	const title = buildBatchTaskTitleForUpTask('项目A', 'plan', '阶段一');
	assert.equal(title, '项目A-Plan-阶段一');
});

test('buildBatchTaskTitleForUpTask topic 类型包含项目名与类型标签', () => {
	const title = buildBatchTaskTitleForUpTask('项目A', 'topic', '发布复盘');
	assert.equal(title, '项目A-Subject-发布复盘');
});

test('areBatchTemplateConfigsEqual 相同配置返回 true', () => {
	const config = {
		enabled: true,
		templates: [
			{
				id: 't1',
				name: 'A',
				taskType: 'normal',
				listContent: '- x',
			},
		],
	};
	assert.equal(
		areBatchTemplateConfigsEqual(config, {
			enabled: true,
			templates: [
				{
					id: 't1',
					name: 'A',
					taskType: 'normal',
					listContent: '- x',
				},
			],
		}),
		true,
	);
});

test('areBatchTemplateConfigsEqual enabled 不同返回 false', () => {
	assert.equal(
		areBatchTemplateConfigsEqual(
			{ enabled: true, templates: [] },
			{ enabled: false, templates: [] },
		),
		false,
	);
});

test('areBatchTemplateConfigsEqual 模板数量不同返回 false', () => {
	assert.equal(
		areBatchTemplateConfigsEqual(
			{
				enabled: true,
				templates: [
					{
						id: 't1',
						name: 'A',
						taskType: 'normal',
						listContent: '- x',
					},
				],
			},
			{ enabled: true, templates: [] },
		),
		false,
	);
});
