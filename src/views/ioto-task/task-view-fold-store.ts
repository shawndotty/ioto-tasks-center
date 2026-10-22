/**
 * 续写区折叠态的**跨会话镜像**（[[Plan-20261023-001403]] S1 / [[Discuss-20261023-000621]] 方案 B）。
 *
 * 真源仍是 `IOTOTaskView.continuationCollapsed`（内存 `Set`）；本模块只把那份状态按
 * **笔记路径**镜像到 Obsidian 的 per-vault localStorage，供下次装载时灌回。
 * 边界（计划 §1.2）：不碰笔记内容 / frontmatter / 侧车文件，不跨设备同步，不做陈旧哈希清理。
 *
 * 🔴 零 `obsidian` import（连 `import type` 都不用）：宿主能力用结构化接口
 * `FoldStorageLike` 描述，`App` 天然满足；单测用 `Map` 假实现即可，jiti 直导不触发运行时。
 */

/** 只取这两个方法：Obsidian `App` 天然满足，单测用 `Map` 假实现即可。 */
export interface FoldStorageLike {
	loadLocalStorage(key: string): unknown;
	/** 传 `null` 即删除该键（核心口径）。`unknown` 已含 `null`，故不写联合类型。 */
	saveLocalStorage(key: string, data: unknown): void;
}

/** 键前缀（实际存储键由 Obsidian 再拼上 `<appId>-`，见 `listStoredFoldPaths`）。 */
export const FOLD_STORE_PREFIX = 'ioto-task-fold-';
/** 记录格式版本；读到别的版本一律当「无记录」，不尝试升级。 */
export const FOLD_STORE_VERSION = 1;

/** 一个笔记的折叠记录（`continuations` = 续写正文哈希键集合）。 */
export type FoldRecord = { v: number; continuations: string[] };

export function foldStoreKey(path: string): string {
	return `${FOLD_STORE_PREFIX}${path}`;
}

/** 去重且只留 string（手改 / 坏数据的兜底；顺序按首次出现）。 */
function normalizeKeys(values: readonly unknown[]): string[] {
	const seen = new Set<string>();
	const keys: string[] = [];
	for (const value of values) {
		if (typeof value !== 'string' || seen.has(value)) {
			continue;
		}
		seen.add(value);
		keys.push(value);
	}
	return keys;
}

/**
 * 把任意读到的值解析成记录。
 *
 * 坏结构 / 坏版本一律 `null`（= 无记录），不抛错：手改 localStorage 或旧版本残留
 * 只该让折叠态「恢复不了」，不该让视图装载失败。
 */
export function readFoldRecord(raw: unknown): string[] | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const record = raw as { v?: unknown; continuations?: unknown };
	if (record.v !== FOLD_STORE_VERSION || !Array.isArray(record.continuations)) {
		return null;
	}
	return normalizeKeys(record.continuations);
}

/** 读一个笔记的记录；`null` = 从没写过。 */
export function loadContinuationFolds(
	storage: FoldStorageLike,
	path: string,
): string[] | null {
	try {
		return readFoldRecord(storage.loadLocalStorage(foldStoreKey(path)));
	} catch {
		return null;
	}
}

/**
 * 整份镜像落盘（**永不删键**：显式展开要留下 `[]`，详见 `resolveContinuationFolds`）。
 *
 * 写失败（localStorage 满 / 被禁用）只影响持久化，不影响本次折叠，因此静默吞掉。
 */
export function saveContinuationFolds(
	storage: FoldStorageLike,
	path: string,
	keys: readonly string[],
): void {
	const record: FoldRecord = {
		v: FOLD_STORE_VERSION,
		continuations: normalizeKeys(keys),
	};
	try {
		storage.saveLocalStorage(foldStoreKey(path), record);
	} catch {
		// 存不了 = 退化为「不持久化」，与旧客户端同口径。
	}
}

/**
 * hydrate 的唯一取数口。
 *
 * - 有记录（含 `[]`）→ 以记录为准，**不认领 legacy**：这是「显式展开后重载不复活」的关键；
 * - 无记录 + legacy 非空 → 认领并落盘（老 `workspace.json` 的一次性迁移）；
 * - 无记录 + legacy 为空 → 返回 `[]` 且**不写键**（否则每个打开过的笔记都留一条空记录）。
 */
