/**
 * 优先级矩阵打开任务的薄封装（[[Research-20261117-061808]] §四 方案 A /
 * [[Plan-20261117-062052]] §5.7）。
 *
 * 打开口径 100% 复用视图中立的 `views/task-preview-open.ts`；本文件只做
 * 修饰键判定与「文件缺失」提示（矩阵走 i18n Notice，任务中心静默）。
 */

import { Notice } from 'obsidian';

import { t } from '../../lang/helpter';
import { resolveTaskOpenTargetFromMouse } from '../tasks-center/task-open-target';
import {
	openTaskInPreviewLeaf,
	openTaskInTab,
	type TaskPreviewOpenHost,
} from '../task-preview-open';

export async function openQuadrantTask(
	host: TaskPreviewOpenHost,
	path: string,
	mods: MouseEvent | null,
): Promise<void> {
	const target = mods ? resolveTaskOpenTargetFromMouse(mods) : 'adjacent-preview';
	const result =
		target === 'adjacent-preview'
			? await openTaskInPreviewLeaf(host, path)
			: await openTaskInTab(host, path, target);
	if (result.status === 'missing') {
		new Notice(t('priorityQuadrant.notice.taskMissing'));
	}
}
