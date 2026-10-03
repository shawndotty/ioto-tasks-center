import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { commitTaskLineAction, commitTaskText } = await jiti.import(
	'../src/views/ioto-task/commit-task-line.ts',
);

function makeApp(initial) {
	let current = initial;
	return {
		get content() {
			return current;
		},
		vault: {
			process: async (_file, fn) => {
				const next = fn(current);
				current = next;
				return next;
			},
		},
	};
}

function makeFile(path = '3-任务/Demo/T.md') {
	return { path };
}

test('data-line 命中：只改目标行，其余字节不变', async () => {
	const app = makeApp(['# T', '- [ ] 一', '- [ ] 二', '- [ ] 三'].join('\n'));
	const outcome = await commitTaskLineAction(app, makeFile(), {
		line: 2,
		originalLine: '- [ ] 二',
		transform: (line) => line.replace('二', '二改'),
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(app.content, ['# T', '- [ ] 一', '- [ ] 二改', '- [ ] 三'].join('\n'));
});

test('data-line 漂移但原文唯一：仍能定位', async () => {
	const app = makeApp(
		['# T', '- [ ] 新增行', '- [ ] 一', '- [ ] 目标'].join('\n'),
	);
	const outcome = await commitTaskLineAction(app, makeFile(), {
		line: 2,
		originalLine: '- [ ] 目标',
		transform: (line) => line.replace('目标', '目标改'),
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(
		app.content,
		['# T', '- [ ] 新增行', '- [ ] 一', '- [ ] 目标改'].join('\n'),
	);
});

test('原行不存在：conflict 且内容零变化', async () => {
	const original = ['# T', '- [ ] 一'].join('\n');
	const app = makeApp(original);
	const outcome = await commitTaskLineAction(app, makeFile(), {
		line: 5,
		originalLine: '- [ ] 不存在的行',
		transform: (line) => line.replace('一', '二'),
	});

	assert.deepEqual(outcome, { status: 'conflict', line: 5 });
	assert.equal(app.content, original);
});

test('transform 返回 null：conflict 且不写盘', async () => {
	const original = ['# T', '- [ ] 一'].join('\n');
	const app = makeApp(original);
	const outcome = await commitTaskLineAction(app, makeFile(), {
		line: 1,
		originalLine: '- [ ] 一',
		transform: () => null,
	});

	assert.equal(outcome.status, 'conflict');
	assert.equal(app.content, original);
});

test('无改动：unchanged 且不写盘', async () => {
	const original = ['# T', '- [ ] 一'].join('\n');
	const app = makeApp(original);
	const outcome = await commitTaskLineAction(app, makeFile(), {
		line: 1,
		originalLine: '- [ ] 一',
		transform: (line) => line,
	});

	assert.deepEqual(outcome, { status: 'unchanged' });
	assert.equal(app.content, original);
});

test('CRLF 文件写回后仍是 CRLF', async () => {
	const original = ['# T', '- [ ] 一\r', '- [ ] 二\r'].join('\n');
	const app = makeApp(original);
	const outcome = await commitTaskLineAction(app, makeFile(), {
		line: 2,
		originalLine: '- [ ] 二\r',
		transform: (line) => line.replace('二', '二改'),
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(app.content, ['# T', '- [ ] 一\r', '- [ ] 二改\r'].join('\n'));
	assert.ok(app.content.includes('\r\n'));
});

test('返回 [] 删除该行；返回多行数组时插入', async () => {
	const app = makeApp(['- [ ] 一', '- [ ] 二', '- [ ] 三'].join('\n'));

	const deleted = await commitTaskLineAction(app, makeFile(), {
		line: 1,
		originalLine: '- [ ] 二',
		transform: () => [],
	});
	assert.equal(deleted.status, 'ok');
	assert.equal(app.content, ['- [ ] 一', '- [ ] 三'].join('\n'));

	const inserted = await commitTaskLineAction(app, makeFile(), {
		line: 1,
		originalLine: '- [ ] 三',
		transform: (line) => [line, '- [ ] 新'],
	});
	assert.equal(inserted.status, 'ok');
	assert.equal(
		app.content,
		['- [ ] 一', '- [ ] 三', '- [ ] 新'].join('\n'),
	);
});

test("返回 '' 视为删除该行", async () => {
	const app = makeApp(['# T', '- [ ] 一', '- [ ] 二'].join('\n'));
	const outcome = await commitTaskLineAction(app, makeFile(), {
		line: 2,
		originalLine: '- [ ] 二',
		transform: () => '',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(app.content, ['# T', '- [ ] 一'].join('\n'));
});

test('commitTaskText：保留勾选态与行尾标签，只换正文', async () => {
	const original = ['# 任务', '- [x] 旧文字 #ioto/turns/0'].join('\n');
	const app = makeApp(original);
	const outcome = await commitTaskText(app, makeFile(), {
		line: 1,
		originalLine: '- [x] 旧文字 #ioto/turns/0',
		nextBody: '新文字',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(app.content, ['# 任务', '- [x] 新文字 #ioto/turns/0'].join('\n'));
});

test('commitTaskText：多行正文被拒绝（conflict，不写盘）', async () => {
	const original = ['# 任务', '- [ ] 旧'].join('\n');
	const app = makeApp(original);
	const outcome = await commitTaskText(app, makeFile(), {
		line: 1,
		originalLine: '- [ ] 旧',
		nextBody: '第一行\n第二行',
	});

	assert.equal(outcome.status, 'conflict');
	assert.equal(app.content, original);
});
