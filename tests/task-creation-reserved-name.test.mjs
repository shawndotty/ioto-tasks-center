import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import moment from 'moment';

moment.locale('zh-cn');
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { buildTaskFileName } = await jiti.import(
	'../src/tasks-center/task-creation.ts',
);

test('普通任务不允许使用 _project 作为文件名', () => {
	assert.throws(
		() =>
			buildTaskFileName(
				'项目A',
				'normal',
				new Date(2026, 0, 1),
				'YYYY-MM-DD',
				'_project',
			),
		{
			message:
				'该名称为项目元数据文件保留（_project.md），请换一个任务名称。',
		},
	);
});
