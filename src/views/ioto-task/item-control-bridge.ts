/**
 * 「条目控制」桥接（[[Plan-20261003-105625]]，依据 [[Research-20261003-103529]]）。
 *
 * 目标：在 IOTOTask 视图**卡片内联编辑态**下，让 `ioto-settings` 的
 * `Option+I`（命令 `ioto-settings:ioto-edit-item-controls`）可用，并复用其原生
 * 「条目控制」面板，不改动 `ioto-settings`。
 *
 * 为什么需要桥接（Research §二）：该命令入口即 `getActiveViewOfType(MarkdownView)`，
 * IOTOTask 是 `TextFileView` 的子类、不是 `MarkdownView` → 返回 `null` → 静默返回；
 * 即便绕过第一层，卡片编辑器里装的是「展示正文」（无 `- [ ]`、无 `#ioto/*`），
 * 仍会被整行判据挡下（弹「请先把光标放到任务行上」）。
 *
 * 三层桥接：
 *   ① 入口：包装 `app.commands.executeCommand`（热键与命令面板的公共下游），只命中
 *      这一条命令，且仅当「活动视图是 IOTOTask 且正在内联编辑」时启用；其余命令 /
 *      其余视图原样透传；
 *   ② 假视图：临时把 `app.workspace.getActiveViewOfType` 对 `MarkdownView` 的查询
 *      换成 `{ editor: 桥接编辑器, file: 视图自己的 TFile }`，其它类型透传真实实现；
 *   ③ 桥接编辑器：用**文件真实整行**实现命令用到的 Editor 面
 *      （getCursor / getLine / transaction / charCoords / getScrollInfo）。
 *
 * 还原时机：`openForActiveLine` 只在**首个同步段**查询一次视图（此后把返回值存在
 * 局部变量里跨 await 使用），因此命令同步派发返回后用微任务 + 宏任务尽快还原 shim，
 * 把影响窗压到「命令派发后的一瞬」，而非整个面板生命周期。
 *
 * 本文件运行期只依赖 `obsidian` 的 `MarkdownView`；宿主类型从视图侧 **type-only**
 * 引入，避免与 `iotoTaskView.ts` 形成运行期循环依赖，也便于 jiti 直接单测。
 */

import { MarkdownView } from 'obsidian';
import type { App } from 'obsidian';

import type { ItemControlBridgeHost } from '../iotoTaskView';
import { fitItemControlPanelWhenMounted } from './fit-item-control-panel';

/**
 * IOTOTask 的视图类型标识。
 * 定义在此以便桥接层零依赖视图实现；由 `iotoTaskView.ts` 再导出，外部导入路径不变。
 */
export const IOTO_TASK_VIEW_TYPE = 'IOTOTask';

/** `ioto-settings` 的「编辑条目控制」命令 id（其 `ensureCommandHotkey` 固定为 Alt+I）。 */
export const ITEM_CONTROL_COMMAND_ID = 'ioto-settings:ioto-edit-item-controls';

/** 纯判据：只在「命令 id 命中 + 视图是 IOTOTask + 正在内联编辑」时启用桥接。 */
export function shouldBridgeItemControl(
	id: unknown,
	viewType: unknown,
	editingLine: number | null,
): boolean {
	return (
		id === ITEM_CONTROL_COMMAND_ID &&
		viewType === IOTO_TASK_VIEW_TYPE &&
		typeof editingLine === 'number'
	);
}

/** 命令写回时传给桥接编辑器的 changes 形状（只取首个 change 的 text）。 */
export interface BridgeEditorChanges {
	changes?: Array<{ text?: string }>;
}

/** 命令实际用到的 Editor 面（最小适配面，随对方版本增补）。 */
export interface BridgeEditor {
	getCursor(): { line: number; ch: number };
	getLine(line: number): string;
	transaction(changes: BridgeEditorChanges): void;
	charCoords(): { top: number; left: number; bottom: number; right: number };
	getScrollInfo(): {
		clientWidth: number;
		width: number;
		clientHeight: number;
		top: number;
		left: number;
	};
}

/**
 * 桥接编辑器：全部委托给宿主的**文件级**数据，不接触卡片 DOM 文本。
 *
 * - `getLine(editingLine)` 返回「磁盘行 + 未提交 CM 正文」的**合成整行**
 *   （`replaceTaskBody`），保住用户输入且让控制标签写回正确；
 * - `transaction` 取 `changes[0].text`（面板已给出完整整行）→ 宿主走
 *   `commitTaskLineAction` 原子写回。
 */
