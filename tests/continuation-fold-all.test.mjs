import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 批量折叠续写区的键计算（[[Plan-20261024-060243]] S1/S6）。
// `collectContinuationFoldKeys` 必须与渲染层写进 `data-cont-key` 的键同源，
// 否则批量折叠会出现「集合改了但界面没反应」。纯函数，jiti 直导即可。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { collectContinuationFoldKeys, continuationFoldKey } = await jiti.import(
	'../src/views/ioto-task/continuation-fold.ts',
);

/** 手算一段续行的键：与渲染层 `renderSectionBody` 的算式一致（dedent 在哈希之前）。 */
const keyOf = (rawLines) => continuationFoldKey(rawLines.join('\n'));

test('无任务 / 无续写区 → 空数组', () => {
	assert.deepEqual(collectContinuationFoldKeys(''), []);
	assert.deepEqual(collectContinuationFoldKeys('只是正文\n\n# 标题\n\n没有任务'), []);
	assert.deepEqual(
		collectContinuationFoldKeys('- [ ] 没有续写的任务\n- [ ] 也没有'),
		[],
	);
});

test('一个 Section 内 3 张卡各带续行 → 3 个键', () => {
	const content = [
		'# 章节',
		'',
		'- [ ] 任务 A',
		'  续写 A',
		'',
		'- [ ] 任务 B',
		'  续写 B',
		'',
		'- [ ] 任务 C',
		'  续写 C',
	].join('\n');
	const keys = collectContinuationFoldKeys(content);
	assert.equal(keys.length, 3);
	assert.deepEqual(keys, [
		keyOf(['续写 A']),
		keyOf(['续写 B']),
		keyOf(['续写 C']),
	]);
});

test('引导区（`# 标题` 之前的卡）也计入', () => {
	// 覆盖 `level === 0` 的引导区分支：正文从 section.startLine 起，不跳标题行。
	const content = [
		'引导正文',
		'',
		'- [ ] 引导任务',
		'  引导续写',
		'',
		'# 章节',
		'',
		'- [ ] 章节任务',
		'  章节续写',
	].join('\n');
	const keys = collectContinuationFoldKeys(content);
	assert.equal(keys.length, 2);
	assert.deepEqual(keys, [keyOf(['引导续写']), keyOf(['章节续写'])]);
});

test('嵌套 `##` 标题下的卡也计入（root 块覆盖嵌套）', () => {
	const content = [
		'# 章节',
		'',
		'## 小节',
		'',
		'- [ ] 小节任务',
		'  小节续写',
	].join('\n');
	assert.deepEqual(collectContinuationFoldKeys(content), [
		keyOf(['小节续写']),
	]);
});

test('同源校验：多行缩进续写的键 == 手算 dedent 后的哈希', () => {
	const content = [
		'# 章节',
		'',
		'- [ ] 任务',
		'  第一行',
		'  第二行',
		'',
		'- [ ] 另一张',
		'    更深缩进的单行',
	].join('\n');
	const keys = collectContinuationFoldKeys(content);
	assert.deepEqual(keys, [
		keyOf(['第一行', '第二行']),
		keyOf(['更深缩进的单行']),
	]);
	// 键形状与单卡折叠共用同一哈希函数
	for (const key of keys) {
		assert.match(key, /^c[0-9a-f]{8}$/);
	}
});

test('CRLF 与 LF 同一笔记 → 同键数组', () => {
	const lf = ['# 章节', '', '- [ ] 任务', '  续写正文'].join('\n');
	const crlf = lf.replace(/\n/g, '\r\n');
	assert.deepEqual(
		collectContinuationFoldKeys(crlf),
		collectContinuationFoldKeys(lf),
	);
});

test('只有空白的续行块不产出键（与渲染层判定一致）', () => {
	// 渲染层对 `dedent 后长度 === 0` 的续写直接 `continue`（不给 DOM）；
	// 而纯空白行本身就不是续行（`isTaskContinuationLine` 判空即 false），
	// 两侧结论同为「这张卡没有续写区」。
	const content = ['# 章节', '', '- [ ] 任务', '   ', '\t', ''].join('\n');
	assert.deepEqual(collectContinuationFoldKeys(content), []);
});
