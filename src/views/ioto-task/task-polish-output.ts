/**
 * 任务描述润色的输出清洗与校验（Plan-20261125-210407 §4.3；Plan-20261126-063235 §3.3）。
 *
 * 纯函数、UI-free。清洗顺序本身是正确性的一部分：先剥模型包装，再清控制语法、
 * 对账交付物，最后把物理换行折成 `<br>`（保证写回仍是单物理行）。
 *
 * ⚠️ 交叉引用（Plan-20261127-192357）：ioto-settings 的「非任务笔记 AI 执行窗口」润色
 * 在本文件与 task-polish-prompt.ts 的副本 `ioto-settings/src/services/ai/polish-instruction.ts`。
 * 那份删掉了「折 `<br>`」执行段（TextArea 多行），其余逐字同源；改任一侧请同步另一侧，防漂移。
 */

import { collectDeliverableTokens } from './task-polish-prompt';

export interface PolishSanitizeFlags {
	fenceStripped: boolean;
	prefixStripped: boolean;
	quotesStripped: boolean;
	controlsRemoved: boolean;
	hallucinatedDeliverablesRemoved: boolean;
	lineBreaksConverted: boolean;
}

export interface DeliverableReconcileResult {
	text: string;
	/** 原文没有、被删掉的 @[[…]]（真幻觉；同一 token 重复出现多次则按次记录） */
	removedInvented: string[];
	/** 原文有、模型漏掉后追加到句尾的 @[[…]] */
	restoredMissing: string[];
	/** 模型写成 [[X]]、被就地补回 @ 的交付物 */
	repairedMarker: string[];
}

export interface PolishText {
	text: string;
	flags: PolishSanitizeFlags;
	/** 传了 originalBody 时非 null；供状态条读取三类结果 */
	deliverables: DeliverableReconcileResult | null;
}

export interface PolishSanitizeOptions {
	/** 整段原文；不传则跳过交付物对账（仅供纯清洗单测） */
	originalBody?: string;
}

/** 只剥一层外层三反引号围栏（等价于 ioto-settings 的 stripOuterFence）。 */
function stripOuterFence(text: string): string | null {
	const trimmed = text.trim();
	if (!trimmed.startsWith('```')) return null;
	const match = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
	if (!match) return null;
	const inner = (match[1] ?? '').trim();
	return inner ? inner : null;
}

const PREFIX_PATTERN = /^\s*(润色后|优化后|改写后|以下是[^\n]*)[：:]\s*/;

const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
	['"', '"'],
	['“', '”'],
	['「', '」'],
];

/** 模型可能照抄的控制语法：HTML 注释 / `#ioto/*` / `[model:: …]`。 */
const CONTROL_PATTERNS: readonly RegExp[] = [
	/<!--[\s\S]*?-->/g,
	/#ioto\/[^\s]+/g,
	/\[model::[^\]]*\]/g,
];

const DELIVERABLE_TOKEN_PATTERN = /@\[\[[^\]]+\]\]/g;

/** 扫描「前面不是 `@`」的普通链接出现次数与首个下标。 */
function scanPlainLink(
	text: string,
	plain: string,
): { count: number; first: number } {
	let from = 0;
	let count = 0;
	let first = -1;
	for (;;) {
		const index = text.indexOf(plain, from);
		if (index < 0) break;
		if (index === 0 || text[index - 1] !== '@') {
			count += 1;
			if (first < 0) first = index;
		}
		from = index + plain.length;
	}
	return { count, first };
}

/** 能否把 `[[X]]` 就地补回 `@[[X]]`：原文只以 `@` 形态出现 1 次，且当前唯一出现一次。 */
function tryRepairMarker(
	text: string,
	token: string,
	originalBody: string,
	originalCount: number,
): string | null {
	if (originalCount !== 1) return null;
	const plain = token.slice(1);
	if (scanPlainLink(originalBody, plain).count !== 0) return null;
	const scan = scanPlainLink(text, plain);
	if (scan.count !== 1) return null;
	return (
		text.slice(0, scan.first) +
		token +
		text.slice(scan.first + plain.length)
	);
}

export function reconcileDeliverables(
	text: string,
	originalBody: string,
): DeliverableReconcileResult {
	const originalTokens = collectDeliverableTokens(originalBody);
	const originalCount = new Map<string, number>();
	for (const token of originalTokens) {
		originalCount.set(token, (originalCount.get(token) ?? 0) + 1);
	}
	const quota = new Map(originalCount);

	const removedInvented: string[] = [];
	let reconciled = text.replace(DELIVERABLE_TOKEN_PATTERN, (token) => {
		const remaining = quota.get(token) ?? 0;
		if (remaining > 0) {
			quota.set(token, remaining - 1);
			return token;
		}
		// 原文存在但配额已用尽 = 模型重复，静默删除，不提示。
		if (!originalCount.has(token)) removedInvented.push(token);
		return '';
	});

	reconciled = reconciled.replace(/[ \t]{2,}/g, ' ').trim();

	const restoredMissing: string[] = [];
	const repairedMarker: string[] = [];

	for (const token of originalTokens) {
		while ((quota.get(token) ?? 0) > 0) {
			quota.set(token, (quota.get(token) ?? 0) - 1);
			const repaired = tryRepairMarker(
				reconciled,
				token,
				originalBody,
				originalCount.get(token) ?? 0,
			);
			if (repaired !== null) {
				reconciled = repaired;
				repairedMarker.push(token);
				continue;
			}
			reconciled =
				reconciled.length > 0 ? `${reconciled} ${token}` : token;
			restoredMissing.push(token);
		}
	}

	return {
		text: reconciled,
		removedInvented,
		restoredMissing,
		repairedMarker,
	};
}

