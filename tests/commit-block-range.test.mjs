import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

/**
 * `commitBlockRange`（[[Plan-20261010-080827]] 批次 1 §3.1）纯函数单测。
 *
 * 与 `commit-task-continuation.test.mjs` 同源：唯一差别是**无缩进语义**（Section
 * 原样进出），故用例刻意与续行对照（同样的输入，续行补前缀、这里不补）。
 */
const jiti = createJiti(import.meta.url, { moduleCache: false });
const { commitBlockRange } = await jiti.import(
	'../src/views/ioto-task/commit-task-line.ts',
);

function makeApp(initial) {
	let current = initial;
	let writes = 0;
	return {
		get content() {
			return current;
		},
		get writes() {
			return writes;
		},
		vault: {
			process: async (_file, fn) => {
				const next = fn(current);
				if (next !== current) {
					current = next;
					writes += 1;
				}
				return next;
			},
		},
	};
}

function makeFile(path = '3-任务/Demo/T.md') {
	return { path };
}

test('多行 nextText：整段替换，原样（不补缩进）', async () => {
	const app = makeApp(
		[
			'# 目标',
			'      续行一',
			'      续行二',
			'# 任务',
		].join('\n'),
	);
	const outcome = await commitBlockRange(app, makeFile(), {
		startLine: 0,
		endLine: 2,
		originalLines: ['# 目标', '      续行一', '      续行二'],
		nextText: '改一\n改二\n改三',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(
		app.content,
		['改一', '改二', '改三', '# 任务'].join('\n'),
		// ⚠️ 关键对照：续行会把 nextText 补回公共前缀，这里原样
	);
});

test('含标题行改名：首行替换', async () => {
	const app = makeApp(['## 目标', '- [ ] 甲', '## 任务'].join('\n'));
	const outcome = await commitBlockRange(app, makeFile(), {
		startLine: 0,
		endLine: 1,
		originalLines: ['## 目标', '- [ ] 甲'],
		nextText: '## 新目标\n- [ ] 甲',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(app.content, ['## 新目标', '- [ ] 甲', '## 任务'].join('\n'));
});

test('nextText 全空白：整块删除，下一标题保留', async () => {
	const app = makeApp(['## 目标', '- [ ] 甲', '## 任务'].join('\n'));
	const outcome = await commitBlockRange(app, makeFile(), {
		startLine: 0,
		endLine: 1,
		originalLines: ['## 目标', '- [ ] 甲'],
		nextText: '   \n\n',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(app.content, '## 任务');
});

test('未改动：unchanged，内容零变化', async () => {
	const original = ['## 目标', '- [ ] 甲', '## 任务'].join('\n');
	const app = makeApp(original);
	const outcome = await commitBlockRange(app, makeFile(), {
		startLine: 0,
		endLine: 1,
		originalLines: ['## 目标', '- [ ] 甲'],
		nextText: '## 目标\n- [ ] 甲',
	});

	assert.deepEqual(outcome, { status: 'unchanged' });
	assert.equal(app.content, original);
	assert.equal(app.writes, 0);
});

test('行漂移：startLine 失配但原序列在别处唯一命中 → 仍能定位', async () => {
	const app = makeApp(
		['# 新插入的行', '## 目标', '- [ ] 甲', '## 任务'].join('\n'),
	);
	const outcome = await commitBlockRange(app, makeFile(), {
		startLine: 0,
		endLine: 1,
		originalLines: ['## 目标', '- [ ] 甲'],
		nextText: '## 目标改\n- [ ] 甲',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(
		app.content,
		['# 新插入的行', '## 目标改', '- [ ] 甲', '## 任务'].join('\n'),
	);
});

test('原序列不存在：conflict，内容零变化', async () => {
	const original = ['## 目标', '## 任务'].join('\n');
	const app = makeApp(original);
	const outcome = await commitBlockRange(app, makeFile(), {
		startLine: 0,
		endLine: 0,
		originalLines: ['## 不存在的节'],
		nextText: '改',
	});

	assert.deepEqual(outcome, { status: 'conflict', line: 0 });
	assert.equal(app.content, original);
});

test('CRLF：\\r 保留，写回仍是 CRLF', async () => {
	const app = makeApp(
		['## 目标\r', '- [ ] 甲\r', '## 任务\r'].join('\n'),
	);
	const outcome = await commitBlockRange(app, makeFile(), {
		startLine: 0,
		endLine: 1,
		originalLines: ['## 目标\r', '- [ ] 甲\r'],
		nextText: '## 目标改\r\n- [ ] 甲\r',
	});

	assert.equal(outcome.status, 'ok');
	assert.equal(
		app.content,
		['## 目标改\r', '- [ ] 甲\r', '## 任务\r'].join('\n'),
	);
	assert.ok(app.content.includes('\r\n'));
});
