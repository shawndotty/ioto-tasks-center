import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

// 只锁「判据契约 + 适配面形状 + 合成口径」；shim 还原时机、面板真实行为、
// 写回语义必须真机验证（Plan-20261003-105625 §5.8 / §七）。

const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	alias: {
		obsidian: new URL('./stubs/obsidian.mjs', import.meta.url).pathname,
	},
});

const { MarkdownView } = await jiti.import('./stubs/obsidian.mjs');
const {
	ITEM_CONTROL_COMMAND_ID,
	TASK_OUTLINK_COMMAND_ID,
	RUN_TASK_COMMAND_ID,
	RUN_TASK_DRY_RUN_COMMAND_ID,
	RUN_TASK_CHECKLIST_COMMAND_ID,
	IOTO_TASK_VIEW_TYPE,
	resolveBridgedCommand,
	shouldBridgeInTaskView,
	createBridgeEditor,
	shimActiveMarkdownView,
	installItemControlBridge,
} = await jiti.import('../src/views/ioto-task/item-control-bridge.ts');
const { replaceTaskBody } = await jiti.import(
	'../src/tasks-center/note-structure.ts',
);

function makeHost(overrides = {}) {
	const calls = { readBridge: 0, readDisk: [], commit: [] };
	const host = {
		file: { path: '3-任务/itc-probe.md', name: 'itc-probe.md' },
		line: 5,
		originalLine: '- [ ] 任务一 #ioto/turns/200',
		readBridgeLine: () => {
			calls.readBridge += 1;
			return '- [ ] 任务一 #ioto/turns/200';
		},
		readDiskLine: (n) => {
			calls.readDisk.push(n);
			return `disk-${n}`;
		},
		commitBridgeLine: (line) => {
			calls.commit.push(line);
			return Promise.resolve({ status: 'ok', content: line });
		},
		getLineCoords: () => ({ top: 10, left: 20, bottom: 30, right: 40 }),
		getScrollWidth: () => 600,
		...overrides,
	};
	return { host, calls };
}

/* ------------------------------------------------------------------ *
 * resolveBridgedCommand（命令族判据）
 * ------------------------------------------------------------------ */

test('resolveBridgedCommand：两条桥接命令各归一类', () => {
	assert.equal(resolveBridgedCommand(ITEM_CONTROL_COMMAND_ID), 'item-control');
	assert.equal(resolveBridgedCommand(TASK_OUTLINK_COMMAND_ID), 'task-outlink');
});

test('resolveBridgedCommand：执行任务三命令同归 run-task 族', () => {
	assert.equal(resolveBridgedCommand(RUN_TASK_COMMAND_ID), 'run-task');
	assert.equal(resolveBridgedCommand(RUN_TASK_DRY_RUN_COMMAND_ID), 'run-task');
	assert.equal(resolveBridgedCommand(RUN_TASK_CHECKLIST_COMMAND_ID), 'run-task');
});

test('resolveBridgedCommand：其它命令 / 无 id → null（原样透传）', () => {
	assert.equal(resolveBridgedCommand('other:cmd'), null);
	assert.equal(resolveBridgedCommand(undefined), null);
});

/* ------------------------------------------------------------------ *
 * shouldBridgeInTaskView（视图 + 编辑判据）
 * ------------------------------------------------------------------ */

test('shouldBridgeInTaskView：IOTOTask + 编辑中 → true', () => {
	assert.equal(shouldBridgeInTaskView(IOTO_TASK_VIEW_TYPE, 5), true);
});

test('shouldBridgeInTaskView：视图不命中 / 非编辑态 → false', () => {
	assert.equal(shouldBridgeInTaskView('markdown', 5), false);
	assert.equal(shouldBridgeInTaskView(IOTO_TASK_VIEW_TYPE, null), false);
	assert.equal(shouldBridgeInTaskView(IOTO_TASK_VIEW_TYPE, undefined), false);
});