export function sanitizePolishedText(
	raw: string,
	options: PolishSanitizeOptions = {},
): PolishText {
	const flags: PolishSanitizeFlags = {
		fenceStripped: false,
		prefixStripped: false,
		quotesStripped: false,
		controlsRemoved: false,
		hallucinatedDeliverablesRemoved: false,
		lineBreaksConverted: false,
	};

	let text = raw.trim();

	const fenced = stripOuterFence(text);
	if (fenced) {
		text = fenced;
		flags.fenceStripped = true;
	}

	const prefix = PREFIX_PATTERN.exec(text);
	if (prefix) {
		text = text.slice(prefix[0].length).trim();
		flags.prefixStripped = true;
	}

	for (const [open, close] of QUOTE_PAIRS) {
		if (text.length > 2 && text.startsWith(open) && text.endsWith(close)) {
			text = text.slice(open.length, text.length - close.length).trim();
			flags.quotesStripped = true;
			break;
		}
	}

	const beforeControls = text;
	for (const pattern of CONTROL_PATTERNS) {
		text = text.replace(pattern, ' ');
	}
	if (text !== beforeControls) {
		flags.controlsRemoved = true;
	}

	let deliverables: DeliverableReconcileResult | null = null;
	if (options.originalBody !== undefined) {
		deliverables = reconcileDeliverables(text, options.originalBody);
		text = deliverables.text;
		flags.hallucinatedDeliverablesRemoved =
			deliverables.removedInvented.length > 0;
	}

	// 控制语法删除后常留下连续空白：压成单空格（不动换行，交给下一步转换）。
	text = text.replace(/[ \t]{2,}/g, ' ').trim();

	if (text.includes('\n')) {
		text = text.replace(/[ \t]*\n+[ \t]*/g, '<br>').trim();
		flags.lineBreaksConverted = true;
	}

	return { text, flags, deliverables };
}

export type PolishWarning =
	| 'fence-stripped'
	| 'prefix-stripped'
	| 'quotes-stripped'
	| 'controls-removed'
	| 'hallucinated-deliverables-removed'
	| 'line-breaks-converted';

export type PolishRejectReason =
	| 'empty'
	| 'links-changed'
	| 'too-long'
	| 'unchanged';

export type PolishValidation =
	| { ok: true; text: string; warnings: PolishWarning[] }
	| { ok: false; text: string; reasons: PolishRejectReason[] };

const DEFAULT_MAX_CHARS = 500;

function collectLinks(text: string): Set<string> {
	const links = new Set<string>();
	for (const match of text.matchAll(/@?\[\[([^\]]+)\]\]/g)) {
		const target = (match[1] ?? '').trim();
		if (target) links.add(target);
	}
	return links;
}

function sameLinkSet(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) return false;
	for (const item of a) {
		if (!b.has(item)) return false;
	}
	return true;
}

/** 500 字口径只算正文：扣掉 `@[[…]]` 交付物 token。 */
function effectiveLength(text: string): number {
	let length = [...text].length;
	for (const match of text.matchAll(/@\[\[[^\]]+\]\]/g)) {
		length -= [...(match[0] ?? '')].length;
	}
	return length;
}

function warningsFromFlags(flags?: PolishSanitizeFlags): PolishWarning[] {
	if (!flags) return [];
	const warnings: PolishWarning[] = [];
	if (flags.fenceStripped) warnings.push('fence-stripped');
	if (flags.prefixStripped) warnings.push('prefix-stripped');
	if (flags.quotesStripped) warnings.push('quotes-stripped');
	if (flags.controlsRemoved) warnings.push('controls-removed');
	if (flags.hallucinatedDeliverablesRemoved) {
		warnings.push('hallucinated-deliverables-removed');
	}
	if (flags.lineBreaksConverted) warnings.push('line-breaks-converted');
	return warnings;
}

export function validatePolishedText(input: {
	originalBody: string;
	cleaned: string;
	maxChars?: number;
	flags?: PolishSanitizeFlags;
}): PolishValidation {
	const { originalBody, cleaned } = input;
	const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
	const warnings = warningsFromFlags(input.flags);

	if (cleaned.trim() === '') {
		return { ok: false, text: cleaned, reasons: ['empty'] };
	}

	if (!sameLinkSet(collectLinks(originalBody), collectLinks(cleaned))) {
		return { ok: false, text: cleaned, reasons: ['links-changed'] };
	}

	if (effectiveLength(cleaned) > maxChars) {
		return { ok: false, text: cleaned, reasons: ['too-long'] };
	}

	if (cleaned === originalBody) {
		return { ok: false, text: cleaned, reasons: ['unchanged'] };
	}

	return { ok: true, text: cleaned, warnings };
}