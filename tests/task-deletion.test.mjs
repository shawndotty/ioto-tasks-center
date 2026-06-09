import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { trashTaskFile } = await jiti.import(
	'../src/tasks-center/task-deletion.ts',
);

test('trashTaskFile 会把任务文件移到回收站', async () => {
	const calls = [];
	const app = {
		vault: {
			trash: async (file, useSystemTrash) => {
				calls.push([file, useSystemTrash]);
			},
		},
	};
	const file = { path: '3-任务/项目A/任务.md' };

	await trashTaskFile(app, file);

	assert.deepEqual(calls, [[file, true]]);
});

test('trashTaskFile 会透传回收站删除异常', async () => {
	const expectedError = new Error('trash failed');
	const app = {
		vault: {
			trash: async () => {
				throw expectedError;
			},
		},
	};

	await assert.rejects(
		() => trashTaskFile(app, { path: '3-任务/项目A/任务.md' }),
		expectedError,
	);
});
