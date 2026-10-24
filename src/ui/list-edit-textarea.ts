/**
 * 模板编辑器 textarea 的列表编辑绑定（[[Plan-20261025-061424]] §3.2）。
 *
 * 唯一写入口：整段覆盖 + `execCommand('insertText')`，一次编辑 = 一步撤销，
 * 且 `onChange`（由 `input` 事件驱动）与屏幕内容天然同步。
 * 行为计算全在 `tasks-center/list-edit-ops.ts`，本文件只管 DOM。
 */

import {
	applyListEnter,
	dedentListItemLines,
	indentListItemLines,
	type ListMarker,
	type TextEdit,
} from '../tasks-center/list-edit-ops';

/** 给内容 textarea 接管 Enter / Tab / Shift+Tab。项目范围等字段不要调用。 */
export function bindListMarkdownEditing(
	textArea: HTMLTextAreaElement,
	marker: ListMarker,
): void {
	textArea.addEventListener('keydown', (ev: KeyboardEvent) => {
		// 中文输入法上屏中：Enter 是选词，绝不拦截
		// eslint-disable-next-line @typescript-eslint/no-deprecated -- keyCode 229 是旧 IME 上屏的既有判据，无替代
		if (ev.isComposing || ev.keyCode === 229) {
			return;
		}

		if (
			ev.key === 'Enter' &&
			!ev.shiftKey &&
			!ev.altKey &&
			!ev.metaKey &&
			!ev.ctrlKey
		) {
			const next = applyListEnter(
				textArea.value,
				textArea.selectionStart,
				textArea.selectionEnd,
				marker,
			);
			if (!next) {
				return;
			}
			ev.preventDefault();
			applyTextareaEdit(textArea, next);
			return;
		}

		if (ev.key === 'Tab' && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
			// 必须拦：否则焦点被移出弹窗（纯键盘走不到按钮，属已知取舍）
			ev.preventDefault();
			const next = ev.shiftKey
				? dedentListItemLines(
						textArea.value,
						textArea.selectionStart,
						textArea.selectionEnd,
					)
				: indentListItemLines(
						textArea.value,
						textArea.selectionStart,
						textArea.selectionEnd,
					);
			if (next.text === textArea.value) {
				return; // 0 级再反缩进：不写、不污染撤销栈
			}
			applyTextareaEdit(textArea, next);
		}
	});
}

function applyTextareaEdit(
	textArea: HTMLTextAreaElement,
	next: TextEdit,
): void {
	const scrollTop = textArea.scrollTop;
	textArea.focus();
	textArea.setSelectionRange(0, textArea.value.length);
	let applied = false;
	try {
		// 只有 execCommand 能「一次覆盖 + 保留撤销栈」，无等价现代 API
		// eslint-disable-next-line @typescript-eslint/no-deprecated
		applied = activeDocument.execCommand('insertText', false, next.text);
	} catch {
		applied = false;
	}
	if (!applied || textArea.value !== next.text) {
		// 兜底：内容正确优先（这条路径会断撤销栈），必须手动同步 onChange
		textArea.value = next.text;
		textArea.dispatchEvent(new Event('input', { bubbles: true }));
	}
	textArea.setSelectionRange(next.start, next.end);
	if (caretVisibleIn(textArea, scrollTop)) {
		textArea.scrollTop = scrollTop;
	}
}

/** 光标是否仍落在编辑前的可视区内（估算失败则交给浏览器自动滚动）。 */
function caretVisibleIn(
	textArea: HTMLTextAreaElement,
	scrollTop: number,
): boolean {
	const lineHeight = Number.parseFloat(
		window.getComputedStyle(textArea).lineHeight,
	);
	if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
		return false;
	}
	const caretLine = textArea.value
		.slice(0, textArea.selectionStart)
		.split('\n').length - 1;
	const caretTop = caretLine * lineHeight;
	return (
		caretTop >= scrollTop &&
		caretTop + lineHeight <= scrollTop + textArea.clientHeight
	);
}
