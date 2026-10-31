/**
 * 跨文件整组搬运的纯函数测试（[[Plan-20261101-070535]] §四.步骤 6）。
 *
 * 三条主线：
 * 1. 多块插入 / 追加（`insertTaskBlocks` / `appendTaskBlocksToNote`）；
 * 2. 组提取与两段编辑的编排（`extractTaskBlocks` / `moveTaskBlocksAcrossNotes`）；
 * 3. **单块等价性**——两个单块入口已改为委托多块版，靠逐字节断言钉住零回归。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	appendTaskBlockToNote,
	appendTaskBlocksToNote,
	extractTaskBlocks,
	insertTaskBlock,
	insertTaskBlocks,
	removeTaskBlockFromNote,
} = await jiti.import('../src/tasks-center/note-task-transfer.ts');
const { moveTaskBlocksAcrossNotes } = await jiti.import(
	'../src/tasks-center/note-task-multi-transfer.ts',
);
const { buildMultiRemovalEdit } = await jiti.import(
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

/** 两块 0 级任务（`TransferBlock` 的最小形态）。 */
const twoBlocks = () => [
	{ blockLines: ['- [ ] A'], level: 0 },
	{ blockLines: ['- [ ] B'], level: 0 },
];

test('两块落到节末 → 组内相邻 0 空行、顺序 = 原文件顺序', () => {
	const content = ['# 任务', '- [ ] X', '- [ ] Y'].join('\n');
	const result = insertTaskBlocks(content, twoBlocks(), {
		kind: 'section',
		sectionStartLine: 0,
		position: 'end',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(content, result.edit),
		['# 任务', '- [ ] X', '- [ ] Y', '- [ ] A', '- [ ] B'].join('\n'),
	);
	assert.deepEqual(result.newStartLines, [3, 4]);
});

test('两块落到节首 → 组内相邻 0 空行、顺序 = 原文件顺序', () => {
	const content = ['# 任务', '- [ ] X', '- [ ] Y'].join('\n');
	const result = insertTaskBlocks(content, twoBlocks(), {
		kind: 'section',
		sectionStartLine: 0,
		position: 'start',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(content, result.edit),
		['# 任务', '- [ ] A', '- [ ] B', '- [ ] X', '- [ ] Y'].join('\n'),
	);
	assert.deepEqual(result.newStartLines, [1, 2]);
});

test('不同层级两块落到 0 级卡旁 → 各自重缩进，子树相对缩进不变', () => {
	const content = ['- [ ] X', '- [ ] Y'].join('\n');
	const result = insertTaskBlocks(
		content,
		[
			{ blockLines: ['- [ ] A', '  - [ ] a1'], level: 0 },
			{ blockLines: ['    - [ ] B', '      - [ ] b1'], level: 2 },
		],
		{ kind: 'task', line: 0, position: 'after' },
	);
	assert.ok(result);
	assert.equal(
		applyEdit(content, result.edit),
		[
			'- [ ] X',
			'- [ ] A',
			'  - [ ] a1',
			'- [ ] B',
			'  - [ ] b1',
			'- [ ] Y',
		].join('\n'),
	);
	assert.deepEqual(result.newStartLines, [1, 3]);
});

test('段首是散文 → 补 1 空行；段尾是散文 → 只补不删', () => {
	const blocks = [{ blockLines: ['- [ ] A'], level: 0 }];

	const before = ['散文段落', '', '- [ ] X'].join('\n');
	const beforeResult = insertTaskBlocks(before, blocks, {
		kind: 'task',
		line: 2,
		position: 'before',
	});
	assert.ok(beforeResult);
	assert.equal(
		applyEdit(before, beforeResult.edit),
		['散文段落', '', '- [ ] A', '- [ ] X'].join('\n'),
	);

	const after = ['- [ ] X', '', '尾部散文'].join('\n');
	const afterResult = insertTaskBlocks(after, blocks, {
		kind: 'task',
		line: 0,
		position: 'after',
	});
	assert.ok(afterResult);
	assert.equal(
		applyEdit(after, afterResult.edit),
		['- [ ] X', '- [ ] A', '', '尾部散文'].join('\n'),
	);
});

test('目标文件首 / 文件尾（含末尾空串）两个边缘落点', () => {
	const content = ['- [ ] X', '- [ ] Y', ''].join('\n');
	const blocks = [{ blockLines: ['- [ ] A'], level: 0 }];

	const head = insertTaskBlocks(content, blocks, {
		kind: 'task',
		line: 0,
		position: 'before',
	});
	assert.ok(head);
	assert.equal(
		applyEdit(content, head.edit),
		['- [ ] A', '- [ ] X', '- [ ] Y', ''].join('\n'),
	);

	const tail = insertTaskBlocks(content, blocks, {
		kind: 'task',
		line: 1,
		position: 'after',
	});
	assert.ok(tail);
	assert.equal(
		applyEdit(content, tail.edit),
		['- [ ] X', '- [ ] Y', '- [ ] A', ''].join('\n'),
	);
});

test('目标空文件 → 追加通道的等长替换特例，不凭空多尾空行', () => {
	const result = appendTaskBlocksToNote(
		'',
		[
			{ blockLines: ['- [ ] A'], level: 0 },
			{ blockLines: ['  - [ ] B'], level: 1 },
		],
		'任务',
	);
	assert.ok(result);
	assert.equal(
		applyEdit('', result.edit),
		['# 任务', '- [ ] A', '- [ ] B'].join('\n'),
	);
	assert.deepEqual(result.newStartLines, [1, 2]);
});

test('CRLF 目标文件 → 既有行的 \\r 全部保留', () => {
	const content = ['# 任务\r', '- [ ] X\r', '- [ ] Y\r', ''].join('\n');
	const result = insertTaskBlocks(
		content,
		[{ blockLines: ['- [ ] A'], level: 0 }],
		{ kind: 'section', sectionStartLine: 0, position: 'end' },
	);
	assert.ok(result);
	const lines = applyEdit(content, result.edit).split('\n');
	assert.deepEqual(lines, [
		'# 任务\r',
		'- [ ] X\r',
		'- [ ] Y\r',
		'- [ ] A',
		'',
	]);
});

test('目标带 frontmatter → 插入窗口不卷 frontmatter', () => {
	const content = ['---', 'tags: [a]', '---', '# 任务', '- [ ] X'].join('\n');
	const result = insertTaskBlocks(
		content,
		[{ blockLines: ['- [ ] A'], level: 0 }],
		{ kind: 'section', sectionStartLine: 3, position: 'start' },
	);
	assert.ok(result);
	assert.ok(result.edit.startLine >= 4, '窗口必须落在 frontmatter 之后');
	assert.equal(
		applyEdit(content, result.edit),
		['---', 'tags: [a]', '---', '# 任务', '- [ ] A', '- [ ] X'].join('\n'),
	);
});

test('extractTaskBlocks：父子同选只留外层、无效行号跳过、按 startLine 升序', () => {
	const content = ['# 任务', '- [ ] P', '  - [ ] C', '- [ ] Q'].join('\n');
	const blocks = extractTaskBlocks(content, [1, 2, 9, 3]);
	assert.deepEqual(blocks, [
		{
			blockLines: ['- [ ] P', '  - [ ] C'],
			level: 0,
			startLine: 1,
			endLine: 2,
		},
		{ blockLines: ['- [ ] Q'], level: 0, startLine: 3, endLine: 3 },
	]);
});

test('appendTaskBlocksToNote：命中节 → 节末', () => {
	const content = ['# 任务', '- [ ] X'].join('\n');
	const result = appendTaskBlocksToNote(
		content,
		[{ blockLines: ['- [ ] A'], level: 0 }],
		'任务',
	);
	assert.ok(result);
	assert.equal(
		applyEdit(content, result.edit),
		['# 任务', '- [ ] X', '- [ ] A'].join('\n'),
	);
	assert.deepEqual(result.newStartLines, [2]);
});

test('appendTaskBlocksToNote：未命中节 → 文末新建标题 + 整组', () => {
	const content = ['# 其他', '正文'].join('\n');
	const result = appendTaskBlocksToNote(
		content,
		[
			{ blockLines: ['- [ ] A'], level: 0 },
			{ blockLines: ['  - [ ] B'], level: 1 },
		],
		'任务',
	);
	assert.ok(result);
	assert.equal(
		applyEdit(content, result.edit),
		['# 其他', '正文', '', '# 任务', '- [ ] A', '- [ ] B'].join('\n'),
	);
	assert.deepEqual(result.newStartLines, [4, 5]);
});

test('appendTaskBlocksToNote：空标题（语言包缺键）/ 空组 → null', () => {
	assert.equal(
		appendTaskBlocksToNote(
			'# 任务',
			[{ blockLines: ['- [ ] A'], level: 0 }],
			'  ',
		),
		null,
	);
	assert.equal(appendTaskBlocksToNote('# 任务', [], '任务'), null);
	assert.equal(
		appendTaskBlocksToNote('# 任务', [{ blockLines: [], level: 0 }], '任务'),
		null,
	);
});

test('moveTaskBlocksAcrossNotes：两段编辑互不依赖，各自可单独重组', () => {
	const source = ['# 任务', '- [ ] A', '  - [ ] a1', '- [ ] B', '- [ ] C'].join(
		'\n',
	);
	const target = ['# 任务', '- [ ] X'].join('\n');
	const result = moveTaskBlocksAcrossNotes(source, target, [1, 4], {
		kind: 'section',
		sectionStartLine: 0,
		position: 'end',
	});
	assert.ok(result);
	// 目标先应用、源后应用：两边的期望结果与「单独应用」完全一致。
	assert.equal(
		applyEdit(target, result.target),
		['# 任务', '- [ ] X', '- [ ] A', '  - [ ] a1', '- [ ] C'].join('\n'),
	);
	assert.equal(
		applyEdit(source, result.source.edit),
		['# 任务', '- [ ] B'].join('\n'),
	);
	// 源侧窗口只覆盖被搬走的块，不越界。
	assert.equal(result.source.edit.startLine, 1);
	assert.equal(result.source.edit.endLine, 4);
});

test('moveTaskBlocksAcrossNotes：组内相对顺序 + targetNewStartLines 逐块偏移', () => {
	const source = ['- [ ] A', '', '- [ ] B'].join('\n');
	const target = ['# 任务', '- [ ] X', '- [ ] Y'].join('\n');
	const result = moveTaskBlocksAcrossNotes(source, target, [2, 0], {
		kind: 'task',
		line: 1,
		position: 'before',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(target, result.target),
		['# 任务', '- [ ] A', '- [ ] B', '- [ ] X', '- [ ] Y'].join('\n'),
	);
	assert.deepEqual(result.targetNewStartLines, [1, 2]);
});

test('moveTaskBlocksAcrossNotes：源侧父子同选 → 目标只出现外层一次', () => {
	const source = ['- [ ] P', '  - [ ] C', '- [ ] Z'].join('\n');
	const target = ['- [ ] X'].join('\n');
	const result = moveTaskBlocksAcrossNotes(source, target, [0, 1], {
		kind: 'task',
		line: 0,
		position: 'after',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(target, result.target),
		['- [ ] X', '- [ ] P', '  - [ ] C'].join('\n'),
	);
	assert.equal(applyEdit(source, result.source.edit), ['- [ ] Z'].join('\n'));
});

test('源侧跨节多块 → 窗口内接缝空行按 kindOf 规范化（散文 1 行、标题 0 行）', () => {
	const source = ['# 节一', '- [ ] A', '', '# 节二', '散文', '- [ ] B', '- [ ] C'].join(
		'\n',
	);
	const target = ['# 任务', '- [ ] X'].join('\n');
	const result = moveTaskBlocksAcrossNotes(source, target, [1, 5], {
		kind: 'task',
		line: 1,
		position: 'before',
	});
	assert.ok(result);
	// 相邻标题之间不留空行；散文与后续任务之间留 1 空行。
	assert.equal(
		applyEdit(source, result.source.edit),
		['# 节一', '# 节二', '散文', '', '- [ ] C'].join('\n'),
	);
});

test('源侧块间散文留在源文件、不随组进目标', () => {
	const source = ['# 任务', '- [ ] A', '', '中间散文', '', '- [ ] B'].join('\n');
	const target = ['# 任务', '- [ ] X'].join('\n');
	const result = moveTaskBlocksAcrossNotes(source, target, [1, 5], {
		kind: 'section',
		sectionStartLine: 0,
		position: 'end',
	});
	assert.ok(result);
	assert.equal(
		applyEdit(target, result.target),
		['# 任务', '- [ ] X', '- [ ] A', '- [ ] B'].join('\n'),
	);
	assert.equal(
		applyEdit(source, result.source.edit),
		['# 任务', '', '中间散文', ''].join('\n'),
	);
});

test('非法输入：空组 / 行号全失效 / 落点 Section 不存在 → null', () => {
	assert.equal(
		insertTaskBlocks('- [ ] X', [], {
			kind: 'task',
			line: 0,
			position: 'after',
		}),
		null,
	);
	assert.equal(
		moveTaskBlocksAcrossNotes('- [ ] X', '- [ ] Y', [9], {
			kind: 'task',
			line: 0,
			position: 'after',
		}),
		null,
	);
	assert.equal(
		insertTaskBlocks(
			'- [ ] X',
			[{ blockLines: ['- [ ] A'], level: 0 }],
			{ kind: 'section', sectionStartLine: 7, position: 'end' },
		),
		null,
	);
});

test('单块等价性 · 插入：insertTaskBlock ≡ insertTaskBlocks([1 块])', () => {
	const samples = [
		['# 任务', '- [ ] X', '- [ ] Y'].join('\n'),
		['散文', '', '- [ ] X'].join('\n'),
		['- [ ] X', '', '尾部散文'].join('\n'),
		['- [ ] X', '', ''].join('\n'),
		['---', 'a: 1', '---', '# 任务', '- [ ] X'].join('\n'),
	];
	const drops = [
		{ kind: 'section', sectionStartLine: 0, position: 'end' },
		{ kind: 'task', line: 1, position: 'before' },
	];
	for (const content of samples) {
		for (const drop of drops) {
			const single = insertTaskBlock(content, ['- [ ] A', '  - [ ] a1'], 1, drop);
			const multi = insertTaskBlocks(
				content,
				[{ blockLines: ['- [ ] A', '  - [ ] a1'], level: 1 }],
				drop,
			);
			if (!multi) {
				assert.equal(single, null);
				continue;
			}
			assert.ok(single);
			assert.deepEqual(single.edit, multi.edit);
			assert.equal(single.newStartLine, multi.newStartLines[0]);
		}
	}
});

test('单块等价性 · 删除：removeTaskBlockFromNote ≡ buildMultiRemovalEdit([1 行]).edit', () => {
	const samples = [
		{ content: ['- [ ] A'].join('\n'), line: 0 },
		{ content: ['- [ ] A', '  - [ ] a1'].join('\n'), line: 0 },
		{ content: ['- [ ] A', '- [ ] B'].join('\n'), line: 1 },
		{ content: ['- [ ] A', '- [ ] B', ''].join('\n'), line: 1 },
		{ content: ['# S', '', '- [ ] A', ''].join('\n'), line: 2 },
		{ content: ['- [ ] A\r', '- [ ] B\r'].join('\n'), line: 1 },
	];
	for (const { content, line } of samples) {
		const single = removeTaskBlockFromNote(content, line);
		const multi = buildMultiRemovalEdit(content, [line]);
		// 逐字节等价（含「两边都判不出块」这一档，例如 CRLF 任务行）。
		assert.equal(JSON.stringify(single), JSON.stringify(multi?.edit ?? null));
	}
	// 非任务行：两侧都不产编辑。
	assert.equal(removeTaskBlockFromNote('正文', 0), null);
	assert.equal(buildMultiRemovalEdit('正文', [0]), null);
});
