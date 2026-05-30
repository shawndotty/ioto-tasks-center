import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildTaskFileName,
	buildListPropertyFrontmatter,
	buildProjectPropertyFrontmatter,
	getTemplaterCommandId,
	normalizeCustomTaskName,
	removeListProperty,
	resolveTaskTargetPath,
	upsertListProperty,
	upsertProjectProperty,
} = await jiti.import('../src/tasks-center/task-creation.ts');

const FIXED_LOCAL_DATE = new Date(2026, 4, 30, 12, 0, 0);

test('日期任务命名符合 项目名-YYYY-MM-DD.md 规则', () => {
	const fileName = buildTaskFileName('项目A', 'date', FIXED_LOCAL_DATE);

	assert.equal(fileName, '项目A-2026-05-30.md');
});

test('计划任务命名符合 项目名-计划-名称.md 规则', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'plan',
		FIXED_LOCAL_DATE,
		'阶段一',
	);

	assert.equal(fileName, '项目A-计划-阶段一.md');
});

test('主题任务命名符合 项目名-主题-名称.md 规则', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'topic',
		FIXED_LOCAL_DATE,
		'发布复盘',
	);

	assert.equal(fileName, '项目A-主题-发布复盘.md');
});

test('普通任务命名符合 用户输入名称.md 规则', () => {
	const fileName = buildTaskFileName(
		'项目A',
		'normal',
		FIXED_LOCAL_DATE,
		'发布复盘',
	);

	assert.equal(fileName, '发布复盘.md');
});

test('计划和主题任务名称为空时会抛出错误', () => {
	assert.throws(
		() => buildTaskFileName('项目A', 'plan', FIXED_LOCAL_DATE, '   '),
		/任务名称不能为空/,
	);

	assert.throws(
		() => buildTaskFileName('项目A', 'topic', FIXED_LOCAL_DATE, ''),
		/任务名称不能为空/,
	);

	assert.throws(
		() => buildTaskFileName('项目A', 'normal', FIXED_LOCAL_DATE, '   '),
		/任务名称不能为空/,
	);
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
		'项目A-计划-阶段一.md',
	);

	assert.equal(targetPath, '工作区/任务/项目A/项目A-计划-阶段一.md');
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

test('Project 属性 frontmatter 会使用单项 List 格式', () => {
	const frontmatter = buildProjectPropertyFrontmatter('项目A');

	assert.equal(frontmatter, 'Project:\n  - "项目A"');
});

test('通用 List 属性 frontmatter 会按属性名和值生成', () => {
	const frontmatter = buildListPropertyFrontmatter('Subject', '发布复盘');

	assert.equal(frontmatter, 'Subject:\n  - "发布复盘"');
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