test('命令 id / 视图类型标识与 ioto-settings 及本插件口径一致', () => {
	assert.equal(
		ITEM_CONTROL_COMMAND_ID,
		'ioto-settings:ioto-edit-item-controls',
	);
	assert.equal(
		TASK_OUTLINK_COMMAND_ID,
		'ioto-settings:ioto-insert-outgoing-link',
	);
	assert.equal(RUN_TASK_COMMAND_ID, 'ioto-settings:ioto-run-task');
	assert.equal(
		RUN_TASK_DRY_RUN_COMMAND_ID,
		'ioto-settings:ioto-run-task-dry-run',
	);
	assert.equal(
		RUN_TASK_CHECKLIST_COMMAND_ID,
		'ioto-settings:ioto-run-task-checklist',
	);
	assert.equal(IOTO_TASK_VIEW_TYPE, 'IOTOTask');
});

/* ------------------------------------------------------------------ *
 * createBridgeEditor
 * ------------------------------------------------------------------ */

test('createBridgeEditor：getCursor 返回文件行号而非卡片内相对行号', () => {
	const { host } = makeHost();
	assert.deepEqual(createBridgeEditor(host).getCursor(), { line: 5, ch: 0 });
});

test('createBridgeEditor：getLine 编辑行走 readBridgeLine，其它行走 readDiskLine', () => {
	const { host, calls } = makeHost();
	const editor = createBridgeEditor(host);

	assert.equal(editor.getLine(5), '- [ ] 任务一 #ioto/turns/200');
	assert.equal(calls.readBridge, 1);
	assert.equal(editor.getLine(6), 'disk-6');
	assert.deepEqual(calls.readDisk, [6]);
});

test('createBridgeEditor：transaction 取首个 change.text 作为新整行落盘', () => {
	const { host, calls } = makeHost();
	createBridgeEditor(host).transaction({
		changes: [{ text: '- [ ] 任务一 #ioto/turns/5' }],
	});
	assert.deepEqual(calls.commit, ['- [ ] 任务一 #ioto/turns/5']);
});

test('createBridgeEditor：transaction 缺 changes / text 非字符串 → 不落盘', () => {
	const { host, calls } = makeHost();
	const editor = createBridgeEditor(host);
	editor.transaction({});
	editor.transaction({ changes: [] });
	editor.transaction({ changes: [{ text: 123 }] });
	assert.deepEqual(calls.commit, []);
});

test('createBridgeEditor：charCoords / getScrollInfo 供面板定位（含 clientWidth）', () => {
	const { host } = makeHost();
	const editor = createBridgeEditor(host);

	assert.deepEqual(editor.charCoords(), {
		top: 10,
		left: 20,
		bottom: 30,
		right: 40,
	});
	const info = editor.getScrollInfo();
	assert.equal(info.clientWidth, 600);
	assert.equal(info.width, 600);
});

/* ------------------------------------------------------------------ *
 * shimActiveMarkdownView
 * ------------------------------------------------------------------ */

function makeApp() {
	const real = (type) => ({ real: type });
	const workspace = { getActiveViewOfType: real };
	return { app: { workspace }, workspace };
}

test('shimActiveMarkdownView：MarkdownView → 假视图；其它类型 → 真实实现', () => {
	const { app, workspace } = makeApp();
	const { host } = makeHost();
	const restore = shimActiveMarkdownView(app, host);

	const fake = workspace.getActiveViewOfType(MarkdownView);
	assert.equal(fake.file, host.file);
	assert.equal(typeof fake.editor.getCursor, 'function');
	assert.deepEqual(fake.editor.getCursor(), { line: 5, ch: 0 });

	const other = {};
	assert.deepEqual(workspace.getActiveViewOfType(other), { real: other });

	restore();
	assert.deepEqual(workspace.getActiveViewOfType(MarkdownView), {
		real: MarkdownView,
	});
});

test('shimActiveMarkdownView：restore 幂等，重复调用不再改写', () => {
	const { app, workspace } = makeApp();
	const { host } = makeHost();
	const restore = shimActiveMarkdownView(app, host);

	restore();
	const afterFirst = workspace.getActiveViewOfType;
	restore();
	assert.equal(workspace.getActiveViewOfType, afterFirst);
});

/* ------------------------------------------------------------------ *
 * 合成整行口径（宿主 readBridgeLine 用的纯函数）
 * ------------------------------------------------------------------ */

test('合成整行：replaceTaskBody 保留 #ioto/* 并拼回正文之后', () => {
	const disk = '- [ ] 任务一 #ioto/turns/200';
	assert.equal(replaceTaskBody(disk, '任务一'), disk);
	assert.equal(
		replaceTaskBody(disk, '任务一 [[IOTO Task Center-计划-V250]]'),
		'- [ ] 任务一 [[IOTO Task Center-计划-V250]] #ioto/turns/200',
	);
});

