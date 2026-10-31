import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildMultiRemovalEdit, remapLineAfterMultiDelete } = await jiti.import(
	'../src/tasks-center/note-task-multi-delete.ts',
);

/** 按一段编辑重组整篇，便于断言最终文本。 */
function applyEdit(content, edit) {
	const lines = content.split('\n');
	return [
		...lines.slice(0, edit.startLine),
		...edit.nextLines,
		...lines.slice(edit.endLine + 1),
	].join('\n');
}

/** 一次算 + 一次落地，返回最终文本与编辑结果。 */
function remove(content, fromLines) {
	const result = buildMultiRemovalEdit(content, fromLines);
	assert.ok(result, 'expected a removal edit');
	return { result, text: applyEdit(content, result.edit) };
}

test('1 两个不相邻块：中间散文保留，接缝各恰好 1 空行', () => {
	const content = [
		'# 任务',
		'',
		'- [ ] A1',
		'- [ ] A2',
		'',
		'散文段',
		'',
		'- [ ] B1',
		'- [ ] B2',
	].join('\n');
	const { text, result } = remove(content, [2, 7]);
	assert.equal(
		text,
		['# 任务', '- [ ] A2', '', '散文段', '', '- [ ] B2'].join('\n'),
	);
	assert.deepEqual(result.blocks, [
		{ startLine: 2, endLine: 2 },
		{ startLine: 7, endLine: 7 },
	]);
});

test('2 三个块：只留未被选中的那张，窗口外一行不动', () => {
	const content = ['- [ ] A', '- [ ] B', '- [ ] C', '- [ ] D'].join('\n');
	const { text, result } = remove(content, [0, 1, 3]);
	assert.equal(text, '- [ ] C');
	assert.equal(result.removedCount, 3);
});

test('3 相邻两块：中间 0 空行 → 0 空行，原有 1 空行 → 仍是 1 空行', () => {
	// 两侧锚点都是「任务」：接缝 0 空行
	const tight = ['# T', '- [ ] A', '- [ ] B', '- [ ] C'].join('\n');
	assert.equal(remove(tight, [1, 2]).text, ['# T', '- [ ] C'].join('\n'));

	// 两侧锚点都是散文：接缝恰好 1 空行（原有 1 空行 → 不翻倍）
	const prose = ['文字甲', '- [ ] A', '- [ ] B', '', '文字乙'].join('\n');
	assert.equal(
		remove(prose, [1, 2]).text,
		['文字甲', '', '文字乙'].join('\n'),
	);
});

test('4 父子同选（父在前）：只删最外层', () => {
	const content = [
		'- [ ] A',
		'  - [ ] A1',
		'  - [ ] A2',
		'- [ ] B',
	].join('\n');
	const { text, result } = remove(content, [0, 1]);
	assert.equal(text, '- [ ] B');
	assert.deepEqual(result.blocks, [{ startLine: 0, endLine: 2 }]);
});

test('5 父子同选（子在前）：输入顺序不影响结果', () => {
	const content = [
		'- [ ] A',
		'  - [ ] A1',
		'  - [ ] A2',
		'- [ ] B',
	].join('\n');
	const { text, result } = remove(content, [1, 0]);
	assert.equal(text, '- [ ] B');
	assert.deepEqual(result.blocks, [{ startLine: 0, endLine: 2 }]);
});

test('6 跨 Section 多块：标题行不被卷进窗口', () => {
	const content = [
		'# S1',
		'',
		'- [ ] A',
		'',
		'# S2',
		'',
		'- [ ] B',
	].join('\n');
	const { text, result } = remove(content, [2, 6]);
	// 两个标题都还在（标题行本体不在任何块里）
	assert.ok(text.includes('# S1'));
	assert.ok(text.includes('# S2'));
	assert.equal(result.removedCount, 4);
	assert.deepEqual(result.blocks, [
		{ startLine: 2, endLine: 2 },
		{ startLine: 6, endLine: 6 },
	]);
});

test('7 首块在文件首 / 末块到 EOF（含末尾空串）', () => {
	// 文件首：缺左锚点 → 保留原有空行数
	const head = ['- [ ] A', '- [ ] B', '', 'prose'].join('\n');
	assert.equal(remove(head, [0, 1]).text, ['', 'prose'].join('\n'));

	// 文件尾：末尾空串随窗口一起消失，不凭空多/少行
	const tail = ['prose', '- [ ] A', ''].join('\n');
	assert.equal(remove(tail, [1]).text, ['prose', ''].join('\n'));
});

