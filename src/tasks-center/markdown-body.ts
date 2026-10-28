/**
 * 预览用正文处理（[[Plan-20261028-190721]] §3.3）。
 *
 * 只做一件事：剥掉笔记开头 YAML frontmatter。属性块会在预览里占掉 6~10 行，
 * 与「瞄一眼正文」的目标无关；要看属性就走「查看笔记」。
 *
 * 正则与 `cursor-marker.ts:13` 同形，但不共享：那个是模板辅助，语义不同，
 * 合并会把两个模块耦合在一起（改动只在 1 行正则，重复成本可接受）。
 */
const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** 仅剥离「位于文件开头且成对闭合」的 frontmatter；正文中段的 `---` 原样保留。 */
export function stripFrontmatter(markdown: string): string {
	return markdown.replace(FRONTMATTER_PATTERN, '');
}