/* ------------------------------------------------------------------ *
 * installItemControlBridge（拦截点 = executeCommand，见 [[Plan-20261003-113130]] §5.6）
 * ------------------------------------------------------------------ */

/**
 * 构造带 `commands.executeCommand` + IOTOTask 活动视图的 App 桩。
 * `original` 内部记录「派发期间 getActiveViewOfType(MarkdownView) 返回值」，
 * 用于断言 shim 是否在被包的方法体内生效。
 */
function makeBridgeApp() {
	const { host } = makeHost();
	const realGetActive = (type) => ({ real: type });
	const workspace = {
		activeLeaf: {
			view: {
				getViewType: () => IOTO_TASK_VIEW_TYPE,
				getItemControlHost: () => host,
			},
		},
		getActiveViewOfType: realGetActive,
	};
	const calls = { original: 0, seen: [] };
	const commands = {
		executeCommand(command, evt) {
			calls.original += 1;
			calls.seen.push(workspace.getActiveViewOfType(MarkdownView));
			return { command, evt };
		},
	};
	return { app: { commands, workspace }, commands, workspace, host, calls };
}

test('installItemControlBridge：命中 → 桥接期间 shim 生效，original 只调用一次', () => {
	const { app, commands, host, calls } = makeBridgeApp();
	const uninstall = installItemControlBridge(app);

	commands.executeCommand({ id: ITEM_CONTROL_COMMAND_ID });

	assert.equal(calls.original, 1);
	assert.equal(calls.seen.length, 1);
	assert.equal(calls.seen[0].file, host.file);
	assert.equal(typeof calls.seen[0].editor.getCursor, 'function');

	uninstall();
});

test('installItemControlBridge：命中出链命令 → original 只调用一次，且不安装 shim', () => {
	const { app, commands, calls } = makeBridgeApp();
	const uninstall = installItemControlBridge(app);

	commands.executeCommand({ id: TASK_OUTLINK_COMMAND_ID });

	assert.equal(calls.original, 1);
	// 出链读 getActiveFile() + activeEditor?.editor（编辑态已登记）→ 无需假视图，
	// seen[0] 仍是真实实现（未被 shim 替换）。
	assert.deepEqual(calls.seen[0], { real: MarkdownView });

	uninstall();
});

test('installItemControlBridge：非本命令 / 无 id → 原样透传，不安装 shim', () => {
	const { app, commands, calls } = makeBridgeApp();
	const uninstall = installItemControlBridge(app);

	commands.executeCommand({ id: 'other:cmd' });
	commands.executeCommand(undefined);

	assert.equal(calls.original, 2);
	assert.deepEqual(calls.seen[0], { real: MarkdownView });

	uninstall();
});

test('installItemControlBridge：executeCommandById 内部 this.executeCommand 路径也被覆盖（单点覆盖、无双层）', () => {
	const { app, commands, host, calls } = makeBridgeApp();
	// 模拟核心 Commands.executeCommandById：内部就是 this.executeCommand(findCommand(id))。
	commands.executeCommandById = (id) =>
		commands.executeCommand({ id });
	const uninstall = installItemControlBridge(app);

	commands.executeCommandById(ITEM_CONTROL_COMMAND_ID);

	assert.equal(calls.original, 1); // 只被调用一次，未叠加双层 shim
	assert.equal(calls.seen.length, 1);
	assert.equal(calls.seen[0].file, host.file);

	uninstall();
});

test('installItemControlBridge：卸载后 executeCommand 复原，再派发不再安装 shim', () => {
	const { app, commands, calls } = makeBridgeApp();
	const before = commands.executeCommand;
	const uninstall = installItemControlBridge(app);
	const installed = commands.executeCommand;
	assert.notEqual(installed, before); // 安装后换成包装函数

	uninstall();
	assert.notEqual(commands.executeCommand, installed); // 已还原，非包装
	assert.deepEqual(
		commands.executeCommand({ id: ITEM_CONTROL_COMMAND_ID }),
		{ command: { id: ITEM_CONTROL_COMMAND_ID }, evt: undefined },
	);
	assert.equal(calls.original, 1);
	assert.deepEqual(calls.seen[0], { real: MarkdownView }); // 未安装 shim
});

