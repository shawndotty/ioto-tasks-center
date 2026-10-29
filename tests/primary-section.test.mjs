import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 主任务区纯函数层（[[Plan-20261024-072014]] §3 S2/S4）。
// primary-section 经 frontmatter-properties 间接依赖 obsidian 运行时，按既有惯例 alias。
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});
const {
	quoteYamlString,
	unquoteYamlString,
	upsertQuotedScalarProperty,
	readQuotedScalarProperty,
	writeQuotedScalarProperty,
	removeScalarPropertyInFile,
} = await jiti.import('../src/tasks-center/frontmatter-properties.ts');
const {
	PRIMARY_SECTION_PROPERTY,
	readPrimarySectionTitle,
	resolvePrimarySection,
	computeSectionEndInsertion,
} = await jiti.import('../src/tasks-center/primary-section.ts');
const { findSectionAtLine, parseSections } = await jiti.import(
	'../src/tasks-center/note-sections.ts',
);

function withMark(title) {
	return `---\n${PRIMARY_SECTION_PROPERTY}: ${quoteYamlString(title)}\n---\n`;
}

/**
 * 只用于纯函数侧串两次「添加任务」：先替换定位行，再从插入块末尾按数吞空白。
 * 口径必须与 `commit-task-line.ts` 的 `dropFollowingLines` 分支逐字一致，
 * 否则测的不是真路径。
 */
function applyPlan(content, newLines) {
	const section = parseSections(content).find((s) => s.title === '任务');
	const plan = computeSectionEndInsertion(content, section, newLines);
	const lines = content.split('\n');
	lines.splice(plan.line, 1, ...plan.nextLines);
	const tail = plan.line + plan.nextLines.length;
	let remove = 0;
	while (remove < plan.dropFollowingLines && (lines[tail + remove] ?? '').trim() === '') {
		remove += 1;
	}
	lines.splice(tail, remove);
	return lines.join('\n');
}

test('引号 roundtrip：特殊字符写→读逐字相等', () => {
	const samples = [
		'任务',
		'A: B',
		'#标签',
		'[x]',
		'含"引号"',
		'反\\斜杠',
		'*星号*',
		'  两侧空白  ',
	];
	for (const sample of samples) {
		const content = upsertQuotedScalarProperty('# 任务\n', PRIMARY_SECTION_PROPERTY, sample);
		const read = readQuotedScalarProperty(content, PRIMARY_SECTION_PROPERTY);
		assert.equal(read, sample, `roundtrip: ${sample}`);
	}
});

test('引号：写出的属性行是合法双引号标量', () => {
	assert.equal(quoteYamlString('A: B'), '"A: B"');
	assert.equal(quoteYamlString('含"引号"'), '"含\\"引号\\""');
	assert.equal(quoteYamlString('反\\斜杠'), '"反\\\\斜杠"');
	assert.equal(unquoteYamlString('"含\\"引号\\""'), '含"引号"');
	assert.equal(unquoteYamlString("'it''s'"), "it's");
});

test('引号：裸值（手写无引号）也能读回', () => {
	assert.equal(
		readQuotedScalarProperty(`---\n${PRIMARY_SECTION_PROPERTY}: 任务\n---\n`, PRIMARY_SECTION_PROPERTY),
		'任务',
	);
});

test('三态解析：none / ok / missing / 空串', () => {
	const body = '# 任务\n\n- [ ] a\n\n# 其他\n\n- [ ] b\n';

	const none = resolvePrimarySection(body);
	assert.deepEqual(none, { status: 'none' });
	assert.equal(readPrimarySectionTitle(body), null);

	const ok = resolvePrimarySection(`${withMark('任务')}${body}`);
	assert.equal(ok.status, 'ok');
	assert.equal(ok.section.title, '任务');
	assert.equal(ok.section.startLine, 3); // 0-2 是 frontmatter，3 是 `# 任务`

	const missing = resolvePrimarySection(`${withMark('不存在')}${body}`);
	assert.deepEqual(missing, { status: 'missing', title: '不存在' });

	const empty = resolvePrimarySection(
		`---\n${PRIMARY_SECTION_PROPERTY}: ""\n---\n${body}`,
	);
	assert.deepEqual(empty, { status: 'none' });
});

test('落点①：空节 → 紧贴标题下一行，中间无空行', () => {
	const content = '# 任务\n\n# 其他\n\n- [ ] b\n';
	const section = parseSections(content).find((s) => s.title === '任务');
	const plan = computeSectionEndInsertion(content, section, ['- ']);
	assert.equal(plan.line, 0);
	assert.equal(plan.originalLine, '# 任务');
	assert.deepEqual(plan.nextLines, ['# 任务', '- ']);
	assert.equal(plan.nextEditLine, 1);
	assert.equal(plan.dropFollowingLines, 0);
});

test('落点②：末尾有正文 → 追加在最后一个非空行之后（紧贴，不留块间空行）', () => {
	const content = '# 任务\n\n- [ ] a\n- [ ] b\n\n# 其他\n';
	const section = parseSections(content).find((s) => s.title === '任务');
	const plan = computeSectionEndInsertion(content, section, ['- ']);
	assert.equal(plan.line, 3);
	assert.equal(plan.originalLine, '- [ ] b');
	// L 是列表行 → 不插空行；节尾那个 '' 是「下一个标题前的 1 个空行」，不是新插的
	assert.deepEqual(plan.nextLines, ['- [ ] b', '- ', '']);
	assert.equal(plan.nextEditLine, 4);
	assert.equal(plan.dropFollowingLines, 1); // 原有块间空行被收敛，由 commit 层吞掉
});

