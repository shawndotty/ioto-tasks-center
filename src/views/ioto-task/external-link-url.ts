/**
 * 把核心渲染出的外链 href 规范成「可交给 window.open 的 URL」。
 *
 * 背景（[[Research-20261012-190837]]）：Obsidian 主进程按 URL 的 scheme 路由——
 * 只有 file: 才会被主进程 K() 解析成本机路径并 shell.openPath；Windows 裸盘符
 * 路径 C:\… 会被 new URL() 解析成 scheme=c: 的自定义协议，弹确认框后走
 * shell.openExternal。此处把 Windows 裸路径补成合法 file:// URL，使其与 macOS
 * 的 file:///Users/… 等势；对正常 URL（http/https/file/obsidian/mailto/自定义）
 * 一律原样透传，零回归。
 *
 * - C:\… 或 C:/…（盘符绝对路径）→ file:///C:/…
 * - \\server\share\… 或 //server/share/…（UNC）→ file:////server/share/…
 *   （四斜杠：Obsidian 自写的 K() 对 UNC 的规范形；写成 file://server/… 反而被拍扁成相对路径）
 * - /abs/…（POSIX 绝对路径）→ file:///abs/…
 * - 其余（已带 scheme）→ 原样返回
 */
export function toExternalOpenUrl(raw: string): string {
	const href = raw.trim();
	if (!href) return href;
	// 盘符绝对路径：单字母 + 冒号 + 斜杠/反斜杠（本期**唯一可达**分支）
	if (/^[a-zA-Z]:[\\/]/.test(href)) return pathToFileUrl(href);
	// UNC：\\server\share 或 //server/share（Phase 2 才端到端可达，见 Plan §四）
	if (/^[\\/]{2}[^\\/]/.test(href)) return uncToFileUrl(href);
	// POSIX 绝对路径（macOS/Linux；当前通路不可达，见 Plan §四）
	if (href.startsWith('/')) return pathToFileUrl(href);
	// 已有 scheme（含 http/https/file/obsidian/mailto/自定义）→ 原样
	return href;
}

/** 统一正斜杠、去前导斜杠，交给 URL 做 % 编码（空格 / CJK） */
function pathToFileUrl(p: string): string {
	const s = p.replace(/\\/g, '/').replace(/^\/+/, '');
	return new URL('file:///' + s).href; // C:/Users/a.pdf → file:///C:/Users/a.pdf
}

/** UNC → 四斜杠形式 file:////server/share/a（Obsidian K() 的 UNC 规范形） */
function uncToFileUrl(p: string): string {
	const s = p.replace(/\\/g, '/').replace(/^\/+/, '');
	return new URL('file:////' + s).href;
}
