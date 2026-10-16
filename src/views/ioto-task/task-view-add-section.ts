/**
 * Task View 底部「新增 Section」：文末原子追加一个与现有顶层 Section 同级的
 * 标题块（默认标题），重绘后立即进入该节整块编辑态，用户可直接改名。
 *
 * 链路与 `markAllTasksDone` 同构：守卫（落盘在册编辑）→ `vault.process`
 * （回调内按最新 content 重算）→ `applyOutcome` 同步 data → 整树重建 →
 * `beginSectionEdit`。纯结构计算在 `appendSectionHeading`（domain 层，可单测）。
 */

import { t } from '../../lang/helpter';
import { appendSectionHeading } from '../../tasks-center/note-structure';
import type { TaskViewHost } from './task-view-host';

export async function addSection(view: TaskViewHost): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) {
		return; // 只读降级：静默（同 addTask 口径）
	}

	// 先落盘在册编辑器（卡片 / 续写 / Section），避免与追加写入双写错位。
	await view.flushInlineEdits();

	// 回调内按**最新 content** 重算（并发外部写入自洽，同 markAllTasksDone）。
	// 用两个带初值的变量承接结果：直接 `let result = null` 会被 CFA 在回调外
	// 窄成 `never`（TS 不认为回调必然执行）。
	let nextContent = '';
	let headingLine = -1;
	await view.app.vault.process(file, (content) => {
		const result = appendSectionHeading(
			content,
			t('view.iotoTaskView.newSectionTitle'),
		);
		nextContent = result.content;
		headingLine = result.headingLine;
		return result.content;
	});
	if (headingLine < 0) {
		return;
	}

	// 🔴 红线：data / lastLoadedText 同步，避免 TextFileView 回写旧字节。
	view.applyOutcome({ status: 'ok', content: nextContent });
	view.renderNote(view.data);
	// section 外壳由 renderNote 同步产出；进入整块编辑态（自动聚焦，失焦即提交改名）。
	// 放大态由 beginSectionEdit 内部 exitZoom 处理。
	await view.beginSectionEdit(headingLine);
}