/* ------------------------------------------------------------------ *
 * installItemControlBridge — 「执行任务」族：派发前 flush
 * （[[Discuss-20261006-150839]] §三）
 * ------------------------------------------------------------------ */

/**
 * 构造带「落盘原语」的 IOTOTask 活动视图桩。`events` 记录 flush 与 original 的
 * 相对顺序，用于断言「flush 完成 → 才派发」；`seen` 记录派发期间
 * `getActiveViewOfType(MarkdownView)` 的返回值，用于断言是否装了假视图 shim。
 * `flush` 可注入（返回值 / 抛错）。
 */
function makeRunTaskApp(options = {}) {
	const events = [];
	const seen = [];
	const flush = options.flush ?? (() => {
		events.push('flush');
		return Promise.resolve();
	});
	const workspace = {
		activeLeaf: {
			view: options.view ?? {
				getViewType: () => IOTO_TASK_VIEW_TYPE,
				flushInlineEdits: flush,
			},
		},
		getActiveViewOfType: (type) => ({ real: type }),
	};
	const commands = {
		executeCommand(command, evt) {
			events.push('original');
			seen.push(workspace.getActiveViewOfType(MarkdownView));
			return { command, evt };
		},
	};
	return { app: { commands, workspace }, commands, workspace, events, seen };
}

test('installItemControlBridge：run-task → 先 flush 再派发（严格顺序）', async () => {
	const { app, commands, events } = makeRunTaskApp();
	const uninstall = installItemControlBridge(app);

	await commands.executeCommand({ id: RUN_TASK_COMMAND_ID });

	assert.deepEqual(events, ['flush', 'original']);
	uninstall();
});

test('installItemControlBridge：run-task 三命令都会触发 flush', async () => {
	for (const id of [
		RUN_TASK_COMMAND_ID,
		RUN_TASK_DRY_RUN_COMMAND_ID,
		RUN_TASK_CHECKLIST_COMMAND_ID,
	]) {
		const { app, commands, events } = makeRunTaskApp();
		const uninstall = installItemControlBridge(app);
		await commands.executeCommand({ id });
		assert.deepEqual(events, ['flush', 'original'], id);
		uninstall();
	}
});

test('installItemControlBridge：run-task 在非 IOTOTask 视图 → 原样透传、不 flush', async () => {
	const { app, commands, events } = makeRunTaskApp({
		view: { getViewType: () => 'markdown' },
	});
	const uninstall = installItemControlBridge(app);

	const result = await commands.executeCommand({ id: RUN_TASK_COMMAND_ID });

	assert.deepEqual(events, ['original']);
	assert.deepEqual(result, { command: { id: RUN_TASK_COMMAND_ID }, evt: undefined });
	uninstall();
});

test('installItemControlBridge：run-task 视图缺 flushInlineEdits → 原样透传', async () => {
	const { app, commands, events } = makeRunTaskApp({
		view: { getViewType: () => IOTO_TASK_VIEW_TYPE },
	});
	const uninstall = installItemControlBridge(app);

	await commands.executeCommand({ id: RUN_TASK_COMMAND_ID });

	assert.deepEqual(events, ['original']);
	uninstall();
});

test('installItemControlBridge：flush 抛错 → 吞掉异常后照常派发（不阻塞执行）', async () => {
	const { app, commands, events } = makeRunTaskApp({
		flush: () => {
			events.push('flush');
			return Promise.reject(new Error('write failed'));
		},
	});
	const uninstall = installItemControlBridge(app);

	await commands.executeCommand({ id: RUN_TASK_COMMAND_ID });

	assert.deepEqual(events, ['flush', 'original']);
	uninstall();
});

test('installItemControlBridge：run-task 不安装 MarkdownView shim', async () => {
	const { app, commands, seen } = makeRunTaskApp();
	const uninstall = installItemControlBridge(app);

	await commands.executeCommand({ id: RUN_TASK_COMMAND_ID });

	// 派发瞬间未被 shim 改写：仍是真实实现（flush 不依赖假视图）。
	assert.equal(seen.length, 1);
	assert.deepEqual(seen[0], { real: MarkdownView });
	uninstall();
});
