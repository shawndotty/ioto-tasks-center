import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { getTaskFileStatusFromContent } = await jiti.import(
	'../src/tasks-center/data.ts',
);

test('正常含未完成任务的列表会判定为待开始', () => {
	const status = getTaskFileStatusFromContent(`
- [ ] 第一项
- [ ] 第二项
`);

	assert.equal(status.key, 'todo');
	assert.equal(status.totalTaskCount, 2);
	assert.equal(status.completedTaskCount, 0);
});

test('正常含全部已完成任务的列表会判定为已完成', () => {
	const status = getTaskFileStatusFromContent(`
- [x] 第一项
- [X] 第二项
`);

	assert.equal(status.key, 'completed');
	assert.equal(status.totalTaskCount, 2);
	assert.equal(status.completedTaskCount, 2);
});

test('空内容任务项会被忽略，不计入未完成统计', () => {
	const status = getTaskFileStatusFromContent(`
- [ ]    
- [ ] 有效任务
`);

	assert.equal(status.key, 'todo');
	assert.equal(status.totalTaskCount, 1);
	assert.equal(status.completedTaskCount, 0);
});

test('空内容的已完成任务项也会被忽略', () => {
	const status = getTaskFileStatusFromContent(`
- [x]    
- [x] 已完成任务
`);

	assert.equal(status.key, 'completed');
	assert.equal(status.totalTaskCount, 1);
	assert.equal(status.completedTaskCount, 1);
});

test('纯空白内容会判定为无任务项', () => {
	const status = getTaskFileStatusFromContent(`


   
`);

	assert.equal(status.key, 'empty');
	assert.equal(status.totalTaskCount, 0);
	assert.equal(status.completedTaskCount, 0);
});

test('仅含注释的空列表会判定为无任务项', () => {
	const status = getTaskFileStatusFromContent(`
%% 
- [ ] 这条任务在注释里
%%

<!--
- [x] 这条也在注释里
-->
`);

	assert.equal(status.key, 'empty');
	assert.equal(status.totalTaskCount, 0);
	assert.equal(status.completedTaskCount, 0);
});
