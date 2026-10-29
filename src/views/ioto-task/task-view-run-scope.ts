import type { TFile } from 'obsidian';

/**
 * AI 运行范围开放契约（ioto-settings）：声明「放大态只跑这一条」。
 *
 * 与 `getAITaskItemSource()`（`task-view-item-control-host.ts:84`）的区别：
 * 那条是「光标所在条目」（普通选中态也成立，服务移动端条目模式），
 * 这条只认**放大**（`zoomLine`）——放大是显式聚焦手势，选中只是导航副产品。
 * 鸭子类型实现——不 import `ioto-settings`。见 [[Research-20261029-183030]] §3.2。
 *
 * 纯函数：视图 getter 只负责把三样东西递进来，便于按本插件分层约定进 `node --test`。
 */
export function buildRunScope(
	zoomLine: number | null,
	file: TFile | null,
	lineText: string | null,
): { file: TFile; line: number; text: string } | null {
	if (zoomLine === null || zoomLine < 0) return null; // 非放大 → 不声明范围
	if (!file) return null;
	if (!lineText) return null; // 行已失效（保守：宁可整份，不跑错条）
	return { file, line: zoomLine, text: lineText };
}
