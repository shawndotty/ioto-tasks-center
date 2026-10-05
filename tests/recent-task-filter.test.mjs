import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 「显示最近任务」的渲染期过滤纯逻辑（[[Plan-20261005-101007]] §2.2）。
// 零 obsidian 依赖，可 jiti 直接导入单测。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { pickRecentTopLevelLines } = await jiti.import(
	'../src/views/ioto-task/recent-task-filter.ts',
);

/** 便捷构造：`[line, indentLevel]` 数组 → 入参对象数组。 */
function items(pairs) {
	return pairs.map(([line, indentLevel]) => ({ line, indentLevel }));
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
