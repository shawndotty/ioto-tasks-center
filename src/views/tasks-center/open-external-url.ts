/**
 * 把外部条目真正打开（[[Plan-20261102-113642]] §4.7）。
 *
 * 顺序固定：核心 Web viewer（需其「打开外部链接」设置开启）→ `window.open` 兜底。
 * - Web viewer 优先：真正的浏览器视图（地址栏 / 前进后退 / 缩放），且**不挑 scheme**，
 *   `file:` 也能进（[[Research-20261102-103251]] §3.2 实测）。
 *   但只在该插件的 `openExternalURLs` 设置开启时可用（[[Plan-20261102-192630]] §2.1）：
 *   核心 `openUrl()` 本体不检查该设置，必须我们自己设门禁；设置关闭时核心的
 *   `handleOpenUrl` 不截走 `window.open`，天然落系统浏览器。
 * - 兜底走 `window.open` + `toExternalOpenUrl`：核心把 `file:` 交给主进程
 *   `shell.openPath`，其余交系统（[[Research-20261012-190837]]）。
 *
 * 为什么不优先 `window.open`：内部插件开着 `openExternalURLs` 时会截走外链，
 * 并且「此刻有 Modal」会开在新窗口而不是标签页；我们虽然已经 `close()`，
 * 但没必要赌那个时序（§3.2 / R7）。设置关闭时无截走路径，兜底直达系统浏览器。
 */

import type { App } from 'obsidian';

import { toExternalOpenUrl } from '../ioto-task/external-link-url';

/** Web viewer 不是公共 API（`app.internalPlugins` 不在 d.ts），只声明用到的那一小块。 */
interface WebViewerPlugin {
	openUrl: (url: string, leafType?: string, active?: boolean) => void;
	/** 核心在 onEnable 时 Object.assign(默认值, loadData()) 赋上的设置对象（不在 d.ts）。 */
	options?: { openExternalURLs?: boolean };
}

/** 无实例或设置显式 false 都视为「不可用」；设置缺失/undefined/true 一律视为开启（核心默认 true，[[Plan-20261102-192630]] §2.1）。 */
export function isWebViewerOpenAllowed(
	viewer: { options?: { openExternalURLs?: boolean } } | null,
): boolean {
	if (!viewer) {
		return false;
	}
	return viewer.options?.openExternalURLs !== false;
}

export function openExternalUrl(app: App, url: string): void {
	const viewer = getWebViewer(app);
	if (viewer) {
		try {
			// 传原始 URL：解析阶段已把反斜杠归一化，`loadURL` 自己会做百分号编码（R4）。
			viewer.openUrl(url, 'tab', true);
			return;
		} catch (error) {
			console.error(
				'[IOTO Task Center] Web viewer 打开失败，退化到系统浏览器',
				error,
			);
		}
	}

	window.open(toExternalOpenUrl(url));
}

/**
 * 判据两条：拿得到实例且 `openUrl` 是函数；其「打开外部链接」设置未显式关闭。
 * 手机端没有这个内部插件 → 自动落兜底。
 */
function getWebViewer(app: App): WebViewerPlugin | null {
	const internalPlugins = (
		app as unknown as {
			internalPlugins?: {
				getEnabledPluginById?: (id: string) => unknown;
			};
		}
	).internalPlugins;
	const viewer = internalPlugins?.getEnabledPluginById?.('webviewer');
	if (!viewer || typeof (viewer as WebViewerPlugin).openUrl !== 'function') {
		return null;
	}
	if (!isWebViewerOpenAllowed(viewer as WebViewerPlugin)) {
		return null;
	}
	return viewer as WebViewerPlugin;
}
