import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { reorderTopLevelSections, parseSections } = await jiti.import(
	'../src/tasks-center/note-structure.ts',
);

/** 按结果重组整篇，便于断言最终文本。 */
function applyResult(content, result) {
	const lines = content.split('\n');
	return [
		...lines.slice(0, result.startLine),
		...result.nextLines,
	]
		.join('\n');
}

test('两块：A 拖到 B 后 → BA，块间恰好一个空行', () => {
	const content = ['# A', '- [ ] a', '', '# B', '- [ ] b'].join('\n');
	const result = reorderTopLevelSections(content, 0, 3, 'after');
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['# B', '- [ ] b', '', '# A', '- [ ] a'].join('\n'),
	);
	assert.equal(result.startLine, 0);
	assert.equal(result.endLine, content.split('\n').length - 1);
	// 区间切片对齐
	assert.deepEqual(result.originalLines, content.split('\n'));
});

test('两块反向 no-op：A 拖到 B 前 / B 拖到 A 后 → null', () => {
	const content = '# A\n\n# B';
	assert.equal(reorderTopLevelSections(content, 0, 2, 'before'), null);
	assert.equal(reorderTopLevelSections(content, 2, 0, 'after'), null);
});

test('两块实际移动：B 拖到 A 前 → BA', () => {
	const content = '# A\n\n# B';
	const result = reorderTopLevelSections(content, 2, 0, 'before');
	assert.ok(result);
	assert.equal(applyResult(content, result), '# B\n\n# A');
});

test('三块：中间块移到最前', () => {
	const content = '# A\n\n# B\n\n# C';
	const lines = content.split('\n');
	const bLine = lines.indexOf('# B');
	const aLine = lines.indexOf('# A');
	const result = reorderTopLevelSections(content, bLine, aLine, 'before');
	assert.ok(result);
	assert.equal(applyResult(content, result), '# B\n\n# A\n\n# C');
});

test('三块：中间块移到最后', () => {
	const content = '# A\n\n# B\n\n# C';
	const lines = content.split('\n');
	const bLine = lines.indexOf('# B');
	const cLine = lines.indexOf('# C');
	const result = reorderTopLevelSections(content, bLine, cLine, 'after');
	assert.ok(result);
	assert.equal(applyResult(content, result), '# A\n\n# C\n\n# B');
});

test('三块等价槽位 no-op：B 拖到 A 后 / B 拖到 C 前 / C 拖到 B 后', () => {
	const content = '# A\n\n# B\n\n# C';
	const lines = content.split('\n');
	const a = lines.indexOf('# A');
	const b = lines.indexOf('# B');
	const c = lines.indexOf('# C');
	assert.equal(reorderTopLevelSections(content, b, a, 'after'), null);
	assert.equal(reorderTopLevelSections(content, b, c, 'before'), null);
	assert.equal(reorderTopLevelSections(content, c, b, 'after'), null);
});

test('无标题块（空文件 / 仅引导区）→ null', () => {
	assert.equal(reorderTopLevelSections('', 0, 0, 'before'), null);
	assert.equal(reorderTopLevelSections('一段导语\n没有标题', 0, 0, 'before'), null);
});

test('只有一个标题块 → null', () => {
	assert.equal(reorderTopLevelSections('# Only\n\n正文', 0, 0, 'before'), null);
});

test('非法参数：未命中的行号 → null', () => {
	const content = '# A\n\n# B';
	assert.equal(reorderTopLevelSections(content, 99, 0, 'before'), null);
	assert.equal(reorderTopLevelSections(content, 0, 99, 'after'), null);
});

test('嵌套标题随父块整体搬运，块内字节（含子标题与空行）不变', () => {
	const content = [
		'# A',
		'- [ ] a1',
		'',
		'## A1',
		'- [ ] a2',
		'',
		'# B',
		'- [ ] b1',
	].join('\n');
	const lines = content.split('\n');
	const aLine = 0;
	const bLine = lines.indexOf('# B');
	const result = reorderTopLevelSections(content, aLine, bLine, 'after');
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		[
			'# B',
			'- [ ] b1',
			'',
			'# A',
			'- [ ] a1',
			'',
			'## A1',
			'- [ ] a2',
		].join('\n'),
	);
});

test('块间多空行被规范化为 1 个；块内空行保留', () => {
	const content = [
		'# A',
		'- [ ] a1',
		'',
		'- [ ] a2',
		'',
		'',
		'',
		'# B',
		'- [ ] b1',
	].join('\n');
	const lines = content.split('\n');
	const bLine = lines.indexOf('# B');
	const result = reorderTopLevelSections(content, 0, bLine, 'after');
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		['# B', '- [ ] b1', '', '# A', '- [ ] a1', '', '- [ ] a2'].join('\n'),
	);
});

