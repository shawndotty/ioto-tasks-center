import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

/**
 * `removeTopLevelSection`（[[Plan-20261018-183253]] §3.1）纯函数单测。
 *
 * 覆盖「整节删除」的空行口径判定表：块间恰好一个空行、首节 / 末节 / frontmatter
 * 之后 / 嵌套 `##` / 非顶层标题行；外加 `originalLines` 切片对齐（写盘的序列
 * 校验依赖它）与行号映射前提（后续 root 的 startLine = 旧值 - delta）。
 */
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { removeTopLevelSection, parseSections, collectRootSections } =
	await jiti.import('../src/tasks-center/note-structure.ts');

/** 按结果重组整篇（与 commitBlockRange 的 splice 语义一致）。 */
function applyRemoval(content, result) {
	const lines = content.split('\n');
	return [
		...lines.slice(0, result.startLine),
		...result.nextLines,
		...lines.slice(result.endLine + 1),
	].join('\n');
}

function topLevelRoots(content) {
	return collectRootSections(parseSections(content)).filter(
		(section) => section.level > 0,
	);
}

test('中间节、块间正常一个空行 → 删除后仍是一个空行', () => {
	const content = ['# A', '- a', '', '# B', '- b', '', '# C'].join('\n');
	const result = removeTopLevelSection(content, 3);
	assert.ok(result);
	assert.deepEqual(result.originalLines, ['# B', '- b', '']);
	assert.deepEqual(result.nextLines, []);
	assert.equal(applyRemoval(content, result), ['# A', '- a', '', '# C'].join('\n'));
});

test('中间节、尾部 3 个空行 → 归一为 1 个', () => {
	const content = ['# A', '', '# B', '- b', '', '', '', '# C'].join('\n');
	const result = removeTopLevelSection(content, 2);
	assert.ok(result);
	assert.equal(applyRemoval(content, result), ['# A', '', '# C'].join('\n'));
});

test('中间节、无尾随空行 → 补 1 个空行', () => {
	const content = ['# A', '- a', '# B', '- b', '# C'].join('\n');
	const result = removeTopLevelSection(content, 2);
	assert.ok(result);
	assert.deepEqual(result.originalLines, ['# B', '- b']);
	assert.deepEqual(result.nextLines, ['']);
	assert.equal(applyRemoval(content, result), ['# A', '- a', '', '# C'].join('\n'));
});

test('首节（行 0 起）→ 下一节顶到第 0 行，无前导空行', () => {
	const content = ['# A', '- a', '', '# B'].join('\n');
	const result = removeTopLevelSection(content, 0);
	assert.ok(result);
	assert.deepEqual(result.nextLines, []);
	assert.equal(applyRemoval(content, result), '# B');
});

test('frontmatter 之后 → frontmatter 后的空行保留', () => {
	const content = ['---', 'Project: X', '---', '', '# A', '- a', '', '# B'].join(
		'\n',
	);
	const result = removeTopLevelSection(content, 4);
	assert.ok(result);
	assert.equal(
		applyRemoval(content, result),
		['---', 'Project: X', '---', '', '# B'].join('\n'),
	);
});

test('末节、文件以换行收尾 → 仍以换行收尾，不叠加空行', () => {
	const content = ['# A', '- a', '', '# B', '- b', ''].join('\n'); // 末尾 \n
	const result = removeTopLevelSection(content, 3);
	assert.ok(result);
	assert.deepEqual(result.nextLines, []);
	assert.equal(applyRemoval(content, result), ['# A', '- a', ''].join('\n'));
});

test('末节、相邻行非空且文件以换行收尾 → 保留一个空串维持 \\n 收尾', () => {
	const content = ['# A', '# B', ''].join('\n');
	const result = removeTopLevelSection(content, 1);
	assert.ok(result);
	assert.deepEqual(result.nextLines, ['']);
	assert.equal(applyRemoval(content, result), '# A\n');
});

test('末节、文件不以换行收尾 → 不追加空行', () => {
	const content = ['# A', '# B'].join('\n');
	const result = removeTopLevelSection(content, 1);
	assert.ok(result);
	assert.deepEqual(result.nextLines, []);
	assert.equal(applyRemoval(content, result), '# A');
});

test('含嵌套 ## 子块 → 子标题与任务一并删除', () => {
	const content = ['# A', '## 子', '- a', '', '# B'].join('\n');
	const result = removeTopLevelSection(content, 0);
	assert.ok(result);
	assert.deepEqual(result.originalLines, ['# A', '## 子', '- a', '']);
	assert.equal(applyRemoval(content, result), '# B');
});

test('嵌套标题行 / 引导区 / 越界行号 → null', () => {
	const content = ['前言', '', '# A', '## 子', '- a'].join('\n');
	assert.equal(removeTopLevelSection(content, 0), null); // 引导区（level 0）
	assert.equal(removeTopLevelSection(content, 3), null); // 嵌套标题
	assert.equal(removeTopLevelSection(content, 99), null); // 越界
	assert.equal(removeTopLevelSection('', 0), null); // 空笔记
});

test('originalLines 与原文切片逐行相等（写盘序列校验依赖）', () => {
	const content = ['# A', '- a', '', '# B', '- b', '', '# C'].join('\n');
	const result = removeTopLevelSection(content, 3);
	assert.ok(result);
	assert.deepEqual(
		result.originalLines,
		content.split('\n').slice(result.startLine, result.endLine + 1),
	);
});

test('删除后顶层层数 -1，后续 root 的 startLine = 旧值 - delta', () => {
	const content = ['# A', '- a', '', '# B', '- b', '', '# C', '- c'].join('\n');
	const before = topLevelRoots(content);
	const result = removeTopLevelSection(content, before[1].startLine);
	assert.ok(result);
	const after = topLevelRoots(applyRemoval(content, result));
	assert.equal(after.length, before.length - 1);
	const delta = result.originalLines.length - result.nextLines.length;
	assert.equal(after[1].title, 'C');
	assert.equal(after[1].startLine, before[2].startLine - delta);
});

test('同名标题两节 → 只删 startLine 命中的那一节', () => {
	const content = ['# X', '- a', '', '# X', '- b'].join('\n');
	const result = removeTopLevelSection(content, 3);
	assert.ok(result);
	assert.equal(applyRemoval(content, result), ['# X', '- a', ''].join('\n'));
});
