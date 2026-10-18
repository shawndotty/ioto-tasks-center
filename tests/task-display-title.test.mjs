import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { getTaskProjectNameFromPath, stripProjectNamePrefix } =
	await jiti.import('../src/tasks-center/task-display-title.ts');

test('剥离日期 / 计划 / 主题三类任务的项目名前缀', () => {
	assert.equal(
		stripProjectNamePrefix(
			'IOTO Task Center-2026-10-18',
			'IOTO Task Center',
		),
		'2026-10-18',
	);
	assert.equal(
		stripProjectNamePrefix(
			'IOTO Task Center-计划-V268',
			'IOTO Task Center',
		),
		'计划-V268',
	);
	assert.equal(
		stripProjectNamePrefix(
			'IOTO Task Center-主题-任务视图改造',
			'IOTO Task Center',
		),
		'主题-任务视图改造',
	);
});

test('无前缀、标题等于项目名、仅剩前缀、空项目名都原样返回', () => {
	assert.equal(stripProjectNamePrefix('UI细节优化', 'IOTO Task Center'), 'UI细节优化');
	assert.equal(stripProjectNamePrefix('IOTO Task Center', 'IOTO Task Center'), 'IOTO Task Center');
	assert.equal(stripProjectNamePrefix('IOTO Task Center-', 'IOTO Task Center'), 'IOTO Task Center-');
	assert.equal(stripProjectNamePrefix('IOTO Task Center-', '   '), 'IOTO Task Center-');
});

test('项目名含正则元字符也不会误伤或误剥', () => {
	assert.equal(stripProjectNamePrefix('A.B(C)-日期', 'A.B(C)'), '日期');
	assert.equal(stripProjectNamePrefix('AXBXCX-日期', 'A.B(C)'), 'AXBXCX-日期');
});

test('大小写不一致不剥离', () => {
	assert.equal(
		stripProjectNamePrefix('ioto task center-2026-10-18', 'IOTO Task Center'),
		'ioto task center-2026-10-18',
	);
});

test('项目名自身含连字符时整体匹配', () => {
	assert.equal(stripProjectNamePrefix('IOTO-Plugins-计划-V268', 'IOTO-Plugins'), '计划-V268');
});

test('getTaskProjectNameFromPath 取父文件夹名', () => {
	assert.equal(
		getTaskProjectNameFromPath('3-任务/IOTO Task Center/UI细节优化.md'),
		'IOTO Task Center',
	);
	assert.equal(getTaskProjectNameFromPath('根目录任务.md'), '');
	assert.equal(getTaskProjectNameFromPath(''), '');
});
