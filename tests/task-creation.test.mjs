import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import moment from 'moment';

moment.locale('en');
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildTaskFileName,
	buildListPropertyFrontmatterLines,
	buildListPropertyFrontmatter,
	buildProjectPropertyFrontmatter,
	extractListPropertyValuesFromContent,
	getTemplaterCommandId,
	normalizeDateTaskFileNameSegment,
	normalizeCustomTaskName,
	removeListProperty,
	resolveValidDateTaskDateFormat,
	resolveTaskTargetPath,
	upsertListProperty,
	upsertListPropertyValues,
	upsertProjectProperty,
} = await jiti.import('../src/tasks-center/task-creation.ts');
const {
	mergeTaskTemplateConfig,
	normalizeTaskTemplateConfigMap,
	resolveTaskTemplateSource,
} = await jiti.import('../src/tasks-center/task-template-config.ts');

const FIXED_LOCAL_DATE = new Date(2026, 4, 30, 12, 0, 0);

test('默认日期格式仍生成 项目名-YYYY-MM-DD.md', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'date',
		FIXED_LOCAL_DATE,
		'YYYY-MM-DD',
	);

	assert.equal(fileName, '项目A-2026-05-30.md');
});

test('自定义日期格式会生成对应的日期任务文件名', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'date',
		FIXED_LOCAL_DATE,
		'YYYY年MM月DD日',
	);

	assert.equal(fileName, '项目A-2026年05月30日.md');
});

test('支持 [] 语法与中文字符混排的日期格式', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'date',
		FIXED_LOCAL_DATE,
		'[截止] YYYY-MM-DD',
	);

	assert.equal(fileName, '项目A-截止 2026-05-30.md');
});

test('时间格式中的非法文件名字符会被替换为 -', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'date',
		FIXED_LOCAL_DATE,
		'YYYY-MM-DD HH:mm',
	);

	assert.equal(fileName, '项目A-2026-05-30 12-00.md');
});

test('日期格式中的路径分隔符会被替换为 -', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'date',
		FIXED_LOCAL_DATE,
		'YYYY/MM/DD',
	);

	assert.equal(fileName, '项目A-2026-05-30.md');
});

test('plan 任务命名符合 项目名-Plan-名称.md 规则', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'plan',
		FIXED_LOCAL_DATE,
		'YYYY-MM-DD',
		'阶段一',
	);

	assert.equal(fileName, '项目A-Plan-阶段一.md');
});

test('topic 任务命名符合 项目名-Subject-名称.md 规则', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'topic',
		FIXED_LOCAL_DATE,
		'YYYY-MM-DD',
		'发布复盘',
	);

	assert.equal(fileName, '项目A-Subject-发布复盘.md');
});

test('普通任务命名符合 用户输入名称.md 规则', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'normal',
		FIXED_LOCAL_DATE,
		'YYYY-MM-DD',
		'发布复盘',
	);

	assert.equal(fileName, '发布复盘.md');
});

test('plan 和 topic 任务名称为空时会抛出错误', () => {
	assert.throws(
		() =>
			buildTaskFileName(
				'项目A',
				'plan',
				FIXED_LOCAL_DATE,
				'YYYY-MM-DD',
				'   ',
			),
		/Task name cannot be empty/,
	);

	assert.throws(
		() =>
			buildTaskFileName(
				'项目A',
				'topic',
				FIXED_LOCAL_DATE,
				'YYYY-MM-DD',
				'',
			),
		/Task name cannot be empty/,
	);

	assert.throws(
		() =>
			buildTaskFileName(
				'项目A',
				'normal',
				FIXED_LOCAL_DATE,
				'YYYY-MM-DD',
				'   ',
			),
		/Task name cannot be empty/,
	);
});

test('空白日期格式会回退到默认值', () => {
	assert.equal(resolveValidDateTaskDateFormat('   '), 'YYYY-MM-DD');
});

test('非空日期格式会按原样保留', () => {
	assert.equal(
		resolveValidDateTaskDateFormat('[invalid-format]'),
		'[invalid-format]',
	);
});

test('日期文件名片段归一化会替换非法字符并折叠分隔符', () => {
	assert.equal(
		normalizeDateTaskFileNameSegment(' 2026/05/30 12:00 '),
		'2026-05-30 12-00',
	);
	assert.equal(normalizeDateTaskFileNameSegment('////'), '');
});

test('任务名称归一化会折叠空白并替换非法字符', () => {
	assert.equal(normalizeCustomTaskName('  阶段   一  '), '阶段 一');
	assert.equal(normalizeCustomTaskName('计划/主题'), '计划-主题');
	assert.equal(normalizeCustomTaskName('   '), null);
});

test('任务目标路径会落在自定义任务根目录/项目名/文件名 下', () => {
	const targetPath = resolveTaskTargetPath(
		'工作区/任务',
		'项目A',
		'项目A-Plan-阶段一.md',
	);

	assert.equal(targetPath, '工作区/任务/项目A/项目A-Plan-阶段一.md');
});

