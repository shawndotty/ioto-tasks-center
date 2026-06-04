import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import moment from 'moment';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const {
	DEFAULT_DATE_TASK_DATE_FORMAT,
	formatDateByPattern,
	normalizeDateTaskDateFormat,
} = await jiti.import('../src/tasks-center/date-task-format.ts');

const FIXED_LOCAL_DATE = new Date(2026, 4, 30, 12, 0, 0);

test('空白日期格式会回退到默认值', () => {
	assert.equal(
		normalizeDateTaskDateFormat('   '),
		DEFAULT_DATE_TASK_DATE_FORMAT,
	);
});

test('非空日期格式会按原样保留', () => {
	assert.equal(
		normalizeDateTaskDateFormat('[截止] YYYY-MM-DD HH:mm'),
		'[截止] YYYY-MM-DD HH:mm',
	);
});

test('支持 [] 语法与中文字符混排', () => {
	moment.locale('zh-cn');

	assert.equal(
		formatDateByPattern(FIXED_LOCAL_DATE, 'YYYY[年]M[月]D[日]'),
		'2026年5月30日',
	);
	assert.equal(
		formatDateByPattern(FIXED_LOCAL_DATE, '[截止] YYYY-MM-DD'),
		'截止 2026-05-30',
	);
});

test('本地化 token 会跟随当前语言', () => {
	moment.locale('en');
	assert.equal(
		formatDateByPattern(FIXED_LOCAL_DATE, 'MMMM dddd'),
		'May Saturday',
	);

	moment.locale('zh-cn');
	assert.equal(
		formatDateByPattern(FIXED_LOCAL_DATE, 'MMMM dddd'),
		'五月 星期六',
	);
});
