import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 任务类型推断单测（[[Plan-20261117-085118]] §6.1）。
// 纯模块零 obsidian 运行时依赖，照 `quadrant-model.test.mjs` 的 jiti 直载范式。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	QUADRANT_TASK_TYPES,
	DATE_PATTERNS,
	inferTaskType,
	isQuadrantTaskType,
} = await jiti.import('../src/tasks-center/task-type-infer.ts');

test('QUADRANT_TASK_TYPES：顺序固定为 normal/date/topic/plan', () => {
	assert.deepEqual(QUADRANT_TASK_TYPES, ['normal', 'date', 'topic', 'plan']);
});

test('计划任务：中文 / 繁中 / 英文标记', () => {
	assert.equal(inferTaskType('IOTO Dashboard-计划-V284', 'IOTO Dashboard'), 'plan');
	assert.equal(inferTaskType('P-計畫-X', 'P'), 'plan');
	assert.equal(inferTaskType('P-Plan-X', 'P'), 'plan');
});

test('主题任务：三语言标记', () => {
	assert.equal(inferTaskType('P-主题-Dev', 'P'), 'topic');
	assert.equal(inferTaskType('P-主題-Dev', 'P'), 'topic');
	assert.equal(inferTaskType('P-Subject-Dev', 'P'), 'topic');
});

test('日期任务：YYYY-MM-DD 与遗留 YYYY-MM-W 周格式', () => {
	assert.equal(inferTaskType('P-2026-06-24', 'P'), 'date');
	assert.equal(inferTaskType('P-2026-47-W', 'P'), 'date');
	assert.equal(
		inferTaskType('IOTO Task Center-2026-47-W', 'IOTO Task Center'),
		'date',
	);
});

test('日期任务：YYYY-Www 与中文日期', () => {
	assert.equal(inferTaskType('P-2026-W47', 'P'), 'date');
	assert.equal(inferTaskType('P-2026-11-17-W47', 'P'), 'date');
	assert.equal(inferTaskType('P-2026年6月24日', 'P'), 'date');
});

test('数字后缀不是日期：整段锚定', () => {
	assert.equal(inferTaskType('制作思维导图-0628', 'P'), 'normal');
	assert.equal(inferTaskType('P-2026-06-24-补记', 'P'), 'normal');
});

test('普通任务：无项目前缀', () => {
	assert.equal(inferTaskType('加入测试框架', 'IOTO Dashboard'), 'normal');
	assert.equal(inferTaskType('P-随意命名', 'P'), 'normal');
});

test('名称恰为项目前缀：rest 为空 → normal', () => {
	assert.equal(inferTaskType('P-', 'P'), 'normal');
});

test('项目名为空：不剥离前缀，日期整段仍命中', () => {
	assert.equal(inferTaskType('2026-06-24', ''), 'date');
	assert.equal(inferTaskType('2026-06-24', '   '), 'date');
});

test('plan / topic 优先于 date', () => {
	assert.equal(inferTaskType('P-计划-2026-06-24', 'P'), 'plan');
	assert.equal(inferTaskType('P-主题-2026-06-24', 'P'), 'topic');
});

test('只认首段：标记必须在项目前缀之后的第一段', () => {
	assert.equal(inferTaskType('P-前置-计划-X', 'P'), 'normal');
});

test('isQuadrantTaskType：白名单守卫', () => {
	assert.equal(isQuadrantTaskType('plan'), true);
	assert.equal(isQuadrantTaskType('normal'), true);
	assert.equal(isQuadrantTaskType('PLAN'), false);
	assert.equal(isQuadrantTaskType(''), false);
	assert.equal(isQuadrantTaskType(1), false);
	assert.equal(isQuadrantTaskType(null), false);
	assert.equal(isQuadrantTaskType(undefined), false);
	assert.equal(isQuadrantTaskType({}), false);
});

test('DATE_PATTERNS：全部整段锚定，不做子串匹配', () => {
	assert.ok(DATE_PATTERNS.length > 0);
	for (const pattern of DATE_PATTERNS) {
		assert.ok(pattern.source.startsWith('^'), `${pattern.source} 未锚定开头`);
		assert.ok(pattern.source.endsWith('$'), `${pattern.source} 未锚定结尾`);
	}
	assert.equal(DATE_PATTERNS.some((re) => re.test('x-2026-06-24')), false);
	assert.equal(DATE_PATTERNS.some((re) => re.test('2026-06-24-补记')), false);
});
