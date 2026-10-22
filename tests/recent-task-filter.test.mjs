import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 「显示最近任务」的渲染期过滤纯逻辑（[[Plan-20261005-101007]] §2.2）。
// 零 obsidian 依赖，可 jiti 直接导入单测。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { pickRecentTopLevelLines } = await jiti.import(
	'../src/views/ioto-task/recent-task-filter.ts',
);

/** 便捷构造：`[line, indentLevel, pinned?]` 数组 → 入参对象数组。 */
function items(pairs) {
	return pairs.map(([line, indentLevel, pinned]) => ({
		line,
		indentLevel,
		...(pinned === true ? { pinned: true } : {}),
	}));
}

function sorted(set) {
	return [...set].sort((a, b) => a - b);
}

test('末尾 N 组：取最后 2 组，含子任务全部行', () => {
	// 组 A：line 0（顶级）+ line 1（子）
	// 组 B：line 2（顶级）+ line 3（子）
	// 组 C：line 4（顶级）→ N=2 保留 B、C
	const lines = items([
		[0, 0],
		[1, 1],
		[2, 0],
		[3, 1],
		[4, 0],
	]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 2)), [2, 3, 4]);
});

test('组数 ≤ N：返回全集，等价不裁剪', () => {
	const lines = items([
		[0, 0],
		[1, 1],
		[2, 0],
	]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 5)), [0, 1, 2]);
});

test('只数顶级任务：子任务不计入 N', () => {
	// 只有 1 个顶级组（line 0 及其子任务 1、2）→ N=1 即全保留
	const lines = items([
		[0, 0],
		[1, 1],
		[2, 2],
	]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 1)), [0, 1, 2]);
});

test('前导孤儿缩进项：自成一组并参与末尾切片', () => {
	// line 0 缩进 1（无主）→ 兜底组；line 1 顶级组。N=1 只留最后组。
	const lines = items([
		[0, 1],
		[1, 0],
	]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 1)), [1]);
});

test('子任务连续归属：0→1→2→0 的分组边界正确', () => {
	// 组 A：line 0,1,2；组 B：line 3 → N=1 只留 B
	const lines = items([
		[0, 0],
		[1, 1],
		[2, 2],
		[3, 0],
	]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 1)), [3]);
});

test('count 兜底：0 / 负数 / 非有限数都保留最后一组', () => {
	const lines = items([
		[0, 0],
		[1, 0],
	]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 0)), [1]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, -3)), [1]);
	assert.deepEqual(
		sorted(pickRecentTopLevelLines(lines, Number.NaN)),
		[1],
	);
});

test('空序列：返回空集合', () => {
	assert.equal(pickRecentTopLevelLines([], 3).size, 0);
});

/* ------------------------------------------------------------------ *
 * pin 并集（[[Plan-20261022-200135]] §4.1-1 / §3 S2）
 * ------------------------------------------------------------------ */

test('pin：最近 N 之外的旧组整组保留（并集，不替换）', () => {
	// 组 A: 0,1 / 组 B: 2 / 组 C: 3 → N=2 原本留 B、C；A 的 line 0 pin → A 整组并入
	const lines = items([
		[0, 0, true],
		[1, 1],
		[2, 0],
		[3, 0],
	]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 2)), [0, 1, 2, 3]);
});

test('pin：同组多行 pin 只算一组（不重复计数）', () => {
	// 组 A 的父 + 全部子都 pin，仍只占「一组」的并集
	const lines = items([
		[0, 0, true],
		[1, 1, true],
		[2, 2, true],
		[3, 0],
	]);
	// N=1 原本只留 组 B(3)；A 整组并入 → 4 行
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 1)), [0, 1, 2, 3]);
});

test('pin：已在 N 内的组打 pin，结果与不打 pin 全等', () => {
	const plain = items([
		[0, 0],
		[1, 1],
		[2, 0],
	]);
	// 只 pin 落在末尾 N=1 之内那一组（line 2），最近集不应扩大
	const pinned = items([
		[0, 0],
		[1, 1],
		[2, 0, true],
	]);
	assert.deepEqual(
		sorted(pickRecentTopLevelLines(pinned, 1)),
		sorted(pickRecentTopLevelLines(plain, 1)),
	);
});

test('pin：子任务被 pin 时父组整组保留（父卡 + 全部兄弟）', () => {
	// 组 A: 0(父),1(子 pin),2(子) / 组 B: 3 → N=1 只留 B，但 A 因 1 pin 整组保留
	const lines = items([
		[0, 0],
		[1, 1, true],
		[2, 1],
		[3, 0],
	]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 1)), [0, 1, 2, 3]);
});

test('pin：全程无 pin 与旧实现（末尾 N 组）deepEqual', () => {
	const lines = items([
		[0, 0],
		[1, 1],
		[2, 0],
		[3, 0],
		[4, 1],
		[5, 0],
	]);
	// 旧口径：末尾 2 组（3-5）
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 2)), [3, 4, 5]);
});

test('pin：count ≥ 组数时打不打 pin 都是全集', () => {
	const plain = items([
		[0, 0],
		[1, 0],
	]);
	const pinned = items([
		[0, 0, true],
		[1, 0],
	]);
	assert.deepEqual(
		sorted(pickRecentTopLevelLines(pinned, 5)),
		sorted(pickRecentTopLevelLines(plain, 5)),
	);
	assert.deepEqual(sorted(pickRecentTopLevelLines(pinned, 5)), [0, 1]);
});

test('pin：前导孤儿缩进项自成一组，被 pin 时参与并集', () => {
	// line 0 缩进 1 无主（孤儿组，pin）→ 与末尾 N=1 的组 B(1) 并集
	const lines = items([
		[0, 1, true],
		[1, 0],
	]);
	assert.deepEqual(sorted(pickRecentTopLevelLines(lines, 1)), [0, 1]);
});
