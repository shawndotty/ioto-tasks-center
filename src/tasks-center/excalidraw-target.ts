/**
 * 「这个文件是不是被 Excalidraw 接管的绘图」（[[Research-20261031-071052]] §七·F1）。
 *
 * 只收裸数据、不 import `obsidian`：判定是纯函数，单测才能直接跑；
 * vault / metadataCache 的查表留在调用方（`task-links-modal.ts`）。
 */

/** Excalidraw 注册的插件 id，写死是刻意的：这是契约，不是配置。 */
export const EXCALIDRAW_PLUGIN_ID = 'obsidian-excalidraw-plugin';

/** 与 Excalidraw 的 `isExcalidrawFile` 同口径：frontmatter 标记。 */
export function isExcalidrawFrontmatter(
	frontmatter: Record<string, unknown> | undefined,
): boolean {
	return Boolean(frontmatter?.['excalidraw-plugin']);
}

/**
 * 扩展名或 frontmatter，二者其一即算。
 * 不能用「文件名含 `.excalidraw`」当判据：Excalidraw 允许关掉 useExcalidrawExtension，
 * 那种文件名就是 `xxx.md`，只有 frontmatter 认得出（研究 §七·F1）。
 */
export function isExcalidrawFile(input: {
	extension: string;
	frontmatter?: Record<string, unknown>;
}): boolean {
	if (input.extension.toLowerCase() === 'excalidraw') {
		return true;
	}
	return isExcalidrawFrontmatter(input.frontmatter);
}
