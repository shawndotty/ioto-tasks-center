import { Platform } from 'obsidian';

/**
 * macOS 系统红黄绿窗口按钮的藏/还（[[Plan-20261102-184451]] §C1）。
 *
 * 供两处调用：相关链接窗口满幅时藏按钮（`task-links-modal.ts`），
 * 与插件卸载兜底还原（`main.ts` 的 `onunload`）。
 */

/** `remote.getCurrentWindow()` 里用到的那一小块（不在公共 d.ts）。 */
interface BrowserWindowLike {
	setWindowButtonVisibility?: (visible: boolean) => void;
}

interface ElectronLike {
	remote: { getCurrentWindow: () => BrowserWindowLike };
}

/** 每个 renderer 进程一份 = 每个窗口一份；幂等位。 */
let hidden = false;

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

/**
 * 藏系统窗口按钮。返回是否真的藏上了（API 缺失/异常 → false，
 * 调用方据此决定挂不挂 `is-frame-buttons-hidden` 类）。
 */
export function hideMacWindowButtons(): boolean {
	if (!Platform.isMacOS) {
		return false;
	}
	if (hidden) {
		return true;
	}
	try {
		const win = getElectron()?.remote.getCurrentWindow();
		if (typeof win?.setWindowButtonVisibility !== 'function') {
			return false;
		}
		win.setWindowButtonVisibility(false);
		hidden = true;
		return true;
	} catch {
		return false;
	}
}

/** 恢复系统窗口按钮。幂等，多调无害；未藏过时是 no-op。 */
export function restoreMacWindowButtons(): void {
	if (!hidden) {
		return;
	}
	try {
		getElectron()
			?.remote.getCurrentWindow()
			.setWindowButtonVisibility?.(true);
	} catch {
		/* 窗口已销毁等异常：没有可补救的东西 */
	}
	hidden = false;
}
