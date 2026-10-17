import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { moveTaskBlock } = await jiti.import(
	'../src/tasks-center/note-structure.ts',
);

/** 按结果重组整篇，便于断言最终文本。 */
function applyResult(content, result) {
	const lines = content.split('\n');
	return [
		...lines.slice(0, result.startLine),
		...result.nextLines,
		...lines.slice(result.endLine + 1),
	].join('\n');
}

test('同章节相邻重排：A 拖到 B 后 → BA', () => {
	const content = ['- [ ] A', '- [ ] B'].join('\n');
	const result = moveTaskBlock(content, 0, { kind: 'task', line: 1, position: 'after' });
	assert.ok(result);
	assert.equal(applyResult(content, result), '- [ ] B\n- [ ] A');
	assert.equal(result.movedNewStartLine, 1);
});

test('等价槽位 no-op：A 拖到 B 前 / B 拖到 A 后 → null', () => {
	const content = '- [ ] A\n- [ ] B';
	assert.equal(
		moveTaskBlock(content, 0, { kind: 'task', line: 1, position: 'before' }),
		null,
	);
	assert.equal(
		moveTaskBlock(content, 1, { kind: 'task', line: 0, position: 'after' }),
		null,
	);
});

test('子树随行：A（含子任务 A1）拖到 B 后，缩进不变', () => {
	const content = ['- [ ] A', '  - [ ] A1', '- [ ] B'].join('\n');
	const result = moveTaskBlock(content, 0, {
		kind: 'task',
		line: 2,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['- [ ] B', '- [ ] A', '  - [ ] A1'].join('\n'),
	);
	assert.equal(result.mapLine(1), 2);
});

test('整块重缩进：二级子任务拖到一级任务旁 → 整块提升一级', () => {
	const content = [
		'- [ ] A',
		'  - [ ] A1',
		'  - [ ] A2',
		'- [ ] B',
	].join('\n');
	const result = moveTaskBlock(content, 1, {
		kind: 'task',
		line: 3,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		[
			'- [ ] A',
			'  - [ ] A2',
			'- [ ] B',
			'- [ ] A1',
		].join('\n'),
	);
});

test('整块重缩进：二级任务（含三级孙任务）整体提升，相对层级不变', () => {
	const content = [
		'- [ ] A',
		'  - [ ] C',
		'    - [ ] C1',
		'- [ ] B',
	].join('\n');
	const result = moveTaskBlock(content, 1, {
		kind: 'task',
		line: 3,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		[
			'- [ ] A',
			'- [ ] B',
			'- [ ] C',
			'  - [ ] C1',
		].join('\n'),
	);
});

test('跨层级挂载：B 拖到 A1 前 → B 成为 A 的子任务', () => {
	const content = ['- [ ] A', '  - [ ] A1', '- [ ] B'].join('\n');
	const result = moveTaskBlock(content, 2, {
		kind: 'task',
		line: 1,
		position: 'before',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['- [ ] A', '  - [ ] B', '  - [ ] A1'].join('\n'),
	);
});

test('跨章节：S1 的 a 拖到 S2 的 b 之后，删除缝空行按标题相邻收敛', () => {
	const content = ['# S1', '- [ ] a', '', '# S2', '- [ ] b'].join('\n');
	const result = moveTaskBlock(content, 1, {
		kind: 'task',
		line: 4,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['# S1', '# S2', '- [ ] b', '- [ ] a'].join('\n'),
	);
});

test('跨章节反向：S2 的 b 拖到 S1 的 a 之前，段内空行原样保留', () => {
	const content = ['# S1', '- [ ] a', '', '# S2', '- [ ] b'].join('\n');
	const result = moveTaskBlock(content, 4, {
		kind: 'task',
		line: 1,
		position: 'before',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['# S1', '- [ ] b', '- [ ] a', '', '# S2'].join('\n'),
	);
});

test('成环保护：父任务落进自身子树 → null', () => {
	const content = ['- [ ] A', '  - [ ] A1', '  - [ ] A2'].join('\n');
	assert.equal(
		moveTaskBlock(content, 0, { kind: 'task', line: 1, position: 'before' }),
		null,
	);
	assert.equal(
		moveTaskBlock(content, 0, { kind: 'task', line: 2, position: 'after' }),
		null,
	);
});

test('章节落点 start：任务插到目标章节首个任务之前', () => {
	const content = [
		'# S1',
		'- [ ] a',
		'',
		'# S2',
		'- [ ] b1',
		'- [ ] b2',
	].join('\n');
	const result = moveTaskBlock(content, 1, {
		kind: 'section',
		sectionStartLine: 3,
		position: 'start',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		[
			'# S1',
			'# S2',
			'- [ ] a',
			'- [ ] b1',
			'- [ ] b2',
		].join('\n'),
	);
});

test('章节落点 end：任务插到目标章节末个任务块之后', () => {
	const content = [
		'# S1',
		'- [ ] a',
		'',
		'# S2',
		'- [ ] b1',
		'  - [ ] b1x',
	].join('\n');
	const result = moveTaskBlock(content, 1, {
		kind: 'section',
		sectionStartLine: 3,
		position: 'end',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		[
			'# S1',
			'# S2',
			'- [ ] b1',
			'  - [ ] b1x',
			'- [ ] a',
		].join('\n'),
	);
});

test('章节落点：空章节（只有标题）start/end 都落在标题下一行、0 级', () => {
	const content = ['# S1', '- [ ] a', '# S2'].join('\n');
	for (const position of ['start', 'end']) {
		const result = moveTaskBlock(content, 1, {
			kind: 'section',
			sectionStartLine: 2,
			position,
		});
		assert.ok(result, `position=${position}`);
		assert.equal(
			applyResult(content, result),
			['# S1', '# S2', '- [ ] a'].join('\n'),
			`position=${position}`,
		);
	}
});

test('散文隔离：任务插到段落旁时恰好补 1 个空行（上邻散文）', () => {
	const content = ['para', '- [ ] a', '- [ ] b'].join('\n');
	const result = moveTaskBlock(content, 2, {
		kind: 'task',
		line: 1,
		position: 'before',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['para', '', '- [ ] b', '- [ ] a'].join('\n'),
	);
});

test('目标卡带续行散文：移动块落在续行之后，块间保留 1 空行，续行仍归属目标卡', () => {
	// `note` 在解析口径里是 b 卡的 lazy continuation（见 isTaskContinuationLine），
	// 随 b 块参与锚点计算；外来任务落在其后时补 1 空行，边界无歧义。
	const content = ['- [ ] a', '- [ ] b', 'note'].join('\n');
	const result = moveTaskBlock(content, 0, {
		kind: 'task',
		line: 1,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['- [ ] b', 'note', '', '- [ ] a'].join('\n'),
	);
});

test('删除缝：跨多空行把任务移走，散文锚点间多连空行收敛为 1', () => {
	const content = [
		'para1',
		'- [ ] a',
		'',
		'',
		'para2',
		'- [ ] b',
	].join('\n');
	const result = moveTaskBlock(content, 1, {
		kind: 'task',
		line: 5,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['para1', '', 'para2', '- [ ] b', '- [ ] a'].join('\n'),
	);
});

test('续行随父移动并随父重缩进', () => {
	const content = [
		'- [ ] A',
		'  - [ ] C',
		'    note line',
		'- [ ] B',
	].join('\n');
	const result = moveTaskBlock(content, 1, {
		kind: 'task',
		line: 3,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['- [ ] A', '- [ ] B', '- [ ] C', '  note line'].join('\n'),
	);
});

test('mapLine：移动行、未动行、被删空行、后续标题位移全部正确', () => {
	const content = ['# S1', '- [ ] a', '', '# S2', '- [ ] b'].join('\n');
	const result = moveTaskBlock(content, 1, {
		kind: 'task',
		line: 4,
		position: 'after',
	});
	assert.ok(result);
	// 结果：# S1(0) # S2(1) b(2) a(3)
	assert.equal(result.mapLine(0), 0);
	assert.equal(result.mapLine(1), 3); // a
	assert.equal(result.mapLine(2), null); // 被规范化掉的空行
	assert.equal(result.mapLine(3), 1); // # S2
	assert.equal(result.mapLine(4), 2); // b
	assert.equal(result.mapLine(null), null);
	assert.equal(result.mapLine(99), null);
});

test('CRLF：行尾 \\r 随行走，frontmatter 不进提交范围', () => {
	const content = ['---', 'Project: x', '---', '- [ ] A', '- [ ] B'].join(
		'\n',
	);
	const result = moveTaskBlock(content, 3, {
		kind: 'task',
		line: 4,
		position: 'after',
	});
	assert.ok(result);
	assert.ok(result.startLine >= 3);
	assert.equal(
		applyResult(content, result),
		'---\nProject: x\n---\n- [ ] B\n- [ ] A',
	);

	const crlf = '- [ ] A\r\n- [ ] B';
	const crlfResult = moveTaskBlock(crlf, 0, {
		kind: 'task',
		line: 1,
		position: 'after',
	});
	assert.ok(crlfResult);
	assert.equal(
		applyResult(crlf, crlfResult),
		'- [ ] B\n- [ ] A\r',
	);
});

test('非法入参：源行 / 目标行 / 章节不存在 → null', () => {
	const content = '# S\n- [ ] a';
	assert.equal(
		moveTaskBlock(content, 9, { kind: 'task', line: 1, position: 'after' }),
		null,
	);
	assert.equal(
		moveTaskBlock(content, 1, { kind: 'task', line: 9, position: 'after' }),
		null,
	);
	assert.equal(
		moveTaskBlock(content, 1, {
			kind: 'section',
			sectionStartLine: 9,
			position: 'start',
		}),
		null,
	);
});
