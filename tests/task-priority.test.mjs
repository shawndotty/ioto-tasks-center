import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	getPriorityFromContent,
	parsePriorityFrontmatterValue,
	resolvePriorityFromSources,
} = await jiti.import('../src/tasks-center/data.ts');

test('Priority 整数值可正常解析', () => {
	assert.equal(parsePriorityFrontmatterValue(0), 0);
	assert.equal(parsePriorityFrontmatterValue(1), 1);
	assert.equal(parsePriorityFrontmatterValue(2), 2);
	assert.equal(parsePriorityFrontmatterValue(3), 3);
	assert.equal(parsePriorityFrontmatterValue(4), 4);
	assert.equal(parsePriorityFrontmatterValue(5), 5);
});

test('Priority 字符串数字可正常解析', () => {
	assert.equal(parsePriorityFrontmatterValue('2'), 2);
	assert.equal(parsePriorityFrontmatterValue(' 4 '), 4);
	assert.equal(parsePriorityFrontmatterValue('"5"'), 5);
});

test('非法 Priority 值会返回 undefined', () => {
	assert.equal(parsePriorityFrontmatterValue(''), undefined);
	assert.equal(parsePriorityFrontmatterValue('   '), undefined);
	assert.equal(parsePriorityFrontmatterValue('1.5'), undefined);
	assert.equal(parsePriorityFrontmatterValue(-1), undefined);
	assert.equal(parsePriorityFrontmatterValue('abc'), undefined);
	assert.equal(parsePriorityFrontmatterValue([]), undefined);
});

test('可从 frontmatter 内容中解析 Priority', () => {
	assert.equal(
		getPriorityFromContent(`---\nPriority: 2\n---\n# 任务\n`),
		2,
	);
	assert.equal(
		getPriorityFromContent(`---\nPriority: "3"\n---\n# 任务\n`),
		3,
	);
});

test('frontmatter 内容中的 Priority 优先于 metadata cache', () => {
	assert.equal(
		resolvePriorityFromSources({
			content: `---\nPriority: 1\n---\n正文`,
			metadataValue: 5,
		}),
		1,
	);
});

test('缺少内容时会回退到 metadata cache Priority', () => {
	assert.equal(
		resolvePriorityFromSources({
			metadataValue: '4',
		}),
		4,
	);
});
