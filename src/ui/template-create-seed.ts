/**
 * 新建模板时的正文预填（[[Plan-20261025-080904]] §3.1）。
 *
 * 批量模板弹窗与条目模板弹窗共用：纯函数部分零 DOM、零 obsidian 运行期依赖，
 * 供 `tests/template-create-seed.test.mjs` 用 jiti 直测；DOM 工具只管聚焦与光标。
 */

import type { ListMarker } from '../tasks-center/list-edit-ops';
import type { TemplateEditMode } from './entryTemplateEditModal';

/**
 * 只有「新建 + 正文全空白」才返回标记；编辑 / 复制一律返回 `null`，
 * 已有内容绝不被覆盖或追加。
 */
export function resolveCreateSeedContent(
	mode: TemplateEditMode,
	content: string,
	marker: ListMarker,
): string | null {
	if (mode !== 'create') {
		return null;
	}
	if (content.trim().length > 0) {
		return null;
	}
	return marker;
}

/**
 * 把光标放到正文末尾。`Modal.onOpen` 执行时 `inputEl` 可能还没进文档
 * （Obsidian 在 `onOpen` 之后才把弹窗挂上去），所以延到下一个任务再聚焦；
 * 期间弹窗被关掉就靠 `isConnected` 兜底，不报错、不抢焦点。
 */
export function focusTextAreaAtEnd(
	inputEl: HTMLTextAreaElement,
	caret: number,
): void {
	window.setTimeout(() => {
		if (!inputEl.isConnected) {
			return;
		}
		inputEl.focus();
		inputEl.setSelectionRange(caret, caret);
	}, 0);
}
