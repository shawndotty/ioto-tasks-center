/**
 * 外链条目的「只读嵌页」（[[Plan-20261102-144054]] §4.2）。
 *
 * 为什么是自建 `<webview>`：iframe 吃 `X-Frame-Options`（被拒与成功在 DOM 上不可区分），
 * 复用 Web viewer 视图会把 leaf 的生命周期搬进弹窗 ⇒ 只剩「自己托管一个 guest」
 * （[[Research-20261102-143206]] §三 / §四）。
 *
 * 🔴 本模块只 import type：不 import obsidian 运行时、不 import `lang/`。
 *    文案、卡片、按钮全在调用方（ui/），这里只碰 DOM 与 electron。
 */

import type { App } from 'obsidian';

/** Electron `<webview>`：只声明用到的那几项（`@types/electron` 不在依赖里）。 */
interface WebviewElement extends HTMLElement {
	partition: string;
	getWebContentsId(): number;
	executeJavaScript(code: string): Promise<unknown>;
}

/** 主进程侧 webContents：同样只声明用到的那几项（`remote` 不在公共 d.ts）。 */
interface GuestContents {
	noContextMenu: boolean;
	isDestroyed(): boolean;
	setIgnoreMenuShortcuts(ignore: boolean): void;
	on(event: string, listener: (event: unknown, input: ElectronInput) => void): void;
	removeListener(
		event: string,
		listener: (event: unknown, input: ElectronInput) => void,
	): void;
}

/** 核心桥接里读到的 `before-input-event` 入参（Electron Input 的用到的字段）。 */
interface ElectronInput {
	type: string;
	code: string;
	key: string;
	shift: boolean;
	alt: boolean;
	control: boolean;
	meta: boolean;
	isAutoRepeat: boolean;
}

/** App 上不在公共 d.ts 的两项：分区方法（1.8+）与全局 keymap。 */
interface AppInternals {
	getWebviewPartition?: () => string;
	keymap?: { onKeyEvent: (event: KeyboardEvent) => boolean };
}

export interface WebPreviewOptions {
	/** 主文档加载失败（已排除 `-3` = 用户主动中止）。宿主负责画兜底卡片。 */
	onFail: (description: string) => void;
}

export interface WebPreviewHandle {
	/** 幂等：摘元素（guest 随之销毁）+ 解绑键盘监听。 */
	destroy(): void;
}

/**
 * 这台设备能不能嵌页。三条**全都**要满足：
 * 1. 宿主 document 的 window 注册了 `webview` 自定义元素 —— 这一条正好也是
 *    `webviewTag: false` 的判据（未开启时元素根本没被 define，`customElements.get`
 *    返回 undefined）；
 * 2. App 上有 `getWebviewPartition`（手机端没有这个内部插件体系）；
 * 3. `require('electron')` 可用（手机端没有 require）。
 *
 * 🔴 不要用 `internalPlugins.getEnabledPluginById('webviewer')`：那是「能不能开标签」
 *    的门禁，与「能不能嵌」无关（research §六.7 实测：Web viewer 关着也照样能嵌）。
 * 🔴 传 `doc` 而不是用全局 `document`：弹窗可能开在弹出窗口里，注册表是**按 window**
 *    的（核心自己也是 `containerEl.doc.createElement('webview')`）。
 */
export function canEmbedWeb(app: App, doc: Document): boolean {
	if (!doc.defaultView?.customElements.get('webview')) {
		return false;
	}
	if (typeof (app as unknown as AppInternals).getWebviewPartition !== 'function') {
		return false;
	}
	return getElectron() !== null;
}

/**
 * 把一个 guest 挂进宿主并返回句柄。
 *
 * 生命周期只有一条规则：**元素离开 DOM = guest 被销毁**（research §3 P5 实测：
 * `isConnected === false` 之后 `webContents.getAllWebContents()` 里就没了）。
 * 所以这里不做任何「复用 / 保活」，每次换页都是新实例。
 */
