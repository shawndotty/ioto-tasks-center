/**
 * Section 折叠态的跨会话镜像（[[Plan-20261023-062616]] S4），与
 * `task-view-continuation-fold.ts` 同构：真源仍是 `TaskViewHost.collapsedSections`
 * （内存 `Set`），本模块只负责「装载时灌回」与「改了就落盘」。
 *
 * 键不含行号（`s:<level>:<title>`，见 `section-fold-key.ts`），故不需要任何行漂移
 * 重映射——这正是换键的净收益：不再「小心翼翼保住行号」。
 */

import { collectRootSections, parseSections } from '../../tasks-center/note-structure';
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