test('Templater 命令 ID 生成规则正确', () => {
	const commandId = getTemplaterCommandId(
		'0-辅助/IOTO/Templates/任务模板.md',
	);

	assert.equal(
		commandId,
		'templater-obsidian:0-辅助/IOTO/Templates/任务模板.md',
	);
});

test('inline 模式会解析为直接写入的模板内容', () => {
	const resolved = resolveTaskTemplateSource({
		sourceMode: 'inline',
		templatePath: '0-辅助/不会使用.md',
		inlineContent: '# 新任务\n\n这里是模板正文',
	});

	assert.deepEqual(resolved, {
		kind: 'inline',
		inlineContent: '# 新任务\n\n这里是模板正文',
	});
});

test('inline 模式内容为空白时会回退为空模板', () => {
	const resolved = resolveTaskTemplateSource({
		sourceMode: 'inline',
		templatePath: '',
		inlineContent: '   \n',
	});

	assert.deepEqual(resolved, { kind: 'none' });
});

test('file 模式路径为空时会回退为空模板', () => {
	const resolved = resolveTaskTemplateSource({
		sourceMode: 'file',
		templatePath: '   ',
		inlineContent: '# 不会使用',
	});

	assert.deepEqual(resolved, { kind: 'none' });
});

test('旧 taskTemplatePath 会迁移到四种任务类型的 file 模式', () => {
	const configMap = normalizeTaskTemplateConfigMap(
		undefined,
		'0-辅助/IOTO/Templates/任务模板.md',
	);

	assert.deepEqual(configMap.date, {
		sourceMode: 'file',
		templatePath: '0-辅助/IOTO/Templates/任务模板.md',
		inlineContent: '',
	});
	assert.deepEqual(configMap.plan, {
		sourceMode: 'file',
		templatePath: '0-辅助/IOTO/Templates/任务模板.md',
		inlineContent: '',
	});
	assert.deepEqual(configMap.topic, {
		sourceMode: 'file',
		templatePath: '0-辅助/IOTO/Templates/任务模板.md',
		inlineContent: '',
	});
	assert.deepEqual(configMap.normal, {
		sourceMode: 'file',
		templatePath: '0-辅助/IOTO/Templates/任务模板.md',
		inlineContent: '',
	});
});

test('新结构已存在配置时，不再被旧 taskTemplatePath 覆盖', () => {
	const configMap = normalizeTaskTemplateConfigMap(
		{
			date: {
				sourceMode: 'inline',
				templatePath: '',
				inlineContent: '# 日期模板',
			},
		},
		'0-辅助/IOTO/Templates/任务模板.md',
	);

	assert.deepEqual(configMap.date, {
		sourceMode: 'inline',
		templatePath: '',
		inlineContent: '# 日期模板',
	});
	assert.deepEqual(configMap.plan, {
		sourceMode: 'file',
		templatePath: '',
		inlineContent: '',
	});
});

test('合并模板配置时会保留未修改字段，避免输入内容被后续切换覆盖', () => {
	const merged = mergeTaskTemplateConfig(
		{
			sourceMode: 'file',
			templatePath: '',
			inlineContent: '# 普通任务模板',
		},
		{
			sourceMode: 'inline',
		},
	);

	assert.deepEqual(merged, {
		sourceMode: 'inline',
		templatePath: '',
		inlineContent: '# 普通任务模板',
	});
});

test('Project 属性 frontmatter 会使用单项 List 格式', () => {
	const frontmatter = buildProjectPropertyFrontmatter('项目A');

	assert.equal(frontmatter, 'Project:\n  - "项目A"');
});

test('通用 List 属性 frontmatter 会按属性名和值生成', () => {
	const frontmatter = buildListPropertyFrontmatter('Subject', '发布复盘');

	assert.equal(frontmatter, 'Subject:\n  - "发布复盘"');
});

test('多值 List 属性 frontmatter 会为每个值生成列表项', () => {
	assert.deepEqual(
		buildListPropertyFrontmatterLines('Project', ['项目A', '项目B']),
		['Project:', '  - "项目A"', '  - "项目B"'],
	);
});

test('空内容会自动插入 Project 属性 frontmatter', () => {
	const content = upsertProjectProperty('', '项目A');

	assert.equal(content, '---\nProject:\n  - "项目A"\n---\n');
});

test('已有 frontmatter 且无 Project 时会补入 Project 属性', () => {
	const content = upsertProjectProperty(
		'---\nStatus: todo\n---\n\n正文内容',
		'项目A',
	);

	assert.equal(
		content,
		'---\nStatus: todo\nProject:\n  - "项目A"\n---\n\n正文内容',
	);
});

test('已有 Project 单值时会覆盖为当前项目的 List', () => {
	const content = upsertProjectProperty(
		'---\nProject: 旧项目\nStatus: todo\n---\n',
		'项目A',
	);

	assert.equal(content, '---\nStatus: todo\nProject:\n  - "项目A"\n---\n');
});

