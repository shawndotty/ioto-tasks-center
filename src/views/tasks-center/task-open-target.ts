import type { TaskOpenTarget } from './constants';

/**
 * 任务行点击的修饰键 → 打开目标。
 *
 * 判据顺序关键：组合键（Alt + Cmd/Ctrl）必须先于单 Alt 判断，
 * 否则组合键会被单 Alt 分支提前吞掉。
 */
export function resolveTaskOpenTargetFromMouse(mods: {
	altKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
}): TaskOpenTarget {
	if (mods.altKey && (mods.metaKey || mods.ctrlKey)) {
		return 'right-split-tab';
	}
	if (mods.altKey) {
		return 'current-pane-tab';
	}
	return 'adjacent-preview';
}
