import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 子任务层级折叠的纯逻辑（[[Plan-20261114-203739]] S1）。
// 模块零 `obsidian` / 零 DOM 依赖，jiti 可直接导入（DOM 函数仅在调用时触碰 DOM）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildSubtaskKeyIndex, collectSubtaskFoldKeys } = await jiti.import(
	'../src/views/ioto-task/task-hierarchy-fold.ts',
);

const keyAt = (index, line) => index.keyByLine.get(line);
const nodeAt = (index, line) => index.nodeByLine.get(line);

test('三级嵌套：根节点的 descendants 同时含子与孙', () => {
	const content = [
		'- [ ] Root',
		'  - [ ] Child',
		'    - [ ] Grandchild',
	].join('\n');
	const index = buildSubtaskKeyIndex(content);
	assert.deepEqual(nodeAt(index, 0).descendants, [1, 2]);
	assert.deepEqual(nodeAt(index, 1).descendants, [2]);
	assert.deepEqual(nodeAt(index, 2).descendants, []);
});

test('同级缩进：后一个兄弟不进入前一个的 descendants', () => {
	const content = ['- [ ] A', '  - [ ] A1', '- [ ] B', '  - [ ] B1'].join('\n');
	const index = buildSubtaskKeyIndex(content);
	assert.deepEqual(nodeAt(index, 0).descendants, [1]);
	assert.deepEqual(nodeAt(index, 2).descendants, [3]);
});

test('回退缩进：缩进变浅后旧栈正确弹出', () => {
	const content = [
		'- [ ] A',
		'  - [ ] A1',
		'    - [ ] A1a',
		'  - [ ] A2',
		'- [ ] B',
	].join('\n');
	const index = buildSubtaskKeyIndex(content);
	assert.deepEqual(nodeAt(index, 0).descendants, [1, 2, 3]);
	assert.deepEqual(nodeAt(index, 1).descendants, [2]);
	assert.deepEqual(nodeAt(index, 3).descendants, []);
	assert.deepEqual(nodeAt(index, 4).descendants, []);
});

test('空行 / 普通段落分隔：父子关系仍成立', () => {
	const content = [
		'- [ ] Parent',
		'',
		'普通正文段落。',
		'',
		'  - [ ] Child',
	].join('\n');
	const index = buildSubtaskKeyIndex(content);
	assert.deepEqual(nodeAt(index, 0).descendants, [4]);
});

test('## 子标题边界：之后的缩进任务不归上一个父任务', () => {
	const content = [
		'- [ ] Parent',
		'  - [ ] Child',
		'## Sub',
		'  - [ ] Under Heading',
	].join('\n');
	const index = buildSubtaskKeyIndex(content);
	assert.deepEqual(nodeAt(index, 0).descendants, [1]);
	assert.deepEqual(nodeAt(index, 3).descendants, []);
});

test('孤儿缩进：首条 indent>0 不抛错且无父节点', () => {
	const content = ['  - [ ] Orphan', '    - [ ] Its Child'].join('\n');
	const index = buildSubtaskKeyIndex(content);
	assert.deepEqual(nodeAt(index, 0).descendants, [1]);
	assert.deepEqual(nodeAt(index, 0).indent, 1);
});

test('同名同缩进：序号 0 / 1，键不同且稳定', () => {
	const content = ['- [ ] P', '  - [ ] C', '- [ ] P', '  - [ ] D'].join('\n');
	const first = buildSubtaskKeyIndex(content);
	const second = buildSubtaskKeyIndex(content);
	const keyA = keyAt(first, 0);
	const keyB = keyAt(first, 2);
	assert.notEqual(keyA, keyB);
	assert.match(keyA, /:0$/);
	assert.match(keyB, /:1$/);
	assert.equal(keyA, keyAt(second, 0));
	assert.equal(keyB, keyAt(second, 2));
});

test('同文本不同缩进：键不同', () => {
	const content = ['- [ ] Same', '  - [ ] Same'].join('\n');
	const index = buildSubtaskKeyIndex(content);
	assert.notEqual(keyAt(index, 0), keyAt(index, 1));
});

test('键形态：h:<indent>:<8位十六进制>:<ordinal>', () => {
	const content = ['- [ ] A', '  - [ ] B'].join('\n');
	const index = buildSubtaskKeyIndex(content);
	assert.match(keyAt(index, 0), /^h:\d+:[0-9a-f]{8}:\d+$/);
	assert.match(keyAt(index, 1), /^h:\d+:[0-9a-f]{8}:\d+$/);
});

test('键稳定性：上方插入不同正文的任务后，原父键不变', () => {
	const before = ['- [ ] Parent', '  - [ ] Child'].join('\n');
	const after = ['- [ ] Inserted', ...before.split('\n')].join('\n');
	const keyBefore = keyAt(buildSubtaskKeyIndex(before), 0);
	const keyAfter = keyAt(buildSubtaskKeyIndex(after), 1);
	assert.equal(keyAfter, keyBefore);
});

test('CRLF / LF：同一内容两种换行 → 键一致', () => {
	const lf = ['- [ ] Parent', '  - [ ] Child'].join('\n');
	const crlf = lf.replace(/\n/g, '\r\n');
	const lfIndex = buildSubtaskKeyIndex(lf);
	const crlfIndex = buildSubtaskKeyIndex(crlf);
	assert.equal(keyAt(crlfIndex, 0), keyAt(lfIndex, 0));
	assert.deepEqual(nodeAt(crlfIndex, 0).descendants, [1]);
});

test('批量键：只含有子孙的父键，且与 nodeByLine 一致', () => {
	const content = [
		'- [ ] Root',
		'  - [ ] Child',
		'    - [ ] Grandchild',
		'- [ ] Leaf',
	].join('\n');
	const index = buildSubtaskKeyIndex(content);
	const expected = [...index.nodeByLine.values()]
		.filter((node) => node.descendants.length > 0)
		.map((node) => node.key);
	assert.deepEqual(collectSubtaskFoldKeys(content), expected);
	assert.equal(expected.length, 2);
	assert.equal(new Set(expected).size, expected.length);
});
