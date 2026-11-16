import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 四象限时间区间纯模型单测（[[Plan-20261116-083330]] §6.1）。
const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	decodeQuadrantTimeFilter,
	encodeQuadrantTimeFilter,
	isTaskInTimeBounds,
	QUADRANT_TIME_PRESET_KEYS,
	resolveTaskTimeBounds,
	shortDate,
	toLocalDateString,
	validateCustomRange,
} = await jiti.import('../src/tasks-center/task-time-range.ts');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 10, 11, 15, 0, 0).getTime(); // 2026-11-11（周三）15:00 本地

function entry({ ctime = 0, mtime = 0 } = {}) {
	return { ctime, mtime };
}

test('预设：固定窗口按 now - N 天，本自然周取周一 00:00，本自然月取 1 日', () => {
	const expectations = {
		'created-week': NOW - 7 * DAY_MS,
		'created-two-weeks': NOW - 14 * DAY_MS,
		'created-month': NOW - 30 * DAY_MS,
		'created-calendar-week': new Date(2026, 10, 9).getTime(),
		'created-calendar-month': new Date(2026, 10, 1).getTime(),
		'updated-week': NOW - 7 * DAY_MS,
		'updated-two-weeks': NOW - 14 * DAY_MS,
		'updated-month': NOW - 30 * DAY_MS,
		'updated-calendar-week': new Date(2026, 10, 9).getTime(),
		'updated-calendar-month': new Date(2026, 10, 1).getTime(),
	};

	for (const preset of QUADRANT_TIME_PRESET_KEYS) {
		const bounds = resolveTaskTimeBounds(
			{ kind: 'preset', value: preset },
			NOW,
		);
		assert.equal(bounds.startMs, expectations[preset], preset);
		assert.equal(bounds.endMs, undefined, preset);
		assert.equal(
			bounds.field,
			preset.startsWith('created') ? 'created' : 'updated',
			preset,
		);
	}
});

test('关闭：none 返回 null；区间判定不做任何裁剪', () => {
	assert.equal(resolveTaskTimeBounds({ kind: 'none' }, NOW), null);
});

test('字段：created 比 ctime，updated 比 mtime，同一任务结果可不同', () => {
	const task = entry({
		ctime: new Date(2026, 9, 20).getTime(),
		mtime: new Date(2026, 10, 10).getTime(),
	});
	const created = resolveTaskTimeBounds(
		{ kind: 'custom', field: 'created', start: '2026-10-01' },
		NOW,
	);
	const updated = resolveTaskTimeBounds(
		{ kind: 'custom', field: 'updated', start: '2026-10-01' },
		NOW,
	);
	assert.equal(isTaskInTimeBounds(task, created), true);
	assert.equal(isTaskInTimeBounds(task, updated), true);

	const recent = resolveTaskTimeBounds(
		{ kind: 'custom', field: 'updated', start: '2026-11-05' },
		NOW,
	);
	assert.equal(isTaskInTimeBounds(task, recent), true);
	assert.equal(
		isTaskInTimeBounds(
			task,
			resolveTaskTimeBounds(
				{ kind: 'custom', field: 'created', start: '2026-11-05' },
				NOW,
			),
		),
		false,
	);
});

test('自定义区间：双端含，结束日 23:59:59.999 命中，次日 00:00 不命中', () => {
	const bounds = resolveTaskTimeBounds(
		{ kind: 'custom', field: 'updated', start: '2026-10-01', end: '2026-10-31' },
		NOW,
	);
	assert.equal(bounds.startMs, new Date(2026, 9, 1).getTime());
	assert.equal(bounds.endMs, new Date(2026, 10, 1).getTime() - 1);

	assert.equal(
		isTaskInTimeBounds(entry({ mtime: new Date(2026, 9, 1).getTime() }), bounds),
		true,
	);
	assert.equal(
		isTaskInTimeBounds(entry({ mtime: bounds.endMs }), bounds),
		true,
	);
	assert.equal(
		isTaskInTimeBounds(entry({ mtime: bounds.endMs + 1 }), bounds),
		false,
	);
	assert.equal(
		isTaskInTimeBounds(entry({ mtime: new Date(2026, 8, 30, 23, 59).getTime() }), bounds),
		false,
	);
});

