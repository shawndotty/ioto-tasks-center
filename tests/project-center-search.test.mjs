import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { filterProjectCenterRowsByQuery } = await jiti.import(
	'../src/views/project-center-search.ts',
);

test('空 query 返回原数组引用', () => {
	const rows = [{ name: 'Alpha' }, { name: 'Beta' }];
	assert.equal(filterProjectCenterRowsByQuery(rows, ''), rows);
	assert.equal(filterProjectCenterRowsByQuery(rows, '   '), rows);
});

test('包含匹配忽略大小写', () => {
	const rows = [
		{ name: 'Alpha Project' },
		{ name: 'beta project' },
		{ name: 'Gamma' },
	];

	assert.deepEqual(filterProjectCenterRowsByQuery(rows, 'PROJ'), [
		rows[0],
		rows[1],
	]);
});

test('query 两端空白会被 trim', () => {
	const rows = [{ name: 'Alpha Project' }, { name: 'Beta' }];
	assert.deepEqual(filterProjectCenterRowsByQuery(rows, '  alpha  '), [rows[0]]);
});

