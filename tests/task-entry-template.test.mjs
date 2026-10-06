import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });

const {
	areEntryTemplateConfigsEqual,
	buildEntryTemplateLines,
	extractEntryTemplateVariables,
	isEntryTemplateValid,
	normalizeEntryTemplate,
	normalizeEntryTemplateConfig,
	renderEntryTemplate,
} = await jiti.import('../src/tasks-center/task-entry-template.ts');

const ctx = (overrides = {}) => ({
	now: new Date(2026, 9, 6, 8, 5), // 本地时间 2026-10-06 08:05
	project: '',
	subject: '',
	...overrides,
});

/* ------------------------- 变量抽取 ------------------------- */

test('extractEntryTemplateVariables：按出现顺序 + 去重', () => {
	const vars = extractEntryTemplateVariables(
		'- [ ] {{甲}} 与 {{乙}} 再 {{甲}}',
	);
	assert.deepEqual(
		vars.map((v) => v.name),
		['甲', '乙'],
	);
});

test('extractEntryTemplateVariables：默认值 + 后续补齐默认值', () => {
	const vars = extractEntryTemplateVariables('{{甲:默认}} {{乙}} {{乙:补}}');
	assert.deepEqual(vars, [
		{ name: '甲', defaultValue: '默认' },
		{ name: '乙', defaultValue: '补' },
	]);
});

test('extractEntryTemplateVariables：排除内置名', () => {
	const vars = extractEntryTemplateVariables(
		'{{date}} {{time:HH:mm}} {{project}} {{subject}} {{cursor}}',
	);
	assert.deepEqual(vars, []);
});

test('extractEntryTemplateVariables：转义与空名不抽取', () => {
	assert.deepEqual(extractEntryTemplateVariables('\\{{甲}}'), []);
	assert.deepEqual(extractEntryTemplateVariables('{{}}'), []);
});

/* ------------------------- 求值 ------------------------- */

test('renderEntryTemplate：提示变量替换与默认值', () => {
	assert.equal(
		renderEntryTemplate('你好 {{who}}', { who: '世界' }, ctx()),
		'你好 世界',
	);
	assert.equal(renderEntryTemplate('{{who:朋友}}', {}, ctx()), '朋友');
	assert.equal(renderEntryTemplate('{{missing}}', {}, ctx()), '');
});

test('renderEntryTemplate：内置 date/time/project/subject', () => {
	assert.equal(
		renderEntryTemplate('{{date}}|{{time}}', {}, ctx()),
		'2026-10-06|08:05',
	);
	assert.equal(
		renderEntryTemplate('{{date:YYYYMMDD}} {{time:HH}}', {}, ctx()),
		'20261006 08',
	);
	assert.equal(
		renderEntryTemplate('{{project}}/{{subject}}', {}, ctx({
			project: 'IOTO',
			subject: '模板',
		})),
		'IOTO/模板',
	);
});

test('renderEntryTemplate：{{cursor}} 转成 %%Cursor%%', () => {
	assert.equal(renderEntryTemplate('前{{cursor}}后', {}, ctx()), '前%%Cursor%%后');
});

test('renderEntryTemplate：\\{{ 输出字面 {{', () => {
	assert.equal(
		renderEntryTemplate('\\{{who}}', { who: 'x' }, ctx()),
		'{{who}}',
	);
});

/* ------------------------- 缩进重定位 ------------------------- */

test('buildEntryTemplateLines：同级 / 子级缩进重定位', () => {
	const result = buildEntryTemplateLines('- [ ] 甲\n  - [ ] 乙', {
		line: '- [ ] 目标',
		indentLevel: 0,
		listMarker: '- ',
	});
	assert.deepEqual(result.lines, ['- [ ] 甲', '  - [ ] 乙']);
});

test('buildEntryTemplateLines：锚点带缩进时整体下移', () => {
	const result = buildEntryTemplateLines('- [ ] 甲\n  - [ ] 乙', {
		line: '  - [ ] 目标',
		indentLevel: 1,
		listMarker: '- ',
	});
	assert.deepEqual(result.lines, ['  - [ ] 甲', '    - [ ] 乙']);
});

test('buildEntryTemplateLines：首行沿用锚点列表符', () => {
	const result = buildEntryTemplateLines('- [ ] 甲', {
		line: '1. [ ] 目标',
		indentLevel: 0,
		listMarker: '1. ',
	});
	assert.deepEqual(result.lines, ['1. [ ] 甲']);
});