test('自定义区间：单端开放', () => {
	const onlyStart = resolveTaskTimeBounds(
		{ kind: 'custom', field: 'created', start: '2026-10-01' },
		NOW,
	);
	assert.equal(onlyStart.endMs, undefined);
	assert.equal(
		isTaskInTimeBounds(entry({ ctime: new Date(2027, 0, 1).getTime() }), onlyStart),
		true,
	);

	const onlyEnd = resolveTaskTimeBounds(
		{ kind: 'custom', field: 'created', end: '2026-10-31' },
		NOW,
	);
	assert.equal(onlyEnd.startMs, undefined);
	assert.equal(
		isTaskInTimeBounds(entry({ ctime: new Date(2020, 0, 1).getTime() }), onlyEnd),
		true,
	);
	assert.equal(
		isTaskInTimeBounds(entry({ ctime: new Date(2026, 10, 1).getTime() }), onlyEnd),
		false,
	);
});

test('自定义区间：双端为空 / 开始晚于结束 / 非法日期 → null', () => {
	assert.equal(
		resolveTaskTimeBounds({ kind: 'custom', field: 'created' }, NOW),
		null,
	);
	assert.equal(
		resolveTaskTimeBounds(
			{ kind: 'custom', field: 'created', start: '', end: '' },
			NOW,
		),
		null,
	);
	assert.equal(
		resolveTaskTimeBounds(
			{ kind: 'custom', field: 'created', start: '2026-10-31', end: '2026-10-01' },
			NOW,
		),
		null,
	);
	assert.equal(
		resolveTaskTimeBounds(
			{ kind: 'custom', field: 'created', start: '2026-02-30' },
			NOW,
		),
		null,
	);
});

test('validateCustomRange：empty / invalid-date / invalid-order / ok', () => {
	assert.equal(validateCustomRange('', ''), 'empty');
	assert.equal(validateCustomRange('  ', '  '), 'empty');
	assert.equal(validateCustomRange('2026-02-30', ''), 'invalid-date');
	assert.equal(validateCustomRange('', 'abc'), 'invalid-date');
	assert.equal(validateCustomRange('2026-10-31', '2026-10-01'), 'invalid-order');
	assert.equal(validateCustomRange('2026-10-01', '2026-10-01'), 'ok');
	assert.equal(validateCustomRange('2026-10-01', ''), 'ok');
	assert.equal(validateCustomRange('', '2026-10-01'), 'ok');
});

test('编码往返：none / 每个预设 / 全区间 / 单端区间', () => {
	const cases = [
		{ kind: 'none' },
		...QUADRANT_TIME_PRESET_KEYS.map((value) => ({
			kind: 'preset',
			value,
		})),
		{
			kind: 'custom',
			field: 'created',
			start: '2026-10-01',
			end: '2026-10-31',
		},
		{ kind: 'custom', field: 'updated', start: '2026-10-01', end: '' },
		{ kind: 'custom', field: 'updated', start: '', end: '2026-10-31' },
	];

	for (const filter of cases) {
		assert.deepEqual(
			decodeQuadrantTimeFilter(encodeQuadrantTimeFilter(filter)),
			filter,
		);
	}
});

test('解码：脏数据一律回落 none', () => {
	for (const value of [
		undefined,
		null,
		42,
		{},
		'',
		'preset:',
		'preset:nope',
		'custom:created',
		'custom:weird:2026-10-01:2026-10-02',
		'custom:created:2026-02-30:',
		'custom:created:2026-10-31:2026-10-01',
		'custom:created::',
	]) {
		assert.deepEqual(decodeQuadrantTimeFilter(value), { kind: 'none' });
	}
});

test('toLocalDateString / shortDate：补零、同年省略年份、跨年保留年份', () => {
	assert.equal(toLocalDateString(new Date(2026, 0, 5, 23, 59, 59, 999).getTime()), '2026-01-05');
	assert.equal(shortDate('2026-10-01', NOW), '10-01');
	assert.equal(shortDate('2025-12-31', NOW), '2025-12-31');
	assert.equal(shortDate('bad', NOW), 'bad');
});

test('DST 安全：结束边界由次日 00:00 - 1ms 构造，日期与时分秒都不漂移', () => {
	const bounds = resolveTaskTimeBounds(
		{ kind: 'custom', field: 'updated', start: '2026-10-25', end: '2026-10-31' },
		NOW,
	);
	const end = new Date(bounds.endMs);
	assert.equal(toLocalDateString(bounds.endMs), '2026-10-31');
	assert.equal(end.getHours(), 23);
	assert.equal(end.getMinutes(), 59);
	assert.equal(end.getSeconds(), 59);
	assert.equal(end.getMilliseconds(), 999);
});