export function resolveContinuationFolds(
	storage: FoldStorageLike,
	path: string,
	legacy: readonly string[],
): string[] {
	const stored = loadContinuationFolds(storage, path);
	if (stored !== null) {
		return stored;
	}
	const claimed = normalizeKeys(legacy);
	if (claimed.length === 0) {
		return [];
	}
	saveContinuationFolds(storage, path, claimed);
	return claimed;
}

/**
 * 笔记重命名后把记录搬到新路径。
 *
 * 目标已有记录时**保留目标**（不覆盖）：同一时刻两个路径都写过，说明用户在新路径上
 * 已有更近的意图，旧路径的记录只是残影。无论哪种分支都删旧键。
 */
export function renameContinuationFolds(
	storage: FoldStorageLike,
	oldPath: string,
	newPath: string,
): void {
	if (!oldPath || !newPath || oldPath === newPath) {
		return;
	}
	const stored = loadContinuationFolds(storage, oldPath);
	if (stored === null) {
		return;
	}
	if (loadContinuationFolds(storage, newPath) === null) {
		saveContinuationFolds(storage, newPath, stored);
	}
	dropFoldRecord(storage, oldPath);
}

function dropFoldRecord(storage: FoldStorageLike, path: string): boolean {
	try {
		// `saveLocalStorage(key, null)` 即删除（核心口径）。
		storage.saveLocalStorage(foldStoreKey(path), null);
		return true;
	} catch {
		return false;
	}
}

/**
 * 从 localStorage 键表里挑出「本库」的折叠记录路径。
 *
 * 🔴 真实键形如 `<appId>-ioto-task-fold-<path>`，同机 localStorage 里同时存在多个库的
 * 记录（[[Plan-20261023-001403]] §2.3-5），所以必须先按 `appId` 过滤，否则会误删别的库。
 */
export function listStoredFoldPaths(
	appId: string,
	storageKeys: readonly string[],
): string[] {
	if (!appId) {
		return [];
	}
	const prefix = `${appId}-${FOLD_STORE_PREFIX}`;
	const paths: string[] = [];
	for (const key of storageKeys) {
		if (!key.startsWith(prefix)) {
			continue;
		}
		const path = key.slice(prefix.length);
		if (path.length === 0) {
			continue;
		}
		paths.push(path);
	}
	return paths;
}

/**
 * 启动清理：删掉「本库前缀 + 文件已不存在」的死键，返回删除条数。
 *
 * 只做删除，不做读取校验：坏记录的修复交给 `readFoldRecord`（读时当无记录）。
 */
export function pruneContinuationFolds(
	storage: FoldStorageLike,
	appId: string,
	storageKeys: readonly string[],
	fileExists: (path: string) => boolean,
): number {
	let removed = 0;
	for (const path of listStoredFoldPaths(appId, storageKeys)) {
		if (fileExists(path)) {
			continue;
		}
		if (dropFoldRecord(storage, path)) {
			removed += 1;
		}
	}
	return removed;
}

/**
 * 取本库 appId（`App.appId` 运行期存在但**不在 `obsidian.d.ts`**，此处收口 cast）。
 *
 * 取不到就返回 `null` → 调用方跳过清理（只是留死键，不影响折叠）。
 */
export function resolveAppId(app: unknown): string | null {
	if (!app || typeof app !== 'object') {
		return null;
	}
	const appId = (app as { appId?: unknown }).appId;
	return typeof appId === 'string' && appId.length > 0 ? appId : null;
}

/**
 * 特性探测 `App.loadLocalStorage` / `saveLocalStorage`（`@since 1.8.7`，本插件
 * `minAppVersion` 是 1.5.7）——缺 API 时返回 `null`，整条持久化链静默跳过。
 *
 * 返回包装对象而非原 app：方法经闭包以原实例为 receiver 调用，避免依赖 `this` 的
 * 实现对解构 / 转发敏感。
 */
export function createFoldStorage(app: unknown): FoldStorageLike | null {
	if (!app || typeof app !== 'object') {
		return null;
	}
	const candidate = app as {
		loadLocalStorage?: unknown;
		saveLocalStorage?: unknown;
	};
	if (
		typeof candidate.loadLocalStorage !== 'function' ||
		typeof candidate.saveLocalStorage !== 'function'
	) {
		return null;
	}
	const storage = candidate as unknown as FoldStorageLike;
	return {
		loadLocalStorage: (key) => storage.loadLocalStorage(key),
		saveLocalStorage: (key, data) => storage.saveLocalStorage(key, data),
	};
}
