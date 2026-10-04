/**
 * IOTOTask 视图的行级写回层（[[Plan-20261003-073911]] §5.2）。
 *
 * 所有编辑动作（3a 勾选 / 3b 提交 / 3c 新建·删除·缩进）都收敛到 `commitTaskLineAction`：
 * 用 `vault.process` 原子读改写，`data-line` 定位 + 原行校验 + 单行 splice，
 * **绝不整篇序列化回写**（会破坏 frontmatter 引号 / 键序、callout、`%%…%%`、`#ioto/*`）。
 *
 * 本模块只 import type（无 obsidian 运行时依赖），因此可被 jiti 直接单测；
 * 冲突的 Notice 文案由视图层（调用方）根据 outcome 决定，本层不弹窗。
 */

import type { App, TFile } from 'obsidian';

import {
	replaceTaskBody,
	isTaskContinuationLine,
} from '../../tasks-center/note-structure';

export type CommitOutcome =
	| { status: 'ok'; content: string }
	| { status: 'unchanged' }
	| { status: 'conflict'; line: number };

/**
 * 纯行变换：
 * - 返回 `string` → 替换该行（与原文相同则短路为 `unchanged`）；
 * - 返回 `string[]` → 该行替换成多行（`[]` 等价于删除）；
 * - 返回 `''` → 删除该行；
 * - 返回 `null` → 不是任务行 / 不匹配，放弃（视为冲突）。
 */
export type TaskLineTransform = (line: string) => string | string[] | null;

export interface CommitTaskLineOptions {
	/** 打开编辑器时快照的 0 基行号（来自卡片 `data-line`） */
	line: number;
	/** 打开编辑器时快照的原始行文本（用于行漂移后的二次定位） */
	originalLine: string;
	transform: TaskLineTransform;
	/**
	 * 整行删除时，连同紧随其后、仍属「任务续行」的行一并删除。
	 * 续行口径复用渲染层 isTaskContinuationLine → 卡片里显示几行就删几行。
	 * 仅在 transform 判定为删除（返回 '' / []）时生效；其它返回值忽略此项。
	 * 不会级联删除嵌套子任务（子任务行以列表标记开头，本就不算续行）。
	 */
	swallowContinuations?: boolean;
}

export async function commitTaskLineAction(
	app: App,
	file: TFile,
	options: CommitTaskLineOptions,
): Promise<CommitOutcome> {
	// vault.process 的回调在冲突时可能被重试，outcome 取最后一次的值。
	let outcome: CommitOutcome = { status: 'unchanged' };

	await app.vault.process(file, (content) => {
		// CRLF 保护：统一按 '\n' 切，行尾的 '\r' 留在行内，join('\n') 后 EOL 不变。
		const lines = content.split('\n');

		// ① 定位：优先 data-line；该行已不等于打开时的原始行 → 按 originalLine 全文再搜一次
		let index = options.line;
		if (
			index < 0 ||
			index >= lines.length ||
			lines[index] !== options.originalLine
		) {
			index = lines.indexOf(options.originalLine);
			if (index < 0) {
				outcome = { status: 'conflict', line: options.line };
				return content;
			}
		}

		// ② 变换（纯函数）；null = 不是任务行，放弃
		const next = options.transform(lines[index] ?? '');
		if (next === null) {
			outcome = { status: 'conflict', line: index };
			return content;
		}

		// ③ 无改动短路：避免无意义的 modify → 重绘 → 编辑器被卸载
		if (typeof next === 'string' && next === lines[index]) {
			outcome = { status: 'unchanged' };
			return content;
		}
		if (Array.isArray(next) && next.length === 1 && next[0] === lines[index]) {
			outcome = { status: 'unchanged' };
			return content;
		}

		// ④ splice（单行 / 插入 / 删除都在这里完成，绝不整篇序列化）
		if (next === '' || (Array.isArray(next) && next.length === 0)) {
			let removeEnd = index + 1; // 至少删定位行本身
			if (options.swallowContinuations) {
				while (
					removeEnd < lines.length &&
					isTaskContinuationLine(lines[removeEnd] ?? '')
				) {
					removeEnd += 1;
				}
			}
			lines.splice(index, removeEnd - index); // 一次删掉定位行 + 其后连续续行
		} else {
			lines.splice(index, 1, ...(Array.isArray(next) ? next : [next]));
		}

		const result = lines.join('\n');
		outcome = { status: 'ok', content: result };
		return result;
	});

	return outcome;
}

export interface CommitTaskTextOptions {
	line: number;
	originalLine: string;
	/** 编辑器提交的正文（不含前缀 / 不含 `#ioto/*` 标签） */
	nextBody: string;
}

/** 3b 提交：只换正文，保留前缀、勾选态、行尾 `#ioto/*` 标签。 */
export async function commitTaskText(
	app: App,
	file: TFile,
	options: CommitTaskTextOptions,
): Promise<CommitOutcome> {
	return commitTaskLineAction(app, file, {
		line: options.line,
		originalLine: options.originalLine,
		transform: (line) => replaceTaskBody(line, options.nextBody),
	});
}
