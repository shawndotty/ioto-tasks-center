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
	commonIndentPrefix,
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
	/**
	 * 插入型变换（返回值含 ≥2 行）时，把**首项留在定位行原位**，其余新增行插到
	 * 「定位行 + 其下连续续行」之后，而不是紧贴定位行。
	 * 用于「新建同级任务」：保证原任务的 Shift+Enter 续行不被新任务抢走。
	 * 单行返回值（纯替换 / 删除）忽略此项。
	 */
	insertAfterContinuations?: boolean;
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
			const inserted = Array.isArray(next) ? next : [next];
			if (options.insertAfterContinuations && inserted.length > 1) {
				// 块尾：定位行之后、仍属「任务续行」的连续行之后
				let contEnd = index + 1;
				while (
					contEnd < lines.length &&
					isTaskContinuationLine(lines[contEnd] ?? '')
				) {
					contEnd += 1;
				}
				lines.splice(index, 1, inserted[0] ?? ''); // 首项原位替换
				lines.splice(contEnd, 0, ...inserted.slice(1)); // 其余落到整块之后
			} else {
				lines.splice(index, 1, ...inserted);
			}
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

export interface CommitTaskContinuationOptions {
	/** 打开编辑器时快照的续行块首行（0 基，= 任务行 + 1） */
	startLine: number;
	/** 快照的续行块末行（0 基，含） */
	endLine: number;
	/** 快照的续行块各行原文（`lines[startLine..endLine]`），用于行漂移后二次定位 */
	originalLines: string[];
	/** 编辑器提交的正文（已 dedent）；`''` → 删除整段续行 */
	nextText: string;
}

/**
 * 替换「任务行下方的一段连续续行」。原子 `vault.process`：
 * 定位（startLine + 原序列校验，失败则全文按序列搜一次）→ 用原块公共前缀重新缩进
 * → splice 整段替换；`nextText === ''` 即整段删除。绝不整篇序列化回写。
 *
 * 只认「快照的整段序列完全一致」：不吃任务行、不吃空行，块内只可能由调用方传入
 * `isTaskContinuationLine` 成立的行。
 */
export async function commitTaskContinuation(
	app: App,
	file: TFile,
	options: CommitTaskContinuationOptions,
): Promise<CommitOutcome> {
	let outcome: CommitOutcome = { status: 'unchanged' };

	await app.vault.process(file, (content) => {
		const lines = content.split('\n');
		const count = options.originalLines.length;
		const matchesAt = (at: number): boolean =>
			options.originalLines.every((line, i) => lines[at + i] === line);

		// ① 定位：优先 startLine；该处不匹配 → 全文按原序列再搜一次
		let index = options.startLine;
		if (index < 0 || !matchesAt(index)) {
			index = -1;
			for (let i = 0; i + count <= lines.length; i += 1) {
				if (matchesAt(i)) {
					index = i;
					break;
				}
			}
			if (index < 0) {
				outcome = { status: 'conflict', line: options.startLine };
				return content;
			}
		}

		// ② 重新缩进：原块公共前缀补回（空行保持空行）
		const indent = commonIndentPrefix(options.originalLines);
		const nextLines =
			options.nextText.length === 0
				? []
				: options.nextText
						.split('\n')
						.map((line) =>
							line.trim().length === 0 ? '' : indent + line,
						);

		// ③ 无改动短路
		if (
			nextLines.length === count &&
			nextLines.every((line, i) => line === lines[index + i])
		) {
			outcome = { status: 'unchanged' };
			return content;
		}

		// ④ 整段替换（nextLines 为空即删除）
		lines.splice(index, count, ...nextLines);
		const result = lines.join('\n');
		outcome = { status: 'ok', content: result };
		return result;
	});

	return outcome;
}
