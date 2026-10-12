import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { planCategoryRename, planCategoryRemoval, selectProjectsInCategory } =
	await jiti.import('../src/tasks-center/project-category.ts');

// --- planCategoryRename ---

test('planCategoryRename 删除旧名、加入新名并去重排序', () => {
	assert.deepEqual(
		planCategoryRename(['A', 'B'], 'A', 'C'),
		['B', 'C'],
	);
});

test('planCategoryRename 对入参做 trim 并剔除空项', () => {
	assert.deepEqual(
		planCategoryRename([' A ', '', 'B'], 'A', ' C '),
		['B', 'C'],
	);
});

test('planCategoryRename 使用数字感知排序（与既有三处一致）', () => {
	assert.deepEqual(
		planCategoryRename(['分类10', '分类2'], '分类10', '分类1'),
		['分类1', '分类2'],
	);
});

test('planCategoryRename 空名返回 null', () => {
	assert.equal(planCategoryRename(['A'], 'A', '   '), null);
});

test('planCategoryRename 同名（含 trim 后同名）返回 null', () => {
	assert.equal(planCategoryRename(['A'], 'A', 'A'), null);
	assert.equal(planCategoryRename(['A'], ' A ', 'A'), null);
});

// --- planCategoryRemoval ---

test('planCategoryRemoval 命中时移除并排序', () => {
	assert.deepEqual(planCategoryRemoval(['B', 'A', 'C'], 'A'), ['B', 'C']);
});

test('planCategoryRemoval 未命中时返回内容等价的排序列表', () => {
	assert.deepEqual(planCategoryRemoval(['B', 'A'], 'X'), ['A', 'B']);
});

test('planCategoryRemoval 对入参与目标均做 trim', () => {
	assert.deepEqual(planCategoryRemoval([' A ', 'B'], ' A '), ['B']);
});

// --- selectProjectsInCategory ---

test('selectProjectsInCategory 命中同名项目名', () => {
	const rows = [
		{ name: 'p1', category: '研发' },
		{ name: 'p2', category: '运营' },
		{ name: 'p3', category: '研发' },
	];
	assert.deepEqual(selectProjectsInCategory(rows, '研发'), ['p1', 'p3']);
});

test('selectProjectsInCategory 传空串统计「未分类」（含 category 缺失）', () => {
	const rows = [
		{ name: 'p1', category: '研发' },
		{ name: 'p2' },
		{ name: 'p3', category: '' },
		{ name: 'p4', category: '   ' },
	];
	assert.deepEqual(selectProjectsInCategory(rows, ''), [
		'p2',
		'p3',
		'p4',
	]);
});

test('selectProjectsInCategory 目标与行值均 trim 后比较', () => {
	const rows = [
		{ name: 'p1', category: ' 研发 ' },
		{ name: 'p2', category: '研发' },
	];
	assert.deepEqual(selectProjectsInCategory(rows, ' 研发 '), [
		'p1',
		'p2',
	]);
});
