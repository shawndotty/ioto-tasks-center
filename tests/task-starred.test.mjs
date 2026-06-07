import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	getStarredFromContent,
	parseStarredFrontmatterValue,
	resolveStarredFromSources,
} = await jiti.import('../src/tasks-center/data.ts');

test('Starred 布尔值可正常解析', () => {
	assert.equal(parseStarredFrontmatterValue(true), true);
	assert.equal(parseStarredFrontmatterValue(false), false);
});

test('Starred 字符串 true 可正常解析', () => {
	assert.equal(parseStarredFrontmatterValue('true'), true);
	assert.equal(parseStarredFrontmatterValue(' TRUE '), true);
	assert.equal(parseStarredFrontmatterValue('"true"'), true);
	assert.equal(parseStarredFrontmatterValue("'true'"), true);
});

test('非法 Starred 值会返回 false', () => {
	assert.equal(parseStarredFrontmatterValue('false'), false);
	assert.equal(parseStarredFrontmatterValue('"false"'), false);
	assert.equal(parseStarredFrontmatterValue('yes'), false);
	assert.equal(parseStarredFrontmatterValue(''), false);
	assert.equal(parseStarredFrontmatterValue(null), false);
	assert.equal(parseStarredFrontmatterValue(undefined), false);
});

test('可从 frontmatter 内容中解析 Starred', () => {
	assert.equal(getStarredFromContent(`---\nStarred: true\n---\n# 任务\n`), true);
	assert.equal(
		getStarredFromContent(`---\nStarred: "true"\n---\n# 任务\n`),
		true,
	);
	assert.equal(
		getStarredFromContent(`---\nStarred: false\n---\n# 任务\n`),
		false,
	);
});

test('frontmatter 内容中的 Starred 优先于 metadata cache', () => {
	assert.equal(
		resolveStarredFromSources({
			content: `---\nStarred: true\n---\n正文`,
			metadataValue: false,
		}),
		true,
	);
});

test('缺少内容时会回退到 metadata cache Starred', () => {
	assert.equal(
		resolveStarredFromSources({
			metadataValue: true,
		}),
		true,
	);
	assert.equal(
		resolveStarredFromSources({
			metadataValue: 'true',
		}),
		true,
	);
});
