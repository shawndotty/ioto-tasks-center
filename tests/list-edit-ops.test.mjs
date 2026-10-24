import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });

const { applyListEnter, indentListItemLines, dedentListItemLines } =
	await jiti.import('../src/tasks-center/list-edit-ops.ts');

const BATCH = '- ';
const ENTRY = '- [ ] ';

/* --------------------------- Enter：续行 --------------------------- */

test('Enter 批量列表行尾续行：缩进原样 + 同标记 + 光标在标记后', () => {
	const edit = applyListEnter('- a', 3, 3, BATCH);
	assert.deepEqual(edit, { text: '- a\n- ', start: 6, end: 6 });
});

test('Enter 条目列表行尾续行：产出未勾选标记', () => {
	const edit = applyListEnter('- [ ] a', 7, 7, ENTRY);
	assert.deepEqual(edit, { text: '- [ ] a\n- [ ] ', start: 14, end: 14 });
});

test('Enter 已勾选条目续行为未勾选', () => {
	const edit = applyListEnter('- [x] a', 7, 7, ENTRY);
	assert.deepEqual(edit, { text: '- [x] a\n- [ ] ', start: 14, end: 14 });
});

test('Enter 续行原样复制缩进（空格）', () => {
	const edit = applyListEnter('  - a', 5, 5, BATCH);
	assert.deepEqual(edit, { text: '  - a\n  - ', start: 10, end: 10 });
});

test('Enter 续行原样复制缩进（Tab）', () => {
	const edit = applyListEnter('\t- a', 4, 4, BATCH);
	assert.deepEqual(edit, { text: '\t- a\n\t- ', start: 8, end: 8 });
});

test('Enter 在中间行续行不影响后续行', () => {
	const edit = applyListEnter('- a\n- b', 3, 3, BATCH);
	assert.deepEqual(edit, {
		text: '- a\n- \n- b',
		start: 6,
		end: 6,
	});
});

test('Enter 保持 CRLF 行尾风格', () => {
	const edit = applyListEnter('- a\r\n- b', 3, 3, BATCH);
	assert.deepEqual(edit, {
		text: '- a\r\n- \r\n- b',
		start: 7,
		end: 7,
	});
});

/* ----------------------- Enter：不拦截的场景 ----------------------- */

test('Enter 光标在行中不拦截', () => {
	assert.equal(applyListEnter('- abc', 2, 2, BATCH), null);
});

test('Enter 有选区不拦截', () => {
	assert.equal(applyListEnter('- abc', 0, 3, BATCH), null);
});

test('Enter 非列表行不拦截', () => {
	assert.equal(applyListEnter('abc', 3, 3, BATCH), null);
	assert.equal(applyListEnter('', 0, 0, BATCH), null);
});

test('Enter 标记与模式不匹配时不拦截', () => {
	// 条目模式只认 checklist，`- ` 不算
	assert.equal(applyListEnter('- a', 3, 3, ENTRY), null);
	// 非 `- ` 开头
	assert.equal(applyListEnter('* a', 3, 3, BATCH), null);
});

/* ------------------------- Enter：空项退出 ------------------------- */

test('Enter 空项 2 空格缩进退一级', () => {
	const edit = applyListEnter('  - ', 4, 4, BATCH);
	assert.deepEqual(edit, { text: '- ', start: 2, end: 2 });
});

test('Enter 空项 Tab 缩进退一级', () => {
	const edit = applyListEnter('\t- ', 3, 3, BATCH);
	assert.deepEqual(edit, { text: '- ', start: 2, end: 2 });
});

test('Enter 空项 4 空格缩进退一级（只退 2 空格）', () => {
	const edit = applyListEnter('    - ', 6, 6, BATCH);
	assert.deepEqual(edit, { text: '  - ', start: 4, end: 4 });
});

test('Enter 空项 0 级删标记变空行', () => {
	const edit = applyListEnter('- ', 2, 2, BATCH);
	assert.deepEqual(edit, { text: '', start: 0, end: 0 });
});