test('已有 Project List 时会覆盖为仅包含当前项目的单项 List', () => {
	const content = upsertProjectProperty(
		'---\nProject:\n  - 旧项目A\n  - 旧项目B\nStatus: todo\n---\n\n正文内容',
		'项目A',
	);

	assert.equal(
		content,
		'---\nStatus: todo\nProject:\n  - "项目A"\n---\n\n正文内容',
	);
});

test('多值 Project 属性会整体覆盖为新的多值列表', () => {
	const content = upsertListPropertyValues(
		'---\nStatus: todo\nProject:\n  - "旧项目"\n---\n',
		'Project',
		['项目A', '项目B'],
	);

	assert.equal(
		content,
		'---\nStatus: todo\nProject:\n  - "项目A"\n  - "项目B"\n---\n',
	);
});

test('普通正文内容在插入 Project 属性后仍会保留', () => {
	const content = upsertProjectProperty('# 标题\n\n正文内容', '项目A');

	assert.equal(
		content,
		'---\nProject:\n  - "项目A"\n---\n\n# 标题\n\n正文内容',
	);
});

test('主题任务会额外写入 Subject 属性', () => {
	const content = upsertListProperty(
		'---\nProject:\n  - "项目A"\n---\n\n正文内容',
		'Subject',
		'发布复盘',
	);

	assert.equal(
		content,
		'---\nProject:\n  - "项目A"\nSubject:\n  - "发布复盘"\n---\n\n正文内容',
	);
});

test('计划任务会额外写入 Plan 属性', () => {
	const content = upsertListProperty(
		'---\nProject:\n  - "项目A"\n---\n\n正文内容',
		'Plan',
		'阶段一',
	);

	assert.equal(
		content,
		'---\nProject:\n  - "项目A"\nPlan:\n  - "阶段一"\n---\n\n正文内容',
	);
});

test('已有 Subject 时会覆盖为当前输入的单项 List', () => {
	const content = upsertListProperty(
		'---\nProject:\n  - "项目A"\nSubject:\n  - "旧主题"\n---\n',
		'Subject',
		'发布复盘',
	);

	assert.equal(
		content,
		'---\nProject:\n  - "项目A"\nSubject:\n  - "发布复盘"\n---\n',
	);
});

test('已有 Plan 时会覆盖为当前输入的单项 List', () => {
	const content = upsertListProperty(
		'---\nProject:\n  - "项目A"\nPlan: 旧计划\n---\n',
		'Plan',
		'阶段一',
	);

	assert.equal(
		content,
		'---\nProject:\n  - "项目A"\nPlan:\n  - "阶段一"\n---\n',
	);
});

test('在已有 Project 和正文内容时新增 Subject 后正文仍会保留', () => {
	const content = upsertListProperty(
		'---\nProject:\n  - "项目A"\n---\n\n# 标题\n\n正文内容',
		'Subject',
		'发布复盘',
	);

	assert.equal(
		content,
		'---\nProject:\n  - "项目A"\nSubject:\n  - "发布复盘"\n---\n\n# 标题\n\n正文内容',
	);
});

test('普通任务会保留 Project 属性且不需要项目名前缀文件名', () => {
	const content = upsertProjectProperty('# 标题\n\n正文内容', '项目A');

	assert.equal(
		content,
		'---\nProject:\n  - "项目A"\n---\n\n# 标题\n\n正文内容',
	);
});

test('普通任务会移除模板里残留的 Subject 属性', () => {
	const content = removeListProperty(
		'---\nProject:\n  - "项目A"\nSubject:\n  - "旧主题"\n---\n\n正文内容',
		'Subject',
	);

	assert.equal(content, '---\nProject:\n  - "项目A"\n---\n\n正文内容');
});

test('普通任务会移除模板里残留的 Plan 属性', () => {
	const content = removeListProperty(
		'---\nProject:\n  - "项目A"\nPlan:\n  - "旧计划"\n---\n\n正文内容',
		'Plan',
	);

	assert.equal(content, '---\nProject:\n  - "项目A"\n---\n\n正文内容');
});

test('可以从 frontmatter 中提取单值列表属性', () => {
	assert.deepEqual(
		extractListPropertyValuesFromContent(
			'---\nProject:\n  - "项目A"\n---\n\n正文内容',
			'Project',
		),
		['项目A'],
	);
});

test('可以从 frontmatter 中提取多值列表属性', () => {
	assert.deepEqual(
		extractListPropertyValuesFromContent(
			'---\nProject:\n  - "项目A"\n  - "项目B"\n---\n\n正文内容',
			'Project',
		),
		['项目A', '项目B'],
	);
});

test('可以从 frontmatter 中提取标量属性并转为单值列表', () => {
	assert.deepEqual(
		extractListPropertyValuesFromContent(
			'---\nProject: "项目A"\n---\n\n正文内容',
			'Project',
		),
		['项目A'],
	);
});

test('缺失属性时提取结果为空数组', () => {
	assert.deepEqual(
		extractListPropertyValuesFromContent(
			'---\nStatus: todo\n---\n\n正文内容',
			'Project',
		),
		[],
	);
});