test('buildEntryTemplateLines：模板整体缩进时以最小任务行为基准', () => {
	const result = buildEntryTemplateLines('  - [ ] 甲\n    - [ ] 乙', {
		line: '- [ ] 目标',
		indentLevel: 0,
		listMarker: '- ',
	});
	assert.deepEqual(result.lines, ['- [ ] 甲', '  - [ ] 乙']);
});

test('buildEntryTemplateLines：非任务行成为续行块', () => {
	const result = buildEntryTemplateLines('- [ ] 甲\n说明文字', {
		line: '- [ ] 目标',
		indentLevel: 0,
		listMarker: '- ',
	});
	assert.deepEqual(result.lines, ['- [ ] 甲', '      说明文字']);
});

test('buildEntryTemplateLines：控制项逐字保留', () => {
	const result = buildEntryTemplateLines(
		'- [ ] 写报告 #ioto/turns/200 [model:: gpt]',
		{ line: '- [ ] 目标', indentLevel: 0, listMarker: '- ' },
	);
	assert.deepEqual(result.lines, [
		'- [ ] 写报告 #ioto/turns/200 [model:: gpt]',
	]);
});

test('buildEntryTemplateLines：%%Cursor%% 偏移换算（首行 body）', () => {
	assert.equal(
		buildEntryTemplateLines('- [ ] 写%%Cursor%%报告', {
			line: '- [ ] 目标',
			indentLevel: 0,
			listMarker: '- ',
		}).firstLineCursorOffset,
		1,
	);
	assert.equal(
		buildEntryTemplateLines('- [ ] %%Cursor%%写报告', {
			line: '- [ ] 目标',
			indentLevel: 0,
			listMarker: '- ',
		}).firstLineCursorOffset,
		0,
	);
});

test('buildEntryTemplateLines：标记不在首行 → null', () => {
	const result = buildEntryTemplateLines('- [ ] 甲\n  - [ ] 乙%%Cursor%%', {
		line: '- [ ] 目标',
		indentLevel: 0,
		listMarker: '- ',
	});
	assert.equal(result.firstLineCursorOffset, null);
});

test('buildEntryTemplateLines：无任务行 → 空结果', () => {
	const result = buildEntryTemplateLines('说明文字', {
		line: '- [ ] 目标',
		indentLevel: 0,
		listMarker: '- ',
	});
	assert.deepEqual(result.lines, []);
	assert.equal(result.firstLineCursorOffset, null);
});

/* ------------------------- 规范化 / 校验 ------------------------- */

test('normalizeEntryTemplate：裁剪空白、去空项目、可选说明', () => {
	const template = normalizeEntryTemplate({
		id: ' t1 ',
		name: ' 模板 ',
		description: '  说明  ',
		content: '- [ ] x',
		projects: [' P ', ''],
	});
	assert.deepEqual(template, {
		id: 't1',
		name: '模板',
		description: '说明',
		content: '- [ ] x',
		projects: ['P'],
	});
});

test('normalizeEntryTemplateConfig：非法输入回落默认', () => {
	const config = normalizeEntryTemplateConfig(null);
	assert.equal(config.enabled, false);
	assert.deepEqual(config.templates, []);
});

test('normalizeEntryTemplateConfig：规范化 enabled 与 templates', () => {
	const config = normalizeEntryTemplateConfig({
		enabled: true,
		templates: [{ name: 'a', content: '- [ ] x' }, null, 'bad'],
	});
	assert.equal(config.enabled, true);
	assert.equal(config.templates.length, 1);
	assert.equal(config.templates[0].name, 'a');
});

test('isEntryTemplateValid：名称与首行任务行双重校验', () => {
	assert.equal(
		isEntryTemplateValid({ id: '1', name: '', content: '- [ ] x', projects: [] }),
		false,
	);
	assert.equal(
		isEntryTemplateValid({ id: '1', name: 'a', content: '', projects: [] }),
		false,
	);
	assert.equal(
		isEntryTemplateValid({
			id: '1',
			name: 'a',
			content: '说明\n- [ ] x',
			projects: [],
		}),
		false,
	);
	assert.equal(
		isEntryTemplateValid({
			id: '1',
			name: 'a',
			content: '- [ ] x\n  续行',
			projects: [],
		}),
		true,
	);
});

test('areEntryTemplateConfigsEqual：忽略项目顺序', () => {
	const base = {
		enabled: true,
		templates: [
			{
				id: '1',
				name: 'a',
				content: '- [ ] x',
				projects: ['P', 'Q'],
			},
		],
	};
	const same = {
		enabled: true,
		templates: [
			{
				id: '1',
				name: 'a',
				content: '- [ ] x',
				projects: ['Q', 'P'],
			},
		],
	};
	assert.equal(areEntryTemplateConfigsEqual(base, same), true);
});
