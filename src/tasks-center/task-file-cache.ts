import type { TFile } from 'obsidian';

import {
	type PersistedTaskFileCache,
	isPersistedCacheEntry,
} from './task-file-cache-persist';
import type { TaskFileStatus } from './types';

export type { PersistedTaskFileCache } from './task-file-cache-persist';

/**
 * 任务文件的「解析结果」缓存。
 *
 * 背景：任务中心每刷新一次就要给每个项目算未完成任务数，原实现会把库里
 * 每个任务文件都 `cachedRead` 一遍再做 4 次 frontmatter 正则 + 全行 checklist
 * 扫描。改设置、勾选一个复选框都会触发，成本随任务数线性放大。
 *
 * 这些字段在文件内容没变时是恒定的，因此按 (mtime, size) 缓存解析结果：
 * 第二次起的刷新对未变动文件完全跳过读盘与解析。缓存只存解析出的小字段，
 * 不存正文（正文仍按需 `cachedRead`，避免整库正文常驻内存）。
 */
export interface TaskFileFields {
	status: TaskFileStatus;
	starred: boolean;
	priority?: number;
	upTaskTitles: string[];
}

interface CacheEntry {
	mtime: number;
	size: number;
	fields: TaskFileFields;
}

/** 上限保护：极端大库下宁可整体丢弃重来，也不让缓存无界增长。 */
const MAX_CACHE_ENTRIES = 8000;

const fieldsByPath = new Map<string, CacheEntry>();

/** 相对最近一次落盘是否有未保存的写入（hydrate / serialize 后归零）。 */
let dirty = false;

/**
 * 解析逻辑变更时必须 +1，否则旧分片会回灌错误字段
 * （[[Plan-20261127-142715]] §P0-1 风险表）。
 */
export const TASK_FILE_CACHE_VERSION = 1;

/** 命中返回解析结果，未命中返回 null（调用方负责读文件并解析）。 */
export function peekTaskFileFields(file: TFile): TaskFileFields | null {
	const entry = fieldsByPath.get(file.path);
	if (!entry) {
		return null;
	}

	if (
		entry.mtime !== file.stat.mtime ||
		entry.size !== file.stat.size
	) {
		return null;
	}

	return entry.fields;
}

export function rememberTaskFileFields(
	file: TFile,
	fields: TaskFileFields,
): void {
	if (
		!fieldsByPath.has(file.path) &&
		fieldsByPath.size >= MAX_CACHE_ENTRIES
	) {
		fieldsByPath.clear();
	}

	fieldsByPath.set(file.path, {
		mtime: file.stat.mtime,
		size: file.stat.size,
		fields,
	});
	dirty = true;
}

/** 传 path 精确失效（删除 / 重命名）；不传则全清（如任务根目录变更）。 */
export function invalidateTaskFileFields(path?: string): void {
	if (typeof path !== 'string') {
		fieldsByPath.clear();
		dirty = true;
		return;
	}

	if (fieldsByPath.delete(path)) {
		dirty = true;
	}
}

export function getTaskFileFieldCacheSize(): number {
	return fieldsByPath.size;
}

// --- 跨会话持久化（纯函数层，[[Plan-20261127-142715]] §P0-1） ---
// IO 在 task-file-cache-persist.ts，由 main.ts 接线；这里不 import 任何上层模块。

/** 导出当前缓存的可序列化分片：丢弃任务根之外条目，超限裁剪。 */
export function serializeTaskFileCache(
	tasksRootPath: string,
	isPathInsideRoot: (path: string) => boolean,
	maxEntries: number = MAX_CACHE_ENTRIES,
): PersistedTaskFileCache {
	const cap = Math.max(0, Math.min(maxEntries, MAX_CACHE_ENTRIES));
	const entries: PersistedTaskFileCache['entries'] = [];
	for (const [path, entry] of fieldsByPath) {
		if (entries.length >= cap) {
			break;
		}
		if (!isPathInsideRoot(path)) {
			continue;
		}
		entries.push([path, { mtime: entry.mtime, size: entry.size, fields: entry.fields }]);
	}

	dirty = false;
	return {
		version: TASK_FILE_CACHE_VERSION,
		savedAt: Date.now(),
		tasksRootPath,
		entries,
	};
}

/**
 * 从持久化分片回填内存缓存，返回载入条目数。
 * 整体结构不合法（版本 / 任务根 / 条目数）→ 整表作废返回 0；
 * 单条脏条目跳过。语义上只是把「miss 后解析」变成「hit 直接返回」，
 * peek 的 (mtime, size) 新鲜度判定不变。
 */
export function hydrateTaskFileCache(
	raw: unknown,
	currentTasksRootPath: string,
): number {
	dirty = false;
	if (!raw || typeof raw !== 'object') {
		return 0;
	}

	const payload = raw as Partial<PersistedTaskFileCache>;
	if (
		payload.version !== TASK_FILE_CACHE_VERSION ||
		payload.tasksRootPath !== currentTasksRootPath ||
		!Array.isArray(payload.entries) ||
		payload.entries.length > MAX_CACHE_ENTRIES
	) {
		return 0;
	}

	let loaded = 0;
	for (const item of payload.entries) {
		if (!isPersistedCacheEntry(item)) {
			continue;
		}
		const [path, entry] = item;
		if (fieldsByPath.has(path) || fieldsByPath.size >= MAX_CACHE_ENTRIES) {
			continue;
		}
		fieldsByPath.set(path, {
			mtime: entry.mtime,
			size: entry.size,
			// status.key 等窄联合由 isPersistedCacheEntry 保证取值合法，此处只做类型缝合
			fields: entry.fields as unknown as CacheEntry['fields'],
		});
		loaded += 1;
	}

	return loaded;
}

export function isTaskFileCacheDirty(): boolean {
	return dirty;
}
