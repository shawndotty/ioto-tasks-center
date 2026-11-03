/**
 * 弹窗内 md 预览补标题色（[[Plan-20261103-150245]] C1 / [[Research-20261103-145036]] §4.1）。
 *
 * 🔴 为什么必须 JS 补：核心把 `.modal-container` append 到 `body`，它与 `.app-container`
 *    是**兄弟**；主题（AnuPpuccin）把 `--h1..h6-color` 只赋在 `.app-container` 上，
 *    自定义属性只沿祖先链继承 → 弹窗里六个变量全空 → 核心 `color: var(--hN-color)`
 *    在计算值阶段失效 → 标题退回继承色（= 正文色）。
 * 🔴 本模块不 import obsidian：取值是纯函数，单测直接跑（同 external-link-url 的分层）。
 */

export const HEADING_COLOR_VARS = [
	'--h1-color',
	'--h2-color',
	'--h3-color',
	'--h4-color',
	'--h5-color',
	'--h6-color',
] as const;

/** 只依赖 `getPropertyValue`，单测可传假对象，不必造 `CSSStyleDeclaration`。 */
export type CssPropertyReader = Pick<CSSStyleDeclaration, 'getPropertyValue'>;

/** 读「已解析」的标题色；取不到写空串（= 之后移除内联，回到继承）。 */
export function readHeadingColorVars(scope: CssPropertyReader): Record<string, string> {
	const out: Record<string, string> = {};
	for (const name of HEADING_COLOR_VARS) {
		out[name] = scope.getPropertyValue(name).trim();
	}
	return out;
}

/** 把主题作用域里的标题色复制到 `target`（预览体），后代（含 `![[笔记]]` 内嵌）一并继承。 */
export function syncHeadingColorVars(target: HTMLElement): void {
	const doc = target.ownerDocument;
	// 弹窗与 `.app-container` 是兄弟；用同一个 document 保证弹出窗口（popout）也对。
	const scope = doc.querySelector<HTMLElement>('.app-container') ?? doc.body;
	const view = doc.defaultView;
	if (!view || !scope) {
		return;
	}
	target.setCssProps(readHeadingColorVars(view.getComputedStyle(scope)));
}
