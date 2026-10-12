import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	buildProjectListSections,
	filterProjectsByCategory,
	collectVisibleCategoryOptions,
	toCategoryFilterValue,
	toCategoryFilterToken,
	PROJECT_CATEGORY_FILTER_ALL_VALUE,
	PROJECT_CATEGORY_FILTER_UNCATEGORIZED_VALUE,
} = await jiti.import('../src/views/project-list-group.ts');

test('不分组：返回单个 section 并按排序模式排序', () => {
	const sections = buildProjectListSections(
		[
			{ name: '项目2', path: '3-任务/项目2' },
			{ name: '项目1', path: '3-任务/项目1' },
		],
		new Map([
			['项目2', 1],
			['项目1', 3],
		]),
		new Map(),
		'incomplete-count',
		'none',
	);

	assert.equal(sections.length, 1);
	assert.deepEqual(
		sections[0].projects.map((project) => project.name),
		['项目1', '项目2'],
	);
});

test('按分类分组：未分类组排最后，组顺序按未完成总数 desc，组内按排序模式排序', () => {
	const sections = buildProjectListSections(
		[
			{ name: '项目A', path: '3-任务/项目A' },
			{ name: '项目B', path: '3-任务/项目B' },
			{ name: '项目C', path: '3-任务/项目C' },
			{ name: '项目D', path: '3-任务/项目D' },
		],
		new Map([
			['项目A', 5],
			['项目B', 1],
			['项目C', 2],
			['项目D', 7],
		]),
		new Map([
			['项目A', '分类1'],
			['项目B', '分类2'],
			['项目C', '分类1'],
			['项目D', ''],
		]),
		'incomplete-count',
		'category',
	);

	assert.deepEqual(
		sections.map((section) => section.groupKey),
		['分类1', '分类2', ''],
	);
	assert.deepEqual(
		sections[0].projects.map((project) => project.name),
		['项目A', '项目C'],
	);
	assert.deepEqual(
		sections[1].projects.map((project) => project.name),
		['项目B'],
	);
	assert.deepEqual(
		sections[2].projects.map((project) => project.name),
		['项目D'],
	);
});

const filterProjects = [
	{ name: '项目A', path: '3-任务/项目A' },
	{ name: '项目B', path: '3-任务/项目B' },
	{ name: '项目C', path: '3-任务/项目C' },
];
const filterCategories = new Map([
	['项目A', '分类1'],
	['项目B', '分类2'],
	['项目C', ''],
]);

test('filterProjectsByCategory：全部分类（null）原样返回同一批', () => {
	const result = filterProjectsByCategory(
		filterProjects,
		filterCategories,
		null,
	);
	assert.equal(result, filterProjects);
});

test('filterProjectsByCategory：命中某分类', () => {
	const result = filterProjectsByCategory(
		filterProjects,
		filterCategories,
		'分类1',
	);
	assert.deepEqual(
		result.map((project) => project.name),
		['项目A'],
	);
});

test('filterProjectsByCategory：未分类（空串）', () => {
	const result = filterProjectsByCategory(
		filterProjects,
		filterCategories,
		'',
	);
	assert.deepEqual(
		result.map((project) => project.name),
		['项目C'],
	);
});

test('filterProjectsByCategory：无命中返回空数组', () => {
	const result = filterProjectsByCategory(
		filterProjects,
		filterCategories,
		'分类9',
	);
	assert.deepEqual(result, []);
});

test('filterProjectsByCategory：分类名前后空格与去空格后等价', () => {
	const result = filterProjectsByCategory(
		[{ name: '项目A', path: '3-任务/项目A' }],
		new Map([['项目A', ' 分类1 ']]),
		'分类1',
	);
	assert.deepEqual(
		result.map((project) => project.name),
		['项目A'],
	);
});

test('collectVisibleCategoryOptions：去空、去重、按排序器排序', () => {
	const options = collectVisibleCategoryOptions(
		[
			{ name: 'p1', path: 'a' },
			{ name: 'p2', path: 'b' },
			{ name: 'p3', path: 'c' },
			{ name: 'p4', path: 'd' },
		],
		new Map([
			['p1', '分类B'],
			['p2', '分类A'],
			['p3', '分类B'],
			['p4', ''],
		]),
	);
	assert.deepEqual(options, ['分类A', '分类B']);
});

test('toCategoryFilterValue / toCategoryFilterToken：哨兵互转', () => {
	assert.equal(
		toCategoryFilterValue(PROJECT_CATEGORY_FILTER_ALL_VALUE),
		null,
	);
	assert.equal(
		toCategoryFilterValue(PROJECT_CATEGORY_FILTER_UNCATEGORIZED_VALUE),
		'',
	);
	assert.equal(toCategoryFilterValue('分类1'), '分类1');

	assert.equal(
		toCategoryFilterToken(null),
		PROJECT_CATEGORY_FILTER_ALL_VALUE,
	);
	assert.equal(
		toCategoryFilterToken(''),
		PROJECT_CATEGORY_FILTER_UNCATEGORIZED_VALUE,
	);
	assert.equal(toCategoryFilterToken('分类1'), '分类1');
});

