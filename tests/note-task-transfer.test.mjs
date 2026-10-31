import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	appendTaskBlockToNote,
	extractTaskBlock,
	insertTaskBlock,
	moveTaskBlockAcrossNotes,
} = await jiti.import('../src/tasks-center/note-task-transfer.ts');

/** 按一段编辑重组整篇，便于断言最终文本。 */
function applyEdit(content, edit) {
	const lines = content.split('\n');
	return [
		...lines.slice(0, edit.startLine),
		...edit.nextLines,
		...lines.slice(edit.endLine + 1),
	].join('\n');
}

/** 源 / 目标两侧都重组，返回 `{ source, target }`。 */
function applyBoth(sourceContent, targetContent, result) {
	return {
		source: applyEdit(sourceContent, result.source),
		target: applyEdit(targetContent, result.target),
	};
}

const SOURCE = ['# 源', '', '- [ ] X', '- [ ] Y'].join('\n');

test('1 插到目标卡之前：成为该卡同级兄弟', () => {
	const target = ['# 任务', '', '- [ ] A', '- [ ] B'].join('\n');
	const result = moveTaskBlockAcrossNotes(SOURCE, target, 2, {
		kind: 'task',
		line: 2,
		position: 'before',
	});
	assert.ok(result);
	const out = applyBoth(SOURCE, target, result);
	assert.equal(out.target, ['# 任务', '- [ ] X', '- [ ] A', '- [ ] B'].join('\n'));
	// 删除缝：标题 / 任务相邻 → 0 空行（与 `moveTaskBlock` 同口径）
	assert.equal(out.source, ['# 源', '- [ ] Y'].join('\n'));
});

