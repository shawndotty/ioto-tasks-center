/**
 * 任务描述润色的输出清洗与校验（Plan-20261125-210407 §4.3）。
 *
 * 纯函数、UI-free。清洗顺序本身是正确性的一部分：先剥模型包装，再清控制语法 /
 * 幻觉交付物，最后把物理换行折成 `<br>`（保证写回仍是单物理行）。
 */

export interface PolishSanitizeFlags {
	fenceStripped: boolean;
	prefixStripped: boolean;
	quotesStripped: boolean;
	controlsRemoved: boolean;
	hallucinatedDeliverablesRemoved: boolean;
	lineBreaksConverted: boolean;
}

export interface PolishText {
	text: string;
	flags: PolishSanitizeFlags;
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

const HALLUCINATED_DELIVERABLE_PATTERN = /\s*@\[\[[^\]]+\]\]/g;

export function sanitizePolishedText(raw: string): PolishText {
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

	const beforeDeliverables = text;
	text = text.replace(HALLUCINATED_DELIVERABLE_PATTERN, '');
	if (text !== beforeDeliverables) {
		flags.hallucinatedDeliverablesRemoved = true;
	}

	// 控制语法删除后常留下连续空白：压成单空格（不动换行，交给下一步转换）。
	text = text.replace(/[ \t]{2,}/g, ' ').trim();

	if (text.includes('\n')) {
		text = text.replace(/[ \t]*\n+[ \t]*/g, '<br>').trim();
		flags.lineBreaksConverted = true;
	}

	return { text, flags };
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
	originalProse: string;
	cleaned: string;
	maxChars?: number;
	flags?: PolishSanitizeFlags;
}): PolishValidation {
	const { originalProse, cleaned } = input;
	const maxChars = input.maxChars ?? DEFAULT_MAX_CHARS;
	const warnings = warningsFromFlags(input.flags);

	if (cleaned.trim() === '') {
		return { ok: false, text: cleaned, reasons: ['empty'] };
	}

	if (
		!sameLinkSet(collectLinks(originalProse), collectLinks(cleaned))
	) {
		return { ok: false, text: cleaned, reasons: ['links-changed'] };
	}

	if ([...cleaned].length > maxChars) {
		return { ok: false, text: cleaned, reasons: ['too-long'] };
	}

	if (cleaned === originalProse) {
		return { ok: false, text: cleaned, reasons: ['unchanged'] };
	}

	return { ok: true, text: cleaned, warnings };
}