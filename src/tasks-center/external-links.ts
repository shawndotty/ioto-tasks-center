/**
 * 外部链接解析（[[Plan-20261102-113642]] §4.2）。
 *
 * 🔴 本模块不 import obsidian，也不 import `lang/`：「第二行写什么」由 views 层拼，
 *    这里只产出与语言无关的事实，保证 `node --test` 能直接跑。
 *
 * 为什么不走 metadataCache：实测它**完全不收录外链**（http / file / 远程图片都进不了
 * `links` / `embeds`），只能自己扫正文（[[Research-20261102-103251]] §2.2）。
 */

import { stripFrontmatter } from './markdown-body';

export type ExternalLinkScheme = 'http' | 'https' | 'file';

export interface ParsedExternalLink {
	/** 归一化后的绝对 URL；**去重键就是这个字段**。 */
	url: string;
	/** 链接文字（`[文字](…)` / `<a>…</a>`）；没有就是空串。 */
	label: string;
	scheme: ExternalLinkScheme;
}

export interface ParseExternalLinksOptions {
	/** 行内代码里的 URL 收不收，默认收（§1.1 D2）。 */
	includeInlineCode?: boolean;
}

/** 围栏块起止行：连续三个反引号，或连续三个波浪号（多于此数也算）。 */
const FENCE_PATTERN = /^[ \t]*(`{3,}|~{3,})/;
/** URL 末尾的 ASCII 标点（`*` 用来削掉加粗包裹的尾巴）。 */
const ASCII_TAIL_PATTERN = /[.,;:!?'"*]+$/;
/** URL 末尾的中文标点：只削「句尾」这类，不会伤到中文路径段。 */
const CJK_TAIL_PATTERN = /[。，、；：！？）》」』】…]+$/;
/** 行内代码里取第一个 URL（反引号里可能是整段命令）。 */
const URL_IN_TEXT_PATTERN = /(?:https?|file):\/\/[^\s<>"'\][]+/i;

/**
 * 一条扫描式正则，**分支顺序即优先级**（长匹配先吃，短匹配才轮得到）：
 * 1. markdown 链接 / 图片（URL 内允许一层平衡括号，`Foo_(bar)` 不被截断）
 * 2. 自动链接 `<https://…>`
 * 3. 原始 HTML `<a href="…">文字</a>`
 * 4. 行内代码 `` `https://…` ``
 * 5. 裸链接
 */
const TOKEN_PATTERN = new RegExp(
	[
		String.raw`!?\[([^\]]*)\]\(\s*<?((?:https?|file):(?:[^()\s<>]|\([^()\s]*\))*)>?(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)`,
		String.raw`<((?:https?|file):\/\/[^>\s]*)>`,
		String.raw`<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>`,
	'`([^`\\n]+)`',
	`((?:https?|file):\\/\\/[^\\s<>"'\\][]+)`,
	].join('|'),
	'gi',
);

/** 剥掉围栏代码块（脚本 / 日志里的 URL 不是链接）；未闭合的围栏吃到文末。 */
function stripFencedBlocks(raw: string): string {
	const lines: string[] = [];
	let fence: string | null = null;
	for (const line of raw.split('\n')) {
		const marker = FENCE_PATTERN.exec(line);
		if (fence) {
			if (marker && line.trim().startsWith(fence)) {
				fence = null;
			}
			continue;
		}
		if (marker) {
			// 取围栏字符（反引号 / 波浪号）做闭合判据：`{3,}` 开头的多字符围栏
			// 也按三个闭合，与 Markdown 实现一致。
			fence = (marker[1]?.[0] ?? '`').repeat(3);
			continue;
		}
		lines.push(line);
	}
	return lines.join('\n');
}

/** 削掉 URL 尾部的标点；右括号只在**不配平**时削（`Foo_(bar)` 要保留）。 */
function trimUrlTail(url: string): string {
	let out = url;
	for (;;) {
		const before = out;
		out = out.replace(ASCII_TAIL_PATTERN, '').replace(CJK_TAIL_PATTERN, '');
		if (out.endsWith(')')) {
			const opens = (out.match(/\(/g) ?? []).length;
			const closes = (out.match(/\)/g) ?? []).length;
			if (opens < closes) {
				out = out.slice(0, -1);
			}
		}
		if (out === before) {
			return out;
		}
	}
}

/**
 * `file:` 之后统一正斜杠（`file:///D:\Downloads\a.pdf` → `file:///D:/Downloads/a.pdf`）。
 * Chromium 能兜住反斜杠，但下游两条路（库内映射 / `toExternalOpenUrl`）不该各自再修一遍。
 */
export function normalizeFileUrl(url: string): string {
	if (!/^file:/i.test(url)) {
		return url;
	}
	return `file:${url.slice('file:'.length).replace(/\\/g, '/')}`;
}

/** `file:` 协议判据；解析层已归一化为 `file:///…` / `file:////…`，这里只需识别 scheme。 */
export function isLocalFileUrl(url: string): boolean {
	return /^file:/i.test(url);
}

/**
 * 解析正文里的外部链接：按**出现顺序**返回，同 URL 只留第一处（label 取第一次的）。
 *
 * 不排序：笔记里的先后本身有叙事价值，与其它分类的「按标题排序」刻意不同
 * （§4.3 第 3 条），避免以后有人「顺手统一」。
 */
export function parseExternalLinks(
	raw: string,
	options: ParseExternalLinksOptions = {},
): ParsedExternalLink[] {
	const includeInlineCode = options.includeInlineCode !== false;
	const text = stripFencedBlocks(stripFrontmatter(raw));
	const links: ParsedExternalLink[] = [];
	const seen = new Set<string>();
	TOKEN_PATTERN.lastIndex = 0;

	let match: RegExpExecArray | null = TOKEN_PATTERN.exec(text);
	while (match !== null) {
		const [, mdLabel, mdUrl, autoUrl, htmlHref, htmlText, code, bare] = match;
		let url = mdUrl ?? autoUrl ?? htmlHref ?? '';
		let label = mdLabel ?? '';

		if (!url && code !== undefined) {
			if (!includeInlineCode) {
				match = TOKEN_PATTERN.exec(text);
				continue;
			}
			// 反引号里可能是整段命令，取第一个 URL 即可。
			url = URL_IN_TEXT_PATTERN.exec(code)?.[0] ?? '';
		}
		if (url && htmlText !== undefined) {
			// HTML 锚点的文字：去掉内层标签后才是 label。
			label = htmlText.replace(/<[^>]*>/g, '').trim();
		}
		if (!url) {
			url = bare ?? '';
		}

		const cleaned = trimUrlTail(url);
		// 先去重键归一化（`file:///D:\a.pdf` 与 `file:///D:/a.pdf` 是同一条），
		// 顺带让「拿去 Web viewer 的 URL」在这里就已经是规范形。
		const normalizedUrl = normalizeFileUrl(cleaned);
		if (
			/^(?:https?|file):\/\//i.test(normalizedUrl) &&
			!seen.has(normalizedUrl)
		) {
			seen.add(normalizedUrl);
			links.push({
				url: normalizedUrl,
				label: label.trim(),
				scheme: (/^(https?|file):/i.exec(normalizedUrl)?.[1] ?? '')
					.toLowerCase() as ExternalLinkScheme,
			});
		}

		match = TOKEN_PATTERN.exec(text);
	}

	return links;
}

/**
 * `file://` → **vault 相对路径**（命中才返回，否则 `null`）。纯字符串比较，
 * 只做「是不是这个库里的文件」的前缀判定，**不查库**（查库是 views 层的活）。
 *
 * - 相对形态 `file://../x` 语义上不合法 → 丢弃（宁缺毋滥）；
 * - 大小写不敏感（macOS / Windows），但 `/Vault2` 不算 `/Vault`（必须吃到分隔符）；
 * - 解码失败（畸形 `%` 序列）→ `null`，当库外处理。
 */
export function fileUrlToVaultPath(
	fileUrl: string,
	vaultBasePath: string,
): string | null {
	const normalized = normalizeFileUrl(fileUrl);
	if (!/^file:\/\//i.test(normalized)) {
		return null;
	}

	let decoded: string;
	try {
		// `file:///Users/a.md` → `/Users/a.md`；`file://../a.md` → `../a.md`（下面拒掉）
		decoded = decodeURIComponent(normalized.slice('file://'.length));
	} catch {
		return null;
	}
	if (!decoded.startsWith('/')) {
		return null;
	}
	if (/^\/[a-zA-Z]:\//.test(decoded)) {
		decoded = decoded.slice(1); // Windows 盘符形 `file:///C:/…` → `C:/…`
	}

	const base = vaultBasePath.replace(/\\/g, '/').replace(/\/+$/, '');
	if (!base) {
		return null;
	}
	if (!decoded.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
		return null;
	}

	return decoded.slice(base.length + 1) || null;
}

/** http(s) 的域名（含端口）；取不到返回空串。 */
export function getExternalHost(url: string): string {
	return /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? '';
}

/** `file://` 的文件名（已解码）；取不到返回空串。 */
export function getExternalFileName(url: string): string {
	const path = normalizeFileUrl(url)
		.replace(/^file:\/\//i, '')
		.replace(/[?#].*$/, '');
	const segment = path.slice(path.lastIndexOf('/') + 1);
	if (!segment) {
		return '';
	}
	try {
		return decodeURIComponent(segment);
	} catch {
		return segment;
	}
}
