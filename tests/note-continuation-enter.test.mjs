import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { isTaskContinuationLine, shouldDelegateContinuationEnter } =
	await jiti.import('../src/tasks-center/note-structure.ts');

/* ------------------------------------------------------------------ *
 * 续写区 Enter 的「放行闸门」
 *
 * 口径：只有普通列表行交核心（原生补 marker / 自增序号 / 空项退出 / 按缩进续写）；
 * 其余行维持插件自己的裸换行，语义不变。
 * ------------------------------------------------------------------ */

test('放行：无序列表（含空项与嵌套）', () => {
	for (const line of ['- 甲', '* 甲', '+ 甲', '-', '-   ']) {
		assert.equal(shouldDelegateContinuationEnter(line), true, line);
	}
	assert.equal(shouldDelegateContinuationEnter('  - 甲'), true);
	assert.equal(shouldDelegateContinuationEnter('\t- 甲'), true);
});

test('放行：有序列表（含空项与多位数）', () => {
	for (const line of ['1. 甲', '1) 甲', '10. 甲', '1.', '  *']) {
		assert.equal(shouldDelegateContinuationEnter(line), true, line);
	}
});

test('不放行：任务行（提交后会变成嵌套任务卡）', () => {
	for (const line of [
		'- [ ] 甲',
		'- [x] 甲',
		'  - [ ] 甲',
		'- [ ]甲',
		'1. [ ] 甲',
	]) {
		assert.equal(shouldDelegateContinuationEnter(line), false, line);
	}
});

test('不放行：普通正文与空行', () => {
	assert.equal(shouldDelegateContinuationEnter('普通文本'), false);
	assert.equal(shouldDelegateContinuationEnter('  缩进的正文'), false);
	assert.equal(shouldDelegateContinuationEnter(''), false);
	assert.equal(shouldDelegateContinuationEnter('   '), false);
});

test('不放行：引用 / 标题 / 围栏 / 分隔线', () => {
	for (const line of ['> 甲', '> - 甲', '# 标题', '~~~', '```js']) {
		assert.equal(shouldDelegateContinuationEnter(line), false, line);
	}
	// 分隔线会被列表正则误命中，闸门里必须显式排除
	for (const line of ['---', '* * *', '- - -', '___']) {
		assert.equal(shouldDelegateContinuationEnter(line), false, line);
	}
});

test('不放行：标记后无空白（不是合法列表项）', () => {
	assert.equal(shouldDelegateContinuationEnter('1.甲'), false);
	assert.equal(shouldDelegateContinuationEnter('-甲'), false);
});

test('口径说明：放行不改「列表归属哪张卡」', () => {
	// 与父同级 = 章节级列表，不算续行；续写区看到的是 dedent 后的相对文本，
	// 提交时按原公共前缀补回，相对缩进保留。
	assert.equal(isTaskContinuationLine('- 甲', 0), false);
	assert.equal(isTaskContinuationLine('  - 甲', 0), true);
});
