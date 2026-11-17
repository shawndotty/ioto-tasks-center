import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 项目范围编解码单测（[[Plan-20261116-161225]] §三 步骤 1 / 步骤 5）。
// `scope-codec.ts` 零 obsidian 运行时依赖（仅 `import type`），可 jiti 直载。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	decodeQuadrantScope,
	encodeQuadrantScope,
	parseQuadrantProjectScope,
} = await jiti.import('../src/views/quadrant/scope-codec.ts');

test('encode：两种 kind 的字符串形状', () => {
	assert.equal(encodeQuadrantScope({ kind: 'all' }), 'all');
	assert.equal(
		encodeQuadrantScope({ kind: 'project', projectName: 'IOTO Task Center' }),
		'project:IOTO Task Center',
	);
});

test('encode：project 缺 projectName 时编码为空的 project:（由严格解析拦下）', () => {
	const encoded = encodeQuadrantScope({ kind: 'project' });
	assert.equal(encoded, 'project:');
	assert.equal(parseQuadrantProjectScope(encoded), undefined);
	assert.deepEqual(decodeQuadrantScope(encoded), { kind: 'all' });
});

test('parse：合法值还原为对象', () => {
	assert.deepEqual(parseQuadrantProjectScope('all'), { kind: 'all' });
	assert.deepEqual(parseQuadrantProjectScope('project:IOTO Task Center'), {
		kind: 'project',
		projectName: 'IOTO Task Center',
	});
});

test('parse：历史值 unarchived 迁移为 all', () => {
	assert.deepEqual(parseQuadrantProjectScope('unarchived'), { kind: 'all' });
});

test('parse：非法值一律 undefined', () => {
	for (const value of [
		42,
		null,
		undefined,
		{},
		[],
		true,
		'',
		'bogus',
		'project:',
		'PROJECT:x',
		' project:x',
	]) {
		assert.equal(
			parseQuadrantProjectScope(value),
			undefined,
			`input=${JSON.stringify(value)}`,
		);
	}
});

test('decode：宽松版本对非法值回落 all', () => {
	for (const value of ['', 'bogus', 'project:', 'PROJECT:x']) {
		assert.deepEqual(decodeQuadrantScope(value), { kind: 'all' });
	}
	assert.deepEqual(decodeQuadrantScope('all'), { kind: 'all' });
});

test('encode → decode 往返：含冒号、空格、中文的项目名', () => {
	const names = [
		'IOTO Task Center',
		'含:冒号的 项目',
		'中文项目名',
		'a:b:c',
	];
	for (const projectName of names) {
		const scope = { kind: 'project', projectName };
		assert.deepEqual(
			decodeQuadrantScope(encodeQuadrantScope(scope)),
			scope,
			`name=${projectName}`,
		);
		assert.deepEqual(
			parseQuadrantProjectScope(encodeQuadrantScope(scope)),
			scope,
			`name=${projectName}`,
		);
	}
});

test('encode → decode 往返：all', () => {
	for (const kind of ['all']) {
		assert.deepEqual(
			parseQuadrantProjectScope(encodeQuadrantScope({ kind })),
			{ kind },
		);
	}
});

test('严格 parse 与宽松 decode 的差异矩阵', () => {
	const cases = [
		{ input: 'all', strict: { kind: 'all' }, lenient: { kind: 'all' } },
		{ input: 'unarchived', strict: { kind: 'all' }, lenient: { kind: 'all' } },
		{
			input: 'project:IOTO',
			strict: { kind: 'project', projectName: 'IOTO' },
			lenient: { kind: 'project', projectName: 'IOTO' },
		},
		{ input: 'project:', strict: undefined, lenient: { kind: 'all' } },
		{ input: 'bogus', strict: undefined, lenient: { kind: 'all' } },
		{ input: '', strict: undefined, lenient: { kind: 'all' } },
	];
	for (const { input, strict, lenient } of cases) {
		assert.deepEqual(
			parseQuadrantProjectScope(input),
			strict,
			`strict input=${input}`,
		);
		assert.deepEqual(
			decodeQuadrantScope(input),
			lenient,
			`lenient input=${input}`,
		);
	}
});
