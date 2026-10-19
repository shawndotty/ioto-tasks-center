/**
 * Task View 整节删除（[[Plan-20261018-183253]]）：Section 头部「删除本节」的
 * 落地链路 —— 二次确认 → 落盘在册编辑 → 行号 + 标题复核 → 纯函数算区间 →
 * 原子写回 → 行号跟踪态迁移 → 整树重建。
 *
 * 删除粒度 = 该**顶层** Section 的 `startLine..endLine`（天然含嵌套 `##` 子标题、
 * 任务与正文）。块间空行口径由 `removeTopLevelSection` 统一，写盘走
 * `commitBlockRange` 的 `nextLines` 直写口（绝不整篇序列化）。
 */

import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import {
	parseSections,
	removeTopLevelSection,
} from '../../tasks-center/note-structure';
import { ConfirmModal } from '../../ui/confirmModal';
import { commitBlockRange } from './commit-task-line';
import type { TaskViewHost } from './task-view-host';
import { remapTrackedLines } from './task-view-tracked-lines';

export async function deleteSection(
	view: TaskViewHost,
	startLine: number,
	title: string,
): Promise<void> {
	const file = view.file;
	if (!file || !view.supportsInlineEdit()) {
		return; // 只读降级：静默（同 addSection 口径）
	}

	// 先把在册编辑器落盘（可能刚改过标题，blur 提交还在途）：确认文案要读最新标题。
	// 确认框会再抢一次焦点，后面还有一次幂等 flush。
	await view.flushInlineEdits();

	// 标题只用于确认文案：按 startLine 从当前 data 取，避免用渲染闭包里的旧标题
	// （改名后删节会误判冲突，[[Plan-20261019-122509]] §2.5）。
	const before = parseSections(view.data).find(
		(s) => s.startLine === startLine && s.level > 0,
	);
	const confirmTitle = before?.title ?? title;

	const confirmed = await new ConfirmModal(
		view.app,
		t('modal.deleteSection.title'),
		{
			descriptionText: t('modal.deleteSection.desc', [
				confirmTitle || t('view.iotoTaskView.fallbackTitle'),
			]),
			confirmButtonText: t('modal.deleteSection.confirm'),
			cancelButtonText: t('modal.cancel'),
		},
	).openAndConfirm();
	if (!confirmed) {
		return;
	}

	// 确认框抢焦点会触发 blur 提交；这里再幂等收口一次（同 addSection 口径）。
	await view.flushInlineEdits();

	// 提交可能改变行数：先按「行号」复核，退到「唯一同标题」，否则判冲突。
	const sections = parseSections(view.data).filter((s) => s.level > 0);
	const sameLine = sections.find((s) => s.startLine === startLine);
	const sameTitle = sections.filter((s) => s.title === confirmTitle);
	const target = sameLine ?? (sameTitle.length === 1 ? sameTitle[0] : null);
	if (!target) {
		new Notice(t('notice.iotoTaskView.commitConflict'));
		await view.reloadFromVault();
		return;
	}

	const removal = removeTopLevelSection(view.data, target.startLine);
	if (!removal) {
		return;
	}

	// 瞬态收尾：待删除遮罩与放大态都不该跨过一次整节删除。
	view.cancelPendingDelete(false);
	// 「只看本节」是 `startLine` 身份的瞬态：删任何一节都会让其后所有节整体前移，
	// 哪怕删的不是聚焦节，聚焦锚点也会失效 → 一律先退出（[[Research-20261019-131228]] §4.6）。
	if (view.sectionZoomLine !== null) {
		view.exitSectionZoom();
	}
	if (
		view.zoomLine !== null &&
		view.zoomLine >= removal.startLine &&
		view.zoomLine <= removal.endLine
	) {
		view.exitZoom();
	}

	const outcome = await commitBlockRange(view.app, file, {
		startLine: removal.startLine,
		endLine: removal.endLine,
		originalLines: removal.originalLines,
		nextText: '',
		nextLines: removal.nextLines,
	});
	view.applyOutcome(outcome);

	if (outcome.status === 'conflict') {
		await view.reloadFromVault();
		return;
	}
	if (outcome.status !== 'ok') {
		return;
	}

	// 行号整体前移：选中 / 折叠键按「旧 → 新」迁移，落在删块内的清空。
	const delta = removal.originalLines.length - removal.nextLines.length;
	remapTrackedLines(view, (line) => {
		if (line === null) {
			return null;
		}
		if (line < removal.startLine) {
			return line;
		}
		if (line <= removal.endLine) {
			return null;
		}
		return line - delta;
	});

	view.renderNote(view.data);
}