test('2 插到目标卡之后：子树整块随行', () => {
	const source = ['# 源', '- [ ] X', '  - [ ] X1', '- [ ] Y'].join('\n');
	const target = ['# 任务', '- [ ] A', '- [ ] B'].join('\n');
	const result = moveTaskBlockAcrossNotes(source, target, 1, {
		kind: 'task',
		line: 1,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(target, result.target),
		['# 任务', '- [ ] A', '- [ ] X', '  - [ ] X1', '- [ ] B'].join('\n'),
	);
	assert.equal(
		applyEdit(source, result.source),
		['# 源', '- [ ] Y'].join('\n'),
	);
});

test('3 插到 Section header：成为该节首条顶层任务', () => {
	const target = ['# 任务', '', '- [ ] A'].join('\n');
	const result = moveTaskBlockAcrossNotes(SOURCE, target, 2, {
		kind: 'section',
		sectionStartLine: 0,
		position: 'start',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(target, result.target),
		['# 任务', '- [ ] X', '- [ ] A'].join('\n'),
	);
});

test('4 插到正文空白（section-end）：落在本节末个顶层块之后', () => {
	const target = ['# 任务', '', '- [ ] A', '- [ ] B'].join('\n');
	const result = moveTaskBlockAcrossNotes(SOURCE, target, 2, {
		kind: 'section',
		sectionStartLine: 0,
		position: 'end',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(target, result.target),
		['# 任务', '', '- [ ] A', '- [ ] B', '- [ ] X'].join('\n'),
	);
});

test('5 目标节只有标题：标题下一行、0 级', () => {
	const target = '# 任务';
	const result = moveTaskBlockAcrossNotes(SOURCE, target, 2, {
		kind: 'section',
		sectionStartLine: 0,
		position: 'start',
	});
	assert.ok(result);
	assert.equal(applyEdit(target, result.target), ['# 任务', '- [ ] X'].join('\n'));
	assert.equal(result.targetNewStartLine, 1);
});

test('6 目标为空文件 / 仅 frontmatter → null（T10）', () => {
	const drop = { kind: 'task', line: 0, position: 'before' };
	assert.equal(moveTaskBlockAcrossNotes(SOURCE, '', 2, drop), null);
	assert.equal(
		moveTaskBlockAcrossNotes(SOURCE, ['---', 'P: 1', '---', ''].join('\n'), 2, drop),
		null,
	);
});

test('7 目标无任何标题（只有引导区）→ 落进引导区末，不返回 null', () => {
	const target = ['- [ ] A', '- [ ] B'].join('\n');
	const result = moveTaskBlockAcrossNotes(SOURCE, target, 2, {
		kind: 'section',
		sectionStartLine: 0,
		position: 'end',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(target, result.target),
		['- [ ] A', '- [ ] B', '- [ ] X'].join('\n'),
	);
});

test('8 源 2 级 → 目标 0 级：整块 dedent，相对层级不变', () => {
	const source = ['# 源', '', '- [ ] P', '  - [ ] X', '    - [ ] X1'].join('\n');
	const target = ['# 任务', '- [ ] A'].join('\n');
	const result = moveTaskBlockAcrossNotes(source, target, 3, {
		kind: 'task',
		line: 1,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(target, result.target),
		['# 任务', '- [ ] A', '- [ ] X', '  - [ ] X1'].join('\n'),
	);
});

test('9 源 0 级 → 目标 2 级：整块 indent，tab 折 2 列', () => {
	const source = ['# 源', '', '- [ ] X'].join('\n');
	const target = ['# 任务', '- [ ] A', '\t- [ ] A1'].join('\n');
	const result = moveTaskBlockAcrossNotes(source, target, 2, {
		kind: 'task',
		line: 2,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(target, result.target),
		['# 任务', '- [ ] A', '\t- [ ] A1', '  - [ ] X'].join('\n'),
	);
});

test('10 删除缝：散文相邻 → 恰好保留 1 空行', () => {
	const source = ['# 源', '', '- [ ] X', '', '正文'].join('\n');
	const result = moveTaskBlockAcrossNotes(source, ['- [ ] A'].join('\n'), 2, {
		kind: 'task',
		line: 0,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(source, result.source),
		['# 源', '', '正文'].join('\n'),
	);
});

test('11 删除缝：任务相邻 → 0 空行', () => {
	const source = ['- [ ] A', '- [ ] X', '- [ ] B'].join('\n');
	const result = moveTaskBlockAcrossNotes(source, ['- [ ] T'].join('\n'), 1, {
		kind: 'task',
		line: 0,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(applyEdit(source, result.source), ['- [ ] A', '- [ ] B'].join('\n'));
});

test('12 插入缝：散文邻 1 空行 / 任务邻 0 空行', () => {
	const source = ['- [ ] X'].join('\n');
	const proseTarget = ['正文', '- [ ] A'].join('\n');
	const proseResult = moveTaskBlockAcrossNotes(source, proseTarget, 0, {
		kind: 'task',
		line: 1,
		position: 'before',
	});
	assert.ok(proseResult);
	assert.equal(
		applyEdit(proseTarget, proseResult.target),
		['正文', '', '- [ ] X', '- [ ] A'].join('\n'),
	);

	const taskTarget = ['- [ ] A', '- [ ] B'].join('\n');
	const taskResult = moveTaskBlockAcrossNotes(source, taskTarget, 0, {
		kind: 'task',
		line: 1,
		position: 'before',
	});
	assert.ok(taskResult);
	assert.equal(
		applyEdit(taskTarget, taskResult.target),
		['- [ ] A', '- [ ] X', '- [ ] B'].join('\n'),
	);
});

test('13 文件首 / 尾边缘：保持原空行形态（含 EOF 空串）', () => {
	const source = '- [ ] X';

	const headTarget = ['- [ ] A', ''].join('\n');
	const headResult = moveTaskBlockAcrossNotes(source, headTarget, 0, {
		kind: 'task',
		line: 0,
		position: 'before',
	});
	assert.ok(headResult);
	assert.equal(
		applyEdit(headTarget, headResult.target),
		['- [ ] X', '- [ ] A', ''].join('\n'),
	);

	const tailTarget = ['- [ ] A', ''].join('\n');
	const tailResult = moveTaskBlockAcrossNotes(source, tailTarget, 0, {
		kind: 'task',
		line: 0,
		position: 'after',
	});
	assert.ok(tailResult);
	assert.equal(
		applyEdit(tailTarget, tailResult.target),
		['- [ ] A', '- [ ] X', ''].join('\n'),
	);
});

test('14 CRLF 文件：\\r 随行走，写回仍 CRLF', () => {
	const source = ['# 源\r', '- [ ] X\r', '- [ ] Y'].join('\n');
	const target = ['# 任务\r', '- [ ] A'].join('\n');
	const result = moveTaskBlockAcrossNotes(source, target, 1, {
		kind: 'task',
		line: 1,
		position: 'before',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(source, result.source),
		['# 源\r', '- [ ] Y'].join('\n'),
	);
	assert.equal(
		applyEdit(target, result.target),
		['# 任务\r', '- [ ] X\r', '- [ ] A'].join('\n'),
	);
});

test('15 frontmatter 不进任何一段编辑区间', () => {
	const source = ['---', 'P: 1', '---', '- [ ] X'].join('\n');
	const target = ['---', 'P: 2', '---', '- [ ] A'].join('\n');
	const result = moveTaskBlockAcrossNotes(source, target, 3, {
		kind: 'task',
		line: 3,
		position: 'before',
	});
	assert.ok(result);
	assert.ok(result.source.startLine > 2);
	assert.ok(result.target.startLine > 2);
	assert.equal(applyEdit(source, result.source), ['---', 'P: 1', '---'].join('\n'));
	assert.equal(
		applyEdit(target, result.target),
		['---', 'P: 2', '---', '- [ ] X', '- [ ] A'].join('\n'),
	);
});

test('16 源行号 / 落点行号不存在 → null', () => {
	const target = ['- [ ] A'].join('\n');
	assert.equal(
		moveTaskBlockAcrossNotes('- [ ] X', target, 9, {
			kind: 'task',
			line: 0,
			position: 'before',
		}),
		null,
	);
	assert.equal(
		moveTaskBlockAcrossNotes('- [ ] X', target, 0, {
			kind: 'task',
			line: 9,
			position: 'before',
		}),
		null,
	);
	assert.equal(
		moveTaskBlockAcrossNotes('- [ ] X', target, 0, {
			kind: 'section',
			sectionStartLine: 7,
			position: 'end',
		}),
		null,
	);
});

test('17 targetNewStartLine 精确（含空行规范化）', () => {
	const source = ['- [ ] X'].join('\n');
	const target = ['正文', '- [ ] A'].join('\n');
	const result = moveTaskBlockAcrossNotes(source, target, 0, {
		kind: 'task',
		line: 1,
		position: 'before',
	});
	assert.ok(result);
	const lines = applyEdit(target, result.target).split('\n');
	assert.equal(lines[result.targetNewStartLine], '- [ ] X');
	assert.equal(result.targetNewStartLine, 2);
});

test('18 appendTaskBlockToNote 三分支：命中节末 / 空节首行 / 文末新建标题', () => {
	const block = ['  - [ ] X'];

	// ① 命中节且有任务 → 该节末个顶层块之后
	const hit = ['# 任务', '- [ ] A', '- [ ] B', '', '# 其他', '- [ ] C'].join('\n');
	const hitResult = appendTaskBlockToNote(hit, block, 1, '任务');
	assert.ok(hitResult);
	assert.equal(
		applyEdit(hit, hitResult.edit),
		['# 任务', '- [ ] A', '- [ ] B', '- [ ] X', '', '# 其他', '- [ ] C'].join('\n'),
	);

	// ② 命中节但无任务 → 标题下一行、0 级
	const empty = ['# 任务', '', '# 其他'].join('\n');
	const emptyResult = appendTaskBlockToNote(empty, block, 1, '任务');
	assert.ok(emptyResult);
	assert.equal(
		applyEdit(empty, emptyResult.edit),
		['# 任务', '- [ ] X', '', '# 其他'].join('\n'),
	);

	// ③ 未命中 → 文末新建标题 + 任务行
	const miss = ['# 其他', '- [ ] C'].join('\n');
	const missResult = appendTaskBlockToNote(miss, block, 1, '任务');
	assert.ok(missResult);
	assert.equal(
		applyEdit(miss, missResult.edit),
		['# 其他', '- [ ] C', '', '# 任务', '- [ ] X'].join('\n'),
	);

	// 空文件也合法（A′/B 的文末新建通道）
	const blankResult = appendTaskBlockToNote('', block, 1, '任务');
	assert.ok(blankResult);
	assert.equal(applyEdit('', blankResult.edit), ['# 任务', '- [ ] X'].join('\n'));

	// 标题为空串 → null
	assert.equal(appendTaskBlockToNote(miss, block, 1, ''), null);
});

test('extractTaskBlock：整棵子树 + 续行一并取出', () => {
	const content = ['- [ ] X', '  - [ ] X1', '    续行', '- [ ] Y'].join('\n');
	const block = extractTaskBlock(content, 0);
	assert.ok(block);
	assert.deepEqual(block.blockLines, ['- [ ] X', '  - [ ] X1', '    续行']);
	assert.equal(block.level, 0);
	assert.equal(block.startLine, 0);
	assert.equal(block.endLine, 2);
	assert.equal(extractTaskBlock(content, 1)?.endLine, 2);
});

test('insertTaskBlock：纯函数入口与 moveTaskBlockAcrossNotes 同口径', () => {
	const target = ['- [ ] A'].join('\n');
	const inserted = insertTaskBlock(target, ['- [ ] X'], 0, {
		kind: 'task',
		line: 0,
		position: 'after',
	});
	assert.ok(inserted);
	assert.equal(applyEdit(target, inserted.edit), ['- [ ] A', '- [ ] X'].join('\n'));
	assert.equal(insertTaskBlock(target, [], 0, { kind: 'task', line: 0, position: 'after' }), null);
});