test('落点③：L === endLine 且下一行是标题 → 仍补一个块间空行', () => {
	const content = '# 任务\n\n- [ ] a\n# 其他\n';
	const section = parseSections(content).find((s) => s.title === '任务');
	assert.equal(section.endLine, 2);
	const plan = computeSectionEndInsertion(content, section, ['- ']);
	assert.deepEqual(plan.nextLines, ['- [ ] a', '- ', '']);
	assert.equal(plan.nextEditLine, 3);
	assert.equal(plan.dropFollowingLines, 0);
});

test('落点④：EOF 不补尾部空行', () => {
	const content = '# 任务\n\n- [ ] a';
	const section = parseSections(content).find((s) => s.title === '任务');
	const plan = computeSectionEndInsertion(content, section, ['- ']);
	assert.deepEqual(plan.nextLines, ['- [ ] a', '- ']);
	assert.equal(plan.nextEditLine, 3);
});

test('落点⑤：含 ## 子节的节 → 落在最后一个子节之后（整块末尾）', () => {
	const content = '# 任务\n\n- [ ] a\n\n## 子节\n\n- [ ] b\n\n# 其他\n';
	const section = parseSections(content).find((s) => s.title === '任务');
	const plan = computeSectionEndInsertion(content, section, ['- ']);
	assert.equal(plan.originalLine, '- [ ] b');
	assert.equal(plan.line, 6);
	assert.equal(plan.nextEditLine, 7);
});

test('落点⑥：L 是段落行 → 仍留 1 个空行（空列表项不能打断段落）', () => {
	const content = '# 任务\n\n说明段落。\n\n# 其他\n';
	const section = parseSections(content).find((s) => s.title === '任务');
	const plan = computeSectionEndInsertion(content, section, ['- ']);
	assert.deepEqual(plan.nextLines, ['说明段落。', '', '- ', '']);
	assert.equal(plan.nextEditLine, 4);
});

test('落点⑦：节尾空行池被收敛（drop = endLine - lastLine）', () => {
	const content = '# 任务\n\n- [ ] a\n\n\n\n# 其他\n';
	const plan = computeSectionEndInsertion(
		content,
		parseSections(content).find((s) => s.title === '任务'),
		['- '],
	);
	assert.deepEqual(plan.nextLines, ['- [ ] a', '- ', '']);
	assert.equal(plan.dropFollowingLines, 3);
});

test('落点⑧：连加两条，两条之间零空行（与未标记笔记同形）', () => {
	const once = applyPlan('# 任务\n\n- [ ] a\n\n# 其他\n', ['- ']);
	assert.deepEqual(once.split('\n'), ['# 任务', '', '- [ ] a', '- ', '', '# 其他', '']);
	const twice = applyPlan(once, ['- ']);
	assert.deepEqual(twice.split('\n'), [
		'# 任务',
		'',
		'- [ ] a',
		'- ',
		'- ',
		'',
		'# 其他',
		'',
	]);
});

test('落点⑨：`---` 分隔线不算列表行 → 仍插空行', () => {
	const content = '# 任务\n\n- [ ] a\n\n---\n\n# 其他\n';
	const plan = computeSectionEndInsertion(
		content,
		parseSections(content).find((s) => s.title === '任务'),
		['- '],
	);
	assert.deepEqual(plan.nextLines, ['---', '', '- ', '']);
	assert.equal(plan.nextEditLine, 6);
});

test('落点⑩：节到 EOF 且文件以换行收尾 → 不吞文末换行', () => {
	// 真实踩坑点：`endLine` 落在 split 后的文末 `''` 上，若把它算进空行池，
	// 写回后文件末尾就丢换行。
	const content = '# 任务\n\n- [ ] a\n';
	const plan = computeSectionEndInsertion(
		content,
		parseSections(content).find((s) => s.title === '任务'),
		['- '],
	);
	assert.deepEqual(plan.nextLines, ['- [ ] a', '- ']);
	assert.equal(plan.dropFollowingLines, 0);

	const once = applyPlan(content, ['- ']);
	assert.equal(once, '# 任务\n\n- [ ] a\n- \n'); // 文末换行原样保留
	// 再点一次仍然稳定（不累积、不蚕食文末换行）
	assert.equal(applyPlan(once, ['- ']), '# 任务\n\n- [ ] a\n- \n- \n');
});

test('行号反查：标题行 / 节内任务行命中，引导区与越界返回 null', () => {
	const content = '导语\n\n# 任务\n\n- [ ] a\n\n# 其他\n';
	const atHeading = findSectionAtLine(content, 2);
	assert.equal(atHeading.title, '任务');
	const atTask = findSectionAtLine(content, 4);
	assert.equal(atTask.title, '任务');
	assert.equal(findSectionAtLine(content, 0), null); // 引导区
	assert.equal(findSectionAtLine(content, -1), null);
	assert.equal(findSectionAtLine(content, 99), null);
});

test('副作用：写盘 / 删键返回写盘后的内容', async () => {
	const state = { content: '---\nProject: ["Demo"]\n---\n# 任务\n' };
	const app = {
		vault: {
			process: async (_file, transform) => {
				state.content = transform(state.content);
				return state.content;
			},
		},
	};
	const file = { path: '3-任务/项目A/任务.md' };

	const written = await writeQuotedScalarProperty(app, file, PRIMARY_SECTION_PROPERTY, 'A: B');
	assert.equal(readPrimarySectionTitle(written), 'A: B');
	assert.equal(written.split('\n').length, 6);

	const removed = await removeScalarPropertyInFile(app, file, PRIMARY_SECTION_PROPERTY);
	assert.equal(readPrimarySectionTitle(removed), null);
	assert.equal(state.content, removed);
	assert.equal(removed.split('\n').length, 5);
});