test('8 CRLF 文件：`\\r` 随行，结果仍是 CRLF（接缝空行保原文）', () => {
	const content = [
		'# T\r',
		'\r',
		'- [ ] A\r',
		'- [ ] B\r',
		'\r',
		'prose\r',
		'',
	].join('\n');
	const { text } = remove(content, [2, 3]);
	assert.equal(text, ['# T\r', '\r', 'prose\r', ''].join('\n'));
	assert.ok(text.endsWith('\r\n'));
});

test('9 frontmatter 不进窗口（startLine > frontmatter 结束行）', () => {
	const content = [
		'---',
		'title: x',
		'---',
		'',
		'- [ ] A',
		'- [ ] B',
	].join('\n');
	const { text, result } = remove(content, [4, 5]);
	assert.equal(result.edit.startLine, 3);
	// 缺尾锚点 → 原有 1 个空行保留（文件以换行收尾），frontmatter 三行逐字节不动
	assert.equal(text, ['---', 'title: x', '---', ''].join('\n'));
});

test('10 带续行的块整块消失（任务行 + 续行 + 子树）', () => {
	const content = [
		'- [ ] A',
		'  续行内容',
		'  - [ ] A1',
		'- [ ] B',
	].join('\n');
	const { text, result } = remove(content, [0]);
	assert.equal(text, '- [ ] B');
	assert.equal(result.removedCount, 3);
});

test('11 remap：窗口外不变 / 下方 −removedCount / 被删行为 null', () => {
	const content = [
		'# 任务',
		'',
		'- [ ] A1',
		'- [ ] A2',
		'',
		'散文段',
		'',
		'- [ ] B1',
		'- [ ] B2',
	].join('\n');
	const { result } = remove(content, [2, 7]);
	// 窗口 = 1..7，删掉 3 行
	assert.equal(remapLineAfterMultiDelete(result, 0), 0); // 窗口上方
	assert.equal(remapLineAfterMultiDelete(result, 3), 0); // 窗口内幸存
	assert.equal(remapLineAfterMultiDelete(result, 4), 1);
	assert.equal(remapLineAfterMultiDelete(result, 5), 2);
	assert.equal(remapLineAfterMultiDelete(result, 6), 3);
	assert.equal(remapLineAfterMultiDelete(result, 2), null); // 被删
	assert.equal(remapLineAfterMultiDelete(result, 1), null); // 被规范化掉的空行
	assert.equal(remapLineAfterMultiDelete(result, 7), null); // 被删
	assert.equal(remapLineAfterMultiDelete(result, 8), 5); // 窗口下方
	assert.equal(remapLineAfterMultiDelete(result, 9), 6);
});

test('12 remapLineAfterMultiDelete 三个分支（上方 / 窗口内 / 下方）', () => {
	const result = {
		edit: { startLine: 5, endLine: 7, originalLines: ['a', 'b', 'c'], nextLines: ['a'] },
		remap: new Map([
			[5, 0],
			[6, null],
			[7, null],
		]),
		removedCount: 2,
		blocks: [{ startLine: 5, endLine: 7 }],
	};
	assert.equal(remapLineAfterMultiDelete(result, 4), 4);
	assert.equal(remapLineAfterMultiDelete(result, 5), 0);
	assert.equal(remapLineAfterMultiDelete(result, 6), null);
	assert.equal(remapLineAfterMultiDelete(result, 8), 6);
});

test('13 非法输入：空数组 / 非任务行 / 行号越界 → null', () => {
	assert.equal(buildMultiRemovalEdit('', []), null);
	assert.equal(buildMultiRemovalEdit('# 只有标题\n正文', [0, 1]), null);
	assert.equal(buildMultiRemovalEdit('- [ ] A', [99]), null);
	assert.equal(buildMultiRemovalEdit('- [ ] A', [0, 99]).edit.endLine, 0);
});

test('14 幂等：同一段内容删两次，第二次返回 null（块已不存在）', () => {
	const content = ['# T', '- [ ] A', '- [ ] B'].join('\n');
	const first = buildMultiRemovalEdit(content, [1, 2]);
	assert.ok(first);
	const after = applyEdit(content, first.edit);
	assert.equal(after, '# T');
	assert.equal(buildMultiRemovalEdit(after, [1, 2]), null);
});
