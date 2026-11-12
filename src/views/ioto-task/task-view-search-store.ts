/**
 * 任务视图搜索关键词的**跨会话镜像**（[[Plan-20261112-153653]] Step 1）。
 *
 * 真源仍是 `IOTOTaskView.searchQuery`（内存）；结果 = `f(笔记正文, 关键词)`，正文每次
 * 从磁盘读，所以**只持久化关键词**，命中列表不存。按**笔记路径**镜像到 per-vault
 * localStorage，机制照抄 `task-view-fold-store.ts`（[[Plan-20261023-001403]]）。
 *
 * 与折叠态刻意不同的两点：
 * - **独立前缀**（`ioto-task-search-`）：折叠记录的 `v` / legacy 认领逻辑敏感，塞进同一条
 *   记录会互相覆盖；
 * - **空串 = 删键**：空搜索没有可恢复的语义，删键避免死键膨胀。
 *
 * 🔴 零 `obsidian` import：宿主能力用 `FoldStorageLike` 结构接口描述，jiti 直测不触发运行时。
 */

import type { FoldStorageLike } from './task-view-fold-store';

/** 键前缀（实际存储键由 Obsidian 再拼上 `<appId>-`，见 `listStoredSearchPaths`）。 */
export const SEARCH_STORE_PREFIX = 'ioto-task-search-';
/** 记录格式版本；读到别的版本一律当「无记录」，不尝试升级。 */
export const SEARCH_STORE_VERSION = 1;

export function searchStoreKey(path: string): string {
	return `${SEARCH_STORE_PREFIX}${path}`;
}

function loadRaw(storage: FoldStorageLike, path: string): unknown {
	try {
		return storage.loadLocalStorage(searchStoreKey(path));
	} catch {
		return null;
	}
}

/** 坏结构 / 坏版本 → `null`（= 无记录），不抛错。 */
function readQuery(raw: unknown): string | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const record = raw as { v?: unknown; query?: unknown };
	if (record.v !== SEARCH_STORE_VERSION || typeof record.query !== 'string') {
		return null;
	}
	return record.query;
}

/** 读一个笔记的搜索关键词；`null` = 从没写过。 */
export function loadSearchQuery(
	storage: FoldStorageLike,
	path: string,
): string | null {
	return readQuery(loadRaw(storage, path));
}

/** 空串 = 删键（空搜索无可恢复语义）。写失败静默吞掉：退化为「不持久化」。 */
export function saveSearchQuery(
	storage: FoldStorageLike,
	path: string,
	query: string,
): void {
	if (!path) {
		return;
	}
	if (query === '') {
		dropSearchQuery(storage, path);
		return;
	}
	try {
		storage.saveLocalStorage(searchStoreKey(path), {
			v: SEARCH_STORE_VERSION,
			query,
		});
	} catch {
		// 存不了 = 与旧客户端同口径。
	}
}

/** 删记录（`saveLocalStorage(key, null)` 即删除，核心口径）。 */
export function dropSearchQuery(storage: FoldStorageLike, path: string): void {
	if (!path) {
		return;
	}
	try {
		storage.saveLocalStorage(searchStoreKey(path), null);
	} catch {
		// 删除失败只留死键，有启动清理兜底。
	}
}

/**
 * 笔记重命名后把记录搬到新路径。
 *
 * 目标已有记录时**保留目标**：同一时刻两个路径都写过，说明用户在新路径上已有更近的
 * 意图，旧路径只是残影。无论哪种分支都删旧键。
 */
export function renameSearchRecord(
	storage: FoldStorageLike,
	oldPath: string,
	newPath: string,
): void {
	if (!oldPath || !newPath || oldPath === newPath) {
		return;
	}
	const query = readQuery(loadRaw(storage, oldPath));
	if (query === null) {
		return;
	}
	if (readQuery(loadRaw(storage, newPath)) === null) {
		saveSearchQuery(storage, newPath, query);
	}
	dropSearchQuery(storage, oldPath);
}

/**
 * 从 localStorage 键表里挑出「本库」的搜索记录路径。
 *
 * 🔴 真实键形如 `<appId>-ioto-task-search-<path>`，同机 localStorage 里同时存在多个库的
 * 记录，所以必须先按 `appId` 过滤，否则会误删别的库。
 */
export function listStoredSearchPaths(
	appId: string,
	storageKeys: readonly string[],
): string[] {
	if (!appId) {
		return [];
	}
	const prefix = `${appId}-${SEARCH_STORE_PREFIX}`;
	const paths: string[] = [];
	for (const key of storageKeys) {
		if (!key.startsWith(prefix)) {
			continue;
		}
		const path = key.slice(prefix.length);
		if (path.length > 0) {
			paths.push(path);
		}
	}
	return paths;
}

/** 启动清理：删「本库前缀 + 文件已不存在」的死键，返回删除条数。 */
export function pruneSearchQueries(
	storage: FoldStorageLike,
	appId: string,
	storageKeys: readonly string[],
	fileExists: (path: string) => boolean,
): number {
	let removed = 0;
	for (const path of listStoredSearchPaths(appId, storageKeys)) {
		if (fileExists(path)) {
			continue;
		}
		dropSearchQuery(storage, path);
		removed += 1;
	}
	return removed;
}
