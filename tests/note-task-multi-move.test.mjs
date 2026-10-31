import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { moveTaskBlock, moveTaskBlocks, normalizeMoveBlocks } = await jiti.import(
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

test('两不相邻块拖到同节末 → 相对顺序保持', () => {
	const content = ['- [ ] A', '- [ ] B', '- [ ] C', '- [ ] D'].join('\n');
	const result = moveTaskBlocks(content, [0, 2], {
		kind: 'task',
		line: 3,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['- [ ] B', '- [ ] D', '- [ ] A', '- [ ] C'].join('\n'),
	);
});

test('两不相邻块拖到该节首 → 相对顺序保持', () => {
	const content = ['# S', '- [ ] A', '- [ ] B', '- [ ] C'].join('\n');
	const result = moveTaskBlocks(content, [1, 3], {
		kind: 'section',
		sectionStartLine: 0,
		position: 'start',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['# S', '- [ ] A', '- [ ] C', '- [ ] B'].join('\n'),
	);
});

test('三块跨 Section 上移（落点 = 上一节末）', () => {
	const content = [
		'# S1',
		'- [ ] a',
		'# S2',
		'- [ ] b',
		'- [ ] c',
		'- [ ] d',
	].join('\n');
	const result = moveTaskBlocks(content, [3, 4, 5], {
		kind: 'section',
		sectionStartLine: 0,
		position: 'end',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['# S1', '- [ ] a', '- [ ] b', '- [ ] c', '- [ ] d', '# S2'].join(
			'\n',
		),
	);
});

test('0 级 + 2 级两块一起落到 0 级卡旁 → 各自重缩进到同级', () => {
	const content = [
		'- [ ] A',
		'- [ ] P',
		'  - [ ] X',
		'    - [ ] Y',
		'- [ ] B',
	].join('\n');
	const result = moveTaskBlocks(content, [0, 3], {
		kind: 'task',
		line: 4,
		position: 'before',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['- [ ] P', '  - [ ] X', '- [ ] A', '- [ ] Y', '- [ ] B'].join('\n'),
	);
	assert.deepEqual(result.movedNewStartLines, [2, 3]);
});

test('1 级块（带 2 级子树）落到 0 级卡旁 → 子树相对层级不变', () => {
	const content = ['- [ ] A', '  - [ ] P', '    - [ ] Q', '- [ ] B'].join(
		'\n',
	);
	const result = moveTaskBlocks(content, [1], {
		kind: 'task',
		line: 3,
		position: 'before',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['- [ ] A', '- [ ] P', '  - [ ] Q', '- [ ] B'].join('\n'),
	);
	assert.equal(result.mapLine(1), 1);
	assert.equal(result.mapLine(2), 2);
});

test('父子同选 → 只搬外层，子块不重复出现', () => {
	const content = ['- [ ] A', '  - [ ] A1', '- [ ] B'].join('\n');
	const blocks = normalizeMoveBlocks(content, [0, 1]);
	assert.deepEqual(blocks, [{ startLine: 0, endLine: 1, level: 0 }]);
	const result = moveTaskBlocks(content, [0, 1], {
		kind: 'task',
		line: 2,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['- [ ] B', '- [ ] A', '  - [ ] A1'].join('\n'),
	);
	assert.equal(result.movedNewStartLines.length, 1);
});

test('落点落在自身子树内 → null（成环）', () => {
	const content = ['- [ ] A', '  - [ ] A1', '- [ ] B'].join('\n');
	assert.equal(
		moveTaskBlocks(content, [0], { kind: 'task', line: 1, position: 'before' }),
		null,
	);
	// 组内含父块时同样拒绝：落进父块的子树
	assert.equal(
		moveTaskBlocks(content, [0, 2], {
			kind: 'task',
			line: 1,
			position: 'before',
		}),
		null,
	);
});

test('落点紧贴最后一块块尾 → null（等价槽位）', () => {
	// 单块拖到自己的块尾之后
	const content = '- [ ] A\n- [ ] B';
	assert.equal(
		moveTaskBlocks(content, [0], { kind: 'task', line: 0, position: 'after' }),
		null,
	);
	// 整组正好搬到「末块末+1」：组后面紧跟目标卡
	const content2 = ['- [ ] A', '- [ ] B', '- [ ] C'].join('\n');
	assert.equal(
		moveTaskBlocks(content2, [0, 1], {
			kind: 'task',
			line: 1,
			position: 'after',
		}),
		null,
	);
});

test('落点紧贴中间块块尾、中间夹着未选中卡 → 非 no-op，后块上移一位', () => {
	const content = ['- [ ] A', '- [ ] B', '- [ ] C', '- [ ] D'].join('\n');
	const result = moveTaskBlocks(content, [0, 2], {
		kind: 'task',
		line: 0,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['- [ ] A', '- [ ] C', '- [ ] B', '- [ ] D'].join('\n'),
	);
});

test('两块紧邻时同一槽位 → null（组内顺序不变即 no-op）', () => {
	const content = ['- [ ] A', '- [ ] B', '- [ ] C'].join('\n');
	assert.equal(
		moveTaskBlocks(content, [0, 1], {
			kind: 'task',
			line: 0,
			position: 'after',
		}),
		null,
	);
});

test('接缝规范化：散文相邻恰好 1 空行，任务相邻 0 空行', () => {
	// `> prose` 是块级起点（不被任务行当续行吞掉），因此是真正的「散文」
	const content = ['# S', '- [ ] A', '> prose', '- [ ] B'].join('\n');
	const result = moveTaskBlocks(content, [1], {
		kind: 'task',
		line: 3,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['# S', '', '> prose', '- [ ] B', '- [ ] A'].join('\n'),
	);
});

test('首块在文件首 / 末块到 EOF（含末尾空串）', () => {
	const content = '- [ ] A\n- [ ] B\n';
	const result = moveTaskBlocks(content, [0], {
		kind: 'task',
		line: 1,
		position: 'after',
	});
	assert.ok(result);
	// 末尾空串（split 产生的最后一项）必须留在文件末
	assert.equal(applyResult(content, result), '- [ ] B\n- [ ] A\n');
});

test('CRLF 文件：\\r 随行，结果仍 CRLF', () => {
	const content = '- [ ] A\r\n- [ ] B\r\n- [ ] C';
	const result = moveTaskBlocks(content, [0], {
		kind: 'task',
		line: 2,
		position: 'after',
	});
	assert.ok(result);
	// 与 `note-task-move.test.mjs` 的既有断言同形态：`\r` 跟着自己的行走
	assert.equal(
		applyResult(content, result),
		'- [ ] B\r\n- [ ] C\n- [ ] A\r',
	);
});

test('frontmatter 不进窗口', () => {
	const content = [
		'---',
		'Project: x',
		'---',
		'- [ ] A',
		'- [ ] B',
	].join('\n');
	const result = moveTaskBlocks(content, [3], {
		kind: 'task',
		line: 4,
		position: 'after',
	});
	assert.ok(result);
	assert.ok(result.startLine > 2, 'startLine 必须落在 frontmatter 之后');
	assert.ok(result.endLine > 2, 'endLine 必须落在 frontmatter 之后');
	assert.equal(
		applyResult(content, result),
		['---', 'Project: x', '---', '- [ ] B', '- [ ] A'].join('\n'),
	);
});

test('mapLine：窗口外恒等、块内行映射到新位置、被规范化空行 → null', () => {
	const content = ['- [ ] A', '- [ ] B', '', '- [ ] C'].join('\n');
	const result = moveTaskBlocks(content, [0], {
		kind: 'task',
		line: 3,
		position: 'before',
	});
	assert.ok(result);
	assert.equal(applyResult(content, result), '- [ ] B\n- [ ] A\n- [ ] C');
	assert.equal(result.mapLine(0), 1); // A 下移到 1
	assert.equal(result.mapLine(1), 0); // B 上移到 0
	assert.equal(result.mapLine(2), null); // 被规范化掉的空行
	assert.equal(result.mapLine(3), 2); // C
	assert.equal(result.mapLine(9), null); // 表外
	assert.equal(result.mapLine(null), null);
});

test('movedNewStartLines 顺序与长度 = 归一后块数', () => {
	const content = [
		'- [ ] A',
		'- [ ] B',
		'- [ ] C',
		'- [ ] D',
		'- [ ] E',
	].join('\n');
	const result = moveTaskBlocks(content, [4, 0, 2], {
		kind: 'task',
		line: 1,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(result.movedNewStartLines.length, 3);
	const expected = applyResult(content, result).split('\n');
	assert.deepEqual(
		result.movedNewStartLines.map((line) => expected[line]),
		['- [ ] A', '- [ ] C', '- [ ] E'],
	);
});

test('单块等价性：与 moveTaskBlock 的整篇文本 / mapLine / null 判据一致', () => {
	const cases = [
		{
			content: ['- [ ] A', '- [ ] B'].join('\n'),
			from: 0,
			target: { kind: 'task', line: 1, position: 'after' },
		},
		{
			content: ['- [ ] A', '- [ ] B'].join('\n'),
			from: 0,
			target: { kind: 'task', line: 1, position: 'before' },
		},
		{
			content: ['- [ ] A', '  - [ ] A1', '- [ ] B'].join('\n'),
			from: 0,
			target: { kind: 'task', line: 2, position: 'after' },
		},
		{
			content: ['# S1', '- [ ] a', '', '# S2', '- [ ] b'].join('\n'),
			from: 1,
			target: { kind: 'task', line: 4, position: 'after' },
		},
		{
			content: ['- [ ] A', '- [ ] B', '', '- [ ] C'].join('\n'),
			from: 0,
			target: { kind: 'task', line: 3, position: 'before' },
		},
		{
			content: ['- [ ] A', '  - [ ] A1', '  - [ ] A2'].join('\n'),
			from: 0,
			target: { kind: 'task', line: 1, position: 'before' },
		},
		{
			content: ['# S1', '- [ ] a', '', '# S2', '- [ ] b1'].join('\n'),
			from: 1,
			target: { kind: 'section', sectionStartLine: 3, position: 'start' },
		},
	];
	for (const [index, entry] of cases.entries()) {
		const single = moveTaskBlock(entry.content, entry.from, entry.target);
		const multi = moveTaskBlocks(entry.content, [entry.from], entry.target);
		assert.equal(
			multi === null,
			single === null,
			`用例 ${index}：null 判据不一致`,
		);
		if (!single || !multi) {
			continue;
		}
		assert.equal(
			applyResult(entry.content, multi),
			applyResult(entry.content, single),
			`用例 ${index}：整篇文本不一致`,
		);
		assert.deepEqual(
			multi.originalLines,
			single.originalLines,
			`用例 ${index}：originalLines 不一致`,
		);
		const total = entry.content.split('\n').length + 1;
		for (let line = 0; line < total; line += 1) {
			assert.equal(
				multi.mapLine(line),
				single.mapLine(line),
				`用例 ${index}：mapLine(${line}) 不一致`,
			);
		}
	}
});

test('非法输入：空数组 / 行号不存在 / 全部无效 → null', () => {
	const content = ['- [ ] A', '- [ ] B'].join('\n');
	const target = { kind: 'task', line: 1, position: 'after' };
	assert.equal(moveTaskBlocks(content, [], target), null);
	assert.equal(moveTaskBlocks(content, [99], target), null);
	assert.equal(moveTaskBlocks(content, [99, 42], target), null);
	assert.deepEqual(normalizeMoveBlocks(content, []), []);
	assert.deepEqual(normalizeMoveBlocks(content, [99]), []);
});
