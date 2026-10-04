import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { commitTaskContinuation } = await jiti.import(
	'../src/views/ioto-task/commit-task-line.ts',
);

function makeApp(initial) {
	let current = initial;
	return {
		writes: 0,
		get content() {
			return current;
		},
		vault: {
			process: async (_file, fn) => {
				const next = fn(current);
				if (next !== current) {
					current = next;
					// 计数真实写盘（内容变化才算一次「写」）
				}
				return next;
			},
		},
	};
}

function makeFile(path = '3-任务/Demo/T.md') {
	return { path };
}

test('多行 nextText：整段替换，按原公共前缀重新缩进', async () => {
	const app = makeApp(
		[
			'- [ ] 甲',
			'      续行一',
			'      续行二',
			'- [ ] 乙',
		].join('\n'),
	);
	const outcome = await commitTaskContinuation(app, makeFile(), {
		startLine: 1,
		endLine: 2,
		originalLines: ['      续行一', '      续行二'],
		nextText: '改一\n改二\n改三',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(
		app.content,
		[
			'- [ ] 甲',
			'      改一',
			'      改二',
			'      改三',
			'- [ ] 乙',
		].join('\n'),
	);
});

test("nextText === ''：整段删除，下一张卡保留", async () => {
	const app = makeApp(
		['- [ ] 甲', '      续行一', '      续行二', '- [ ] 乙'].join('\n'),
	);
	const outcome = await commitTaskContinuation(app, makeFile(), {
		startLine: 1,
		endLine: 2,
		originalLines: ['      续行一', '      续行二'],
		nextText: '',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(app.content, ['- [ ] 甲', '- [ ] 乙'].join('\n'));
});

test('未改动：unchanged，内容零变化', async () => {
	const original = ['- [ ] 甲', '      续行一', '      续行二'].join('\n');
	const app = makeApp(original);
	const outcome = await commitTaskContinuation(app, makeFile(), {
		startLine: 1,
		endLine: 2,
		originalLines: ['      续行一', '      续行二'],
		nextText: '续行一\n续行二',
	});

	assert.deepEqual(outcome, { status: 'unchanged' });
	assert.equal(app.content, original);
});

test('行漂移：startLine 失配但原序列在别处唯一命中 → 仍能定位', async () => {
	const app = makeApp(
		[
			'# 新插入的行',
			'- [ ] 甲',
			'      续行一',
			'- [ ] 乙',
		].join('\n'),
	);
	const outcome = await commitTaskContinuation(app, makeFile(), {
		startLine: 1,
		endLine: 1,
		originalLines: ['      续行一'],
		nextText: '改过',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(
		app.content,
		['# 新插入的行', '- [ ] 甲', '      改过', '- [ ] 乙'].join('\n'),
	);
});

test('原序列不存在：conflict，内容零变化', async () => {
	const original = ['- [ ] 甲', '- [ ] 乙'].join('\n');
	const app = makeApp(original);
	const outcome = await commitTaskContinuation(app, makeFile(), {
		startLine: 1,
		endLine: 1,
		originalLines: ['      不存在的续行'],
		nextText: '改',
	});

	assert.deepEqual(outcome, { status: 'conflict', line: 1 });
	assert.equal(app.content, original);
});

test('缩进还原：编辑器持有 dedent 文本，提交时补回原公共前缀', async () => {
	const app = makeApp(
		['- [ ] 甲', '      续行一', '      续行二', '- [ ] 乙'].join('\n'),
	);
	const outcome = await commitTaskContinuation(app, makeFile(), {
		startLine: 1,
		endLine: 2,
		originalLines: ['      续行一', '      续行二'],
		nextText: '一\n  二', // 相对缩进保留，整体前缀由写回层补回
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(
		app.content,
		['- [ ] 甲', '      一', '        二', '- [ ] 乙'].join('\n'),
	);
});

test('CRLF：\\r 保留，写回仍是 CRLF', async () => {
	const app = makeApp(
		['- [ ] 甲\r', '      续行一\r', '- [ ] 乙\r'].join('\n'),
	);
	const outcome = await commitTaskContinuation(app, makeFile(), {
		startLine: 1,
		endLine: 1,
		originalLines: ['      续行一\r'],
		nextText: '续行一改\r',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(
		app.content,
		['- [ ] 甲\r', '      续行一改\r', '- [ ] 乙\r'].join('\n'),
	);
	assert.ok(app.content.includes('\r\n'));
});

test('区间不越出：只吃快照序列，不吃任务行 / 空行', async () => {
	// 空行把续行与下方正文分开；快照只含续行行，替换不波及空行与任务行。
	const app = makeApp(
		['- [ ] 甲', '      续行一', '', '隔空正文', '- [ ] 乙'].join('\n'),
	);
	const outcome = await commitTaskContinuation(app, makeFile(), {
		startLine: 1,
		endLine: 1,
		originalLines: ['      续行一'],
		nextText: '',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(
		app.content,
		['- [ ] 甲', '', '隔空正文', '- [ ] 乙'].join('\n'),
	);
});
