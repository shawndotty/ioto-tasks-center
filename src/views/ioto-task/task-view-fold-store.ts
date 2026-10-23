import {
	claimSectionFoldKeys,
	intersectSectionFoldKeys,
	type SectionFoldSeed,
} from './section-fold-key';

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

/**
 * 一个笔记的折叠记录。
 *
 * - `continuations`：续写正文哈希键集合（[[Plan-20261023-001403]]）；
 * - `sections`：Section 折叠键集合（`s:<level>:<title>`，[[Plan-20261023-062616]] S3）。
 *   **optional 且刻意不补空**：缺字段 =「无记录」，是升级后一次性认领老
 *   `workspace.json` 键的判据（见 `readFoldSections`）。
 */
export type FoldRecord = {
	v: number;
	continuations: string[];
	sections?: string[];
};

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

/** 读原始记录值（不做解析）；读失败当「无记录」。 */
function loadRawRecord(storage: FoldStorageLike, path: string): unknown {
	try {
		return storage.loadLocalStorage(foldStoreKey(path));
	} catch {
		return null;
	}
}

/**
 * 把任意读到的值解析成**完整**记录。
 *
 * 坏结构 / 坏版本一律 `null`（= 无记录），不抛错：手改 localStorage 或旧版本残留
 * 只该让折叠态「恢复不了」，不该让视图装载失败。
 * `sections` 不是数组时**不带这个键**（区别于空数组，见 `readFoldSections`）。
 */
export function readFoldRecordFull(raw: unknown): FoldRecord | null {
	if (!raw || typeof raw !== 'object') {
		return null;
	}
	const record = raw as {
		v?: unknown;
		continuations?: unknown;
		sections?: unknown;
	};
	if (record.v !== FOLD_STORE_VERSION || !Array.isArray(record.continuations)) {
		return null;
	}
	const full: FoldRecord = {
		v: FOLD_STORE_VERSION,
		continuations: normalizeKeys(record.continuations),
	};
	if (Array.isArray(record.sections)) {
		full.sections = normalizeKeys(record.sections);
	}
	return full;
}

/** 兼容口径：只取续写区键（坏数据 / 无记录 → `null`）。 */
export function readFoldRecord(raw: unknown): string[] | null {
	return readFoldRecordFull(raw)?.continuations ?? null;
}

/**
 * 只取 Section 键；**缺 `sections` 字段返回 `null`（= 无记录）**。
 *
 * 🔴 不能退化成 `[]`：那样「有记录但为空」与「从没写过」就分不开了，而 legacy 认领
 * 只在「无记录」时发生——升级后本机已有的 `{v:1,continuations:[…]}` 会被判成
 * 「有记录且为空」，老 `workspace.json` 里一行都认领不到（[[Plan-20261023-062616]] §0.1-①）。
 */
export function readFoldSections(raw: unknown): string[] | null {
	return readFoldRecordFull(raw)?.sections ?? null;
}

/** 读一个笔记的续写区记录；`null` = 从没写过。 */
export function loadContinuationFolds(
	storage: FoldStorageLike,
	path: string,
): string[] | null {
	return readFoldRecord(loadRawRecord(storage, path));
}

/** 读一个笔记的 Section 记录；`null` = 从没写过。 */
export function loadSectionFolds(
	storage: FoldStorageLike,
	path: string,
): string[] | null {
	return readFoldSections(loadRawRecord(storage, path));
}

/** 整条记录落盘（写失败静默吞掉：只影响持久化，不影响本次折叠）。 */
function writeFoldRecord(
	storage: FoldStorageLike,
	path: string,
	record: FoldRecord,
): void {
	try {
		storage.saveLocalStorage(foldStoreKey(path), record);
	} catch {
		// 存不了 = 退化为「不持久化」，与旧客户端同口径。
	}
}

/**
 * read-modify-write 补丁写：**只替换传入的字段**，另一个折叠态原样保留。
 *
 * 🔴 这是续写区与 Section 两个折叠态能共存于同一条记录的关键：早期实现各自整条
 * 覆盖，后写的会把先写的字段冲掉（[[Plan-20261023-062616]] §0.1-③）。
 * 原记录没有 `sections` 且本次也不写时**不补空字段**（保持老记录字节不变）。
 */
function patchFoldRecord(
	storage: FoldStorageLike,
	path: string,
	patch: { continuations?: readonly string[]; sections?: readonly string[] },
): void {
	const full = readFoldRecordFull(loadRawRecord(storage, path));
	const base: FoldRecord = full ?? {
		v: FOLD_STORE_VERSION,
		continuations: [],
	};
	if (patch.continuations !== undefined) {
		base.continuations = normalizeKeys(patch.continuations);
	}
	if (patch.sections !== undefined) {
		base.sections = normalizeKeys(patch.sections);
	}
	writeFoldRecord(storage, path, base);
}

/**
 * 整份续写区镜像落盘（**永不删键**：显式展开要留下 `[]`，详见 `resolveContinuationFolds`）。
 */
export function saveContinuationFolds(
	storage: FoldStorageLike,
	path: string,
	keys: readonly string[],
): void {
	patchFoldRecord(storage, path, { continuations: keys });
}

/** 整份 Section 镜像落盘（同上：显式展开要留下 `[]`，不是删键）。 */
export function saveSectionFolds(
	storage: FoldStorageLike,
	path: string,
	keys: readonly string[],
): void {
	patchFoldRecord(storage, path, { sections: keys });
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
	// 🔴 搬**整条记录**（含 `sections`），不能只搬 continuations：否则重命名
	// 会把 Section 折叠态丢掉（[[Plan-20261023-062616]] §0.1-④）。
	const full = readFoldRecordFull(loadRawRecord(storage, oldPath));
	if (full === null) {
		return;
	}
	if (readFoldRecordFull(loadRawRecord(storage, newPath)) === null) {
		writeFoldRecord(storage, newPath, full);
	}
	dropFoldRecord(storage, oldPath);
}

/**
 * Section 折叠态的 hydrate 取数口（与 `resolveContinuationFolds` 同构，多一步交集）：
 *
 * - 有记录（含 `[]`）→ 以记录为准，**不认领 legacy**（「显式展开后重载不复活」的关键）；
 *   顺带做**交集清理**，丢掉匹配不到当前 root 的死键，交集变小则回写一次；
 * - 无记录 + legacy 非空 → 认领（行号键 → 新键）并落盘（老 `workspace.json` 迁移）；
 * - 无记录 + legacy 为空 → 返回 `[]` 且**不写键**。
 */
export function resolveSectionFolds(
	storage: FoldStorageLike,
	path: string,
	legacy: readonly string[],
	roots: readonly SectionFoldSeed[],
): string[] {
	const stored = loadSectionFolds(storage, path);
	if (stored !== null) {
		const kept = intersectSectionFoldKeys(stored, roots);
		if (kept.length !== stored.length) {
			saveSectionFolds(storage, path, kept);
		}
		return kept;
	}
	const claimed = claimSectionFoldKeys(legacy, roots);
	if (claimed.length === 0) {
		return [];
	}
	saveSectionFolds(storage, path, claimed);
	return claimed;
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