test('Enter 空项条目 0 级删标记变空行', () => {
	const edit = applyListEnter('- [ ] ', 6, 6, ENTRY);
	assert.deepEqual(edit, { text: '', start: 0, end: 0 });
});

test('Enter 空项条目带缩进退一级', () => {
	const edit = applyListEnter('  - [ ] ', 8, 8, ENTRY);
	assert.deepEqual(edit, { text: '- [ ] ', start: 6, end: 6 });
});

test('Enter 正文为空白也识别为空项并清掉多余空格', () => {
	const edit = applyListEnter('-   ', 4, 4, BATCH);
	assert.deepEqual(edit, { text: '', start: 0, end: 0 });
	const indented = applyListEnter('  -   ', 6, 6, BATCH);
	assert.deepEqual(indented, { text: '- ', start: 2, end: 2 });
});

/* ----------------------------- Tab 缩进 ----------------------------- */

test('Tab 单行行首 +2 且光标 +2', () => {
	assert.deepEqual(indentListItemLines('- a', 0, 0), {
		text: '  - a',
		start: 2,
		end: 2,
	});
});

test('Tab 单行行中光标同步右移', () => {
	assert.deepEqual(indentListItemLines('- abc', 3, 3), {
		text: '  - abc',
		start: 5,
		end: 5,
	});
});

test('Tab 多行选区逐行缩进并保持覆盖同一批行', () => {
	assert.deepEqual(indentListItemLines('- a\n- b', 0, 7), {
		text: '  - a\n  - b',
		start: 0,
		end: 11,
	});
});

test('Tab 跳过空行', () => {
	assert.deepEqual(indentListItemLines('- a\n\n- b', 0, 8), {
		text: '  - a\n\n  - b',
		start: 0,
		end: 12,
	});
});

test('Tab 选区末端落在下一行行首时不缩进该行', () => {
	assert.deepEqual(indentListItemLines('- a\n- b\n- c', 0, 4), {
		text: '  - a\n- b\n- c',
		start: 0,
		end: 6,
	});
});

test('Tab 选区从行中开始时起点扩到行首', () => {
	assert.deepEqual(indentListItemLines('- abc\n- def', 3, 11), {
		text: '  - abc\n  - def',
		start: 0,
		end: 15,
	});
});

test('Tab 空白行上不产生只有空白的缩进行', () => {
	assert.deepEqual(indentListItemLines('   ', 0, 0), {
		text: '   ',
		start: 0,
		end: 0,
	});
});

/* --------------------------- Shift+Tab 反缩进 --------------------------- */

test('Shift+Tab 去 2 空格', () => {
	assert.deepEqual(dedentListItemLines('  - a', 5, 5), {
		text: '- a',
		start: 3,
		end: 3,
	});
});

test('Shift+Tab 去 1 个 Tab', () => {
	assert.deepEqual(dedentListItemLines('\t- a', 4, 4), {
		text: '- a',
		start: 3,
		end: 3,
	});
});

test('Shift+Tab 只剩 1 个空格时去 1 个', () => {
	assert.deepEqual(dedentListItemLines(' - a', 4, 4), {
		text: '- a',
		start: 3,
		end: 3,
	});
});

test('Shift+Tab 已 0 级不变但仍返回合法编辑', () => {
	assert.deepEqual(dedentListItemLines('- a', 3, 3), {
		text: '- a',
		start: 3,
		end: 3,
	});
});

test('Shift+Tab 多行选区逐行反缩进并收缩选区', () => {
	assert.deepEqual(dedentListItemLines('  - a\n  - b', 0, 11), {
		text: '- a\n- b',
		start: 0,
		end: 7,
	});
});

test('Shift+Tab 混合缩进按各行实际量收缩', () => {
	assert.deepEqual(dedentListItemLines('    - a\n\n\t- b', 0, 13), {
		text: '  - a\n\n- b',
		start: 0,
		end: 10,
	});
});

test('Shift+Tab 光标在行首时不越到上一行', () => {
	assert.deepEqual(dedentListItemLines('  - a', 0, 0), {
		text: '- a',
		start: 0,
		end: 0,
	});
});