export function createBridgeEditor(host: ItemControlBridgeHost): BridgeEditor {
	return {
		getCursor: () => ({ line: host.line, ch: 0 }),
		getLine: (line: number) =>
			line === host.line ? host.readBridgeLine() : host.readDiskLine(line),
		transaction: (changes: BridgeEditorChanges) => {
			const text = changes?.changes?.[0]?.text;
			if (typeof text === 'string') {
				void host.commitBridgeLine(text);
			}
		},
		charCoords: () => host.getLineCoords(host.line),
		getScrollInfo: () => {
			// ioto-settings 的 positionPanel 读 `.clientWidth`（缺省回退 560）；
			// 同时给出 width，兼容不同版本的读法。
			const width = host.getScrollWidth();
			return {
				clientWidth: width,
				width,
				clientHeight: 0,
				top: 0,
				left: 0,
			};
		},
	};
}

interface WorkspaceLike {
	getActiveViewOfType: (type: unknown) => unknown;
}

/**
 * 临时改写 `getActiveViewOfType`：对 `MarkdownView` 返回假视图，其它类型透传真实实现。
 * 返回**幂等**的还原函数。
 */
export function shimActiveMarkdownView(
	app: App,
	host: ItemControlBridgeHost,
): () => void {
	const workspace = app.workspace as unknown as WorkspaceLike;
	const original = workspace.getActiveViewOfType.bind(workspace);
	let restored = false;

	workspace.getActiveViewOfType = (type: unknown): unknown => {
		if (type === MarkdownView) {
			return { editor: createBridgeEditor(host), file: host.file };
		}
		return original(type);
	};

	return () => {
		if (restored) {
			return;
		}
		restored = true;
		workspace.getActiveViewOfType = original;
	};
}

/** 活动视图里可由桥接识别的两个成员（鸭子类型，不 import 视图类）。 */
interface ItemControlHostView {
	getViewType?: () => string;
	getItemControlHost?: () => ItemControlBridgeHost | null;
}

function resolveBridgeHost(app: App, id: unknown): ItemControlBridgeHost | null {
	try {
		if (id !== ITEM_CONTROL_COMMAND_ID) {
			return null;
		}
		// 需要「任意类型的活动视图」，只有 activeLeaf 能拿到；
		// `getActiveViewOfType` 必须传入视图类，而本层刻意不 import 视图实现。
		// eslint-disable-next-line @typescript-eslint/no-deprecated
		const view = app.workspace.activeLeaf?.view as unknown as
			| ItemControlHostView
			| undefined;
		const host = view?.getItemControlHost?.() ?? null;
		if (!host) {
			return null;
		}
		return shouldBridgeItemControl(id, view?.getViewType?.(), host.line)
			? host
			: null;
	} catch {
		return null;
	}
}

/** `Commands.executeCommand` 的命令形状：判据只取 `id`。 */
interface CommandLike {
	id?: string;
}

interface CommandsLike {
	executeCommand: (command: unknown, evt?: unknown) => unknown;
}

/**
 * 安装命令拦截。返回**卸载函数**：把 `executeCommand` 复原（供 `plugin.register` 使用）。
 *
 * 为什么包 `executeCommand` 而不是 `executeCommandById`（[[Research-20261003-111611]] §二）：
 * 核心热键 `HotkeyManager.onTrigger` 直接 `this.app.commands.executeCommand(cmd)`，
 * **不经过** `executeCommandById`；而 `executeCommandById` 内部就是 `this.executeCommand(n, t)`。
 * 包住 `executeCommand` 可一次覆盖「热键 + 命令面板」两条路径。
 */
export function installItemControlBridge(app: App): () => void {
	// `commands` 未出现在公开的 `App` 类型里，但运行期存在（命令派发入口）。
	const commands = (app as unknown as { commands: CommandsLike }).commands;
	const original = commands.executeCommand.bind(commands);

	commands.executeCommand = (command: unknown, evt?: unknown): unknown => {
		const host = resolveBridgeHost(app, (command as CommandLike | undefined)?.id);
		if (!host) {
			return original(command, evt); // 其余命令 / 其余视图 / 非编辑态：原样透传
		}

		const restore = shimActiveMarkdownView(app, host);
		try {
			return original(command, evt);
		} catch (error) {
			// 同步段异常：还原后放行，绝不白屏（异步段异常由 ioto-settings 自己兜底）。
			console.error('[IOTO Task] 条目控制桥接失败，已还原', error);
			restore();
			return undefined;
		} finally {
			// 视图查询发生在命令的同步段；微任务 + 宏任务尽早还原，幂等。
			void Promise.resolve().then(restore);
			window.setTimeout(restore, 0);
			// 面板不在同步段创建（对端先 await buildContext）→ 等它真正挂载后再量高
			// 重定位一次（[[Plan-20261003-172455]]：下方放不下翻上方 / 夹取，不改
			// ioto-settings）。`restore` 只还原视图查询 shim，与定位互不依赖。
			fitItemControlPanelWhenMounted(host);
		}
	};

	return () => {
		commands.executeCommand = original;
	};
}
