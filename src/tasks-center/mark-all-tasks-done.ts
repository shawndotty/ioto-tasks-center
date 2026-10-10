/**
 * 「把当前文件所有任务标记为完成」的 Markdown 侧适配器（[[Plan-20261010-142226]] §二.6）。
 *
 * 活编辑器**不能**用 `vault.process`（会与未落盘缓冲区抢写）；走**单事务**回写，
 * 保住撤销栈与光标：`Cmd/Ctrl+Z` 一步还原，光标不在改动行时位置不变。
 */

import { Notice, type Editor } from 'obsidian';

import { t } from '../lang/helpter';
import { markAllChecklistItemsDone } from './note-structure';

/** Markdown 侧命令实现：单事务回写（一次 undo），不整篇 `setValue`。 */
export function markAllTasksDoneInMarkdown(editor: Editor): void {
	const { changedLines } = markAllChecklistItemsDone(editor.getValue());
	if (changedLines.length === 0) {
		new Notice(t('notice.markAllTasksDone.none'));
		return;
	}
	editor.transaction({
		changes: changedLines.map(({ line, text }) => ({
			from: { line, ch: 0 },
			to: { line, ch: editor.getLine(line).length },
			text,
		})),
	});
	new Notice(t('notice.markAllTasksDone.done', [String(changedLines.length)]));
}
