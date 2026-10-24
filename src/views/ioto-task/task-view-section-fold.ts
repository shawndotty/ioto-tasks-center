/**
 * Section 折叠态的跨会话镜像（[[Plan-20261023-062616]] S4），与
 * `task-view-continuation-fold.ts` 同构：真源仍是 `TaskViewHost.collapsedSections`
 * （内存 `Set`），本模块只负责「装载时灌回」与「改了就落盘」。
 *
 * 键不含行号（`s:<level>:<title>`，见 `section-fold-key.ts`），故不需要任何行漂移
 * 重映射——这正是换键的净收益：不再「小心翼翼保住行号」。
 */

import { collectRootSections, parseSections } from '../../tasks-center/note-structure';
import { collectSectionFoldKeys } from './section-fold-key';
import {
	createFoldStorage,
	resolveSectionFolds,
	saveSectionFolds,
} from './task-view-fold-store';
import type { TaskViewHost } from './task-view-host';

/**
 * 装载时调用（`setViewData` 的 `clear === true` 分支、`renderNote` 之前）。
 *
 * `pending` 用**默认参数**而非函数内 take：`setViewData` 里两个 hydrate 共用同一份
 * pending（`takePendingLeafFolds()` 取走即清空，各 take 一次会有一个拿到 `null`），
 * 而既有单测只传 `view` 一个参数也能跑。
 */
export function hydrateSectionFolds(
	view: TaskViewHost,
	pending = view.takePendingLeafFolds(),
): void {
	const storage = createFoldStorage(view.app);
	const path = view.file?.path ?? '';
	// 认领范围限定「同一文件」（或 path 缺失的老状态），防叶子复用把 A 的键串给 B。
	const legacy =
		pending && (pending.path === '' || pending.path === path)
			? pending.sections
			: [];
	// 🔴 必须在**未过滤**的数据上算 roots：此刻 `clear()` 已把 filters 重置为全 false，
	// 「只显示任务」态的过滤子集不会误伤交集（[[Research-20261023-060744]] §4.6）。
	const roots = collectRootSections(parseSections(view.data));
	// 原地改集合（不重新赋值）：`renderTaskNote` 拿的是同一个 Set 引用。
	view.collapsedSections.clear();
	if (!storage || !path) {
		// 老客户端（无 localStorage API）/ 尚未绑定文件 → 退化为今天的行为。
		for (const key of legacy) {
			view.collapsedSections.add(key);
		}
		return;
	}
	for (const key of resolveSectionFolds(storage, path, legacy, roots)) {
		view.collapsedSections.add(key);
	}
}

/**
 * 改了 `collapsedSections` 之后调用（显式折叠 / 展开 / 进编辑强制展开 / 改名迁移）：
 * 整份镜像落盘，不 debounce。
 *
 * 空集合也写 `[]`：这是「展开后重载仍是展开」的凭据（区别于「从没记录」）。
 */
export function persistSectionFolds(view: TaskViewHost): void {
	const storage = createFoldStorage(view.app);
	const path = view.file?.path;
	if (!storage || !path) {
		return;
	}
	saveSectionFolds(storage, path, [...view.collapsedSections]);
}

/** 当前文件是否有任何可折叠 Section（命令门禁用；只读 `view.data`，不扫 DOM）。 */
export function hasSectionFolds(view: TaskViewHost): boolean {
	return collectSectionFoldKeys(view.data ?? '').length > 0;
}

/**
 * 二态切换**全文件**全部 Section（[[Plan-20261024-065930]] S2）。
 *
 * - 作用域取 `view.data`：折叠节 / 被过滤的节 / 「只看本节」外的节都要进集合，
 *   否则重新展开时它们仍是旧的折叠态。
 * - 二态判据：全部已折叠 → 展开，否则折叠；空集短路返回 `false`。
 * - 集合**全量重建**（D4）：Section 键 hydrate 时已由 `intersectSectionFoldKeys`
 *   剪掉死键，`clear()` 不承担丢态风险。
 * - 必然整树重建（D5）：折叠节不渲染 body，展开只能重渲染。
 *
 * @returns 是否真的改了（`false` = 该笔记没有任何可折叠 Section）
 */
export async function toggleAllSectionFolds(
	view: TaskViewHost,
): Promise<boolean> {
	// ① 先落盘在册编辑器（同 markAllTasksDone / duplicateTask 口径）：
	//    下面必然 renderNote，未提交的卡片 / 续行 / 节正文 / 节标题会被直接销毁。
	await view.flushInlineEdits();
	// ② 文件级操作与「只看本节」冲突：先退聚焦（同 appendTaskBlock），
	//    否则「全部折叠」会留下一个只有标题的空白节。
	if (view.sectionZoomLine !== null) {
		view.exitSectionZoom();
	}
	// ③ 键必须在 flush 之后算：提交可能改了标题 / 行内容。
	const keys = collectSectionFoldKeys(view.data ?? '');
	if (keys.length === 0) {
		return false;
	}
	const collapse = !keys.every((key) => view.collapsedSections.has(key));
	view.collapsedSections.clear();
	if (collapse) {
		for (const key of keys) {
			view.collapsedSections.add(key);
		}
	}
	persistSectionFolds(view); // 循环外只调一次
	// ④ 折叠方向回顶：折叠后旧 scrollTop 必然超过新 scrollHeight，
	//    不显式归零会被浏览器贴到底部（只剩最后几个标题）。
	if (collapse) {
		view.renderNote(view.data, { resetScroll: true });
	} else {
		view.renderNote(view.data); // 展开：内容向下长，既有锚点恢复有效
	}
	return true;
}