export function mountWebPreview(
	app: App,
	parentEl: HTMLElement,
	url: string,
	options: WebPreviewOptions,
): WebPreviewHandle {
	// 用**宿主自己的 document**：弹窗可能在弹出窗口里，注册表与 listener 都按 window 走。
	const doc = parentEl.ownerDocument;
	const el = doc.createElement('webview') as WebviewElement;
	el.className = 'ioto-tasks-center__task-links-web';
	// 底色走 CSS（`.ioto-tasks-center__task-links-web { background:#fff }`），不写内联：
	// 一是效果等价（元素一进 DOM 就有底色，白色网页的首帧不会闪主题色），
	// 二是本仓 lint 的 `no-static-styles-assignment` 会把 `style.x = '字面量'` 判为 error。
	// 空串会把 webview 丢进默认分区（不随库隔离），所以只在拿得到时赋值。
	const partition = (app as unknown as AppInternals).getWebviewPartition?.();
	if (partition) {
		el.partition = partition;
	}
	el.setAttribute('src', url);

	let guest: GuestContents | null = null;
	let destroyed = false;

	function onKey(_event: unknown, input: ElectronInput): void {
		// 🔴 销毁判据不是保险而是必须：回调会在 guest 死后再被调用一次，
		// 那时 `setIgnoreMenuShortcuts` 抛 `Object has been destroyed`（research §3 P5）。
		if (destroyed || !guest || guest.isDestroyed() || input.type !== 'keyDown') {
			return;
		}

		const keymap = (app as unknown as AppInternals).keymap;
		if (!keymap) {
			return;
		}

		const handled = keymap.onKeyEvent(
			new KeyboardEvent('keydown', {
				code: input.code,
				key: input.key,
				shiftKey: input.shift,
				altKey: input.alt,
				ctrlKey: input.control,
				metaKey: input.meta,
				repeat: input.isAutoRepeat,
			}),
		);

		// 🔴 第二道判据，核心没有（核心从不销毁自己的 webview）：
		// Esc 会在 `onKeyEvent` 里**同步**走到「收起预览 → 摘元素 → guest 销毁」，
		// 回来时 guest 已经是死的，直接 set 会抛错。
		// `!guest` 与 `destroyed` 缺一不可：`destroy()` 会先把 guest 置 null 再置位
		// destroyed，只判 `isDestroyed()` 会读到 null（实机 14:58 抓到）。
		if (destroyed || !guest || guest.isDestroyed()) {
			return;
		}

		// false = 没被 Obsidian 接走 → 按键继续下发给网页，不吞打字。
		guest.setIgnoreMenuShortcuts(Boolean(handled));
	}

	function onDomReady(): void {
		// 站内跳转会再触发一次 dom-ready：监听只挂一次，否则一个键处理两遍。
		if (destroyed || guest) {
			return;
		}

		try {
			const remote = getElectron()?.remote;
			if (!remote) {
				return;
			}
			guest = remote.webContents.fromId(el.getWebContentsId());
			guest.noContextMenu = true; // 不设会弹 Chromium 的默认右键菜单
			guest.on('before-input-event', onKey);
		} catch (error) {
			console.error('[IOTO Task Center] 网页预览键盘桥接失败', error);
		}
	}

	function onFinishLoad(): void {
		if (destroyed) {
			return;
		}
		// 不设 `allowpopups` ⇒ `target=_blank` 点了什么都不发生（搜索结果里最容易遇到）。
		// 抹掉它，让链接在本 frame 内跳（核心同款，research §六.5）。
		void el
			.executeJavaScript(
				'document.querySelectorAll(\'[target="_blank"]\').forEach((el) => el.removeAttribute("target"))',
			)
			.catch(() => {
				/* 页面已卸载 / guest 已销毁：这里失败没有可补救的东西 */
			});
	}

	function onFail(event: Event): void {
		const detail = event as unknown as {
			errorCode: number;
			errorDescription: string;
			isMainFrame: boolean;
		};
		// -3 = ERR_ABORTED：关窗 / 换页时的正常中止，不是失败（核心同口径）。
		if (destroyed || detail.errorCode === -3 || !detail.isMainFrame) {
			return;
		}
		const description = detail.errorDescription || `ERR_${detail.errorCode}`;
		destroy();
		options.onFail(description);
	}

	function destroy(): void {
		if (destroyed) {
			return;
		}
		destroyed = true;
		try {
			guest?.removeListener('before-input-event', onKey);
		} catch {
			/* guest 已死时 removeListener 也会抛，忽略即可 */
		}
		guest = null;
		el.removeEventListener('dom-ready', onDomReady);
		el.removeEventListener('did-finish-load', onFinishLoad);
		el.removeEventListener('did-fail-load', onFail);
		el.remove(); // 元素一离开 DOM，guest 就被销毁并回收
	}

	el.addEventListener('dom-ready', onDomReady);
	el.addEventListener('did-finish-load', onFinishLoad);
	el.addEventListener('did-fail-load', onFail);
	parentEl.appendChild(el);

	return { destroy };
}

/** `require('electron')` 里用到的那一小块（`remote` 不在公共 d.ts）。 */
interface ElectronLike {
	remote: { webContents: { fromId: (id: number) => GuestContents } };
}

/** `require('electron')`：渲染进程可用（nodeIntegration），手机端会抛 → 返回 null。 */
function getElectron(): ElectronLike | null {
	try {
		/* eslint-disable no-undef, @typescript-eslint/no-require-imports */
		return require('electron') as ElectronLike;
		/* eslint-enable no-undef, @typescript-eslint/no-require-imports */
	} catch {
		return null;
	}
}