test('frontmatter + 引导区 prefix 原样保留，仅在缺分隔时补一个空行', () => {
	const content = [
		'---',
		'Status: 草稿',
		'---',
		'',
		'导语段落',
		'',
		'# A',
		'正文 A',
		'',
		'# B',
		'正文 B',
	].join('\n');
	const lines = content.split('\n');
	const aLine = lines.indexOf('# A');
	const bLine = lines.indexOf('# B');
	const result = reorderTopLevelSections(content, aLine, bLine, 'after');
	assert.ok(result);
	assert.equal(
		applyResult(content, result),
		[
			'---',
			'Status: 草稿',
			'---',
			'',
			'导语段落',
			'',
			'# B',
			'正文 B',
			'',
			'# A',
			'正文 A',
		].join('\n'),
	);
	// prefix 行（含 frontmatter 与导语）行号恒等
	for (let i = 0; i < aLine; i += 1) {
		assert.equal(result.mapLine(i), i);
	}
});

test('文件以换行结尾：EOF 空串形态保留', () => {
	const content = '# A\n\n# B\n';
	const result = reorderTopLevelSections(content, 0, 2, 'after');
	assert.ok(result);
	assert.equal(applyResult(content, result), '# B\n\n# A\n');
});

test('文件末尾多个空行：按原数量保留', () => {
	const content = '# A\n\n# B\n\n\n';
	const result = reorderTopLevelSections(content, 0, 2, 'after');
	assert.ok(result);
	assert.equal(applyResult(content, result), '# B\n\n# A\n\n\n');
});

test('mapLine：移动块内行随块迁移、静止块行号正确、被剥空行 → null', () => {
	const content = ['# A', 'a1', '', '# B', 'b1', '', '# C', 'c1'].join('\n');
	const lines = content.split('\n');
	const aLine = 0;
	const cLine = lines.indexOf('# C');
	// A 移到 C 后 → B, C, A
	const result = reorderTopLevelSections(content, aLine, cLine, 'after');
	assert.ok(result);
	const next = applyResult(content, result).split('\n');
	// 新序：# B(0) b1(1) ''(2) # C(3) c1(4) ''(5) # A(6) a1(7)
	assert.equal(next[result.mapLine(lines.indexOf('a1'))], 'a1');
	assert.equal(result.mapLine(lines.indexOf('# B')), 0);
	assert.equal(result.mapLine(lines.indexOf('b1')), 1);
	assert.equal(result.mapLine(lines.indexOf('# C')), 3);
	assert.equal(result.mapLine(lines.indexOf('c1')), 4);
	assert.equal(result.mapLine(lines.indexOf('# A')), 6);
	assert.equal(result.mapLine(lines.indexOf('a1')), 7);
	// A 与 B 之间原本的分隔空行（行 2）在新序中是 C/A 之间的新空行，旧行被回收 → null
	assert.equal(result.mapLine(2), null);
	// 映射后所有行内容自洽（除 null 外）
	for (const [oldLineText, newLine] of [
		['# B', 0],
		['b1', 1],
		['# C', 3],
		['c1', 4],
		['# A', 6],
		['a1', 7],
	]) {
		assert.equal(next[newLine], oldLineText);
	}
});

test('折叠 key 模拟重映射：level:startLine:title 迁移到新行且 parseSections 可对上', () => {
	const content = '# A\n\n# B\n\n# C';
	const lines = content.split('\n');
	const aLine = 0;
	const cLine = lines.indexOf('# C');
	const result = reorderTopLevelSections(content, aLine, cLine, 'after');
	assert.ok(result);
	const nextContent = applyResult(content, result);
	const nextSections = parseSections(nextContent);
	// 旧 key 中的 startLine 经 mapLine 后，应正好命中标题未变的同名块
	const newALine = result.mapLine(aLine);
	const moved = nextSections.find((s) => s.startLine === newALine);
	assert.ok(moved);
	assert.equal(moved.title, 'A');
	assert.equal(moved.level, 1);
});

test('nextLines/originalLines 与区间切片严格对齐（可直接喂 commitBlockRange）', () => {
	const content = ['导言', '# A', '', '# B'].join('\n');
	const lines = content.split('\n');
	const bLine = lines.indexOf('# B');
	const result = reorderTopLevelSections(content, bLine, 1, 'before');
	assert.ok(result);
	assert.equal(result.startLine, 1);
	assert.deepEqual(result.originalLines, ['# A', '', '# B']);
	// 导言紧贴标题（无空行）→ 补的分隔空行落在区间首位
	assert.deepEqual(result.nextLines, ['', '# B', '', '# A']);
	assert.equal(applyResult(content, result), '导言\n\n# B\n\n# A');
	assert.equal(result.endLine, lines.length - 1);
});
