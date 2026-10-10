import type { TFile } from 'obsidian';

import type { TaskFileStatus } from './types';

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
}

/** 传 path 精确失效（删除 / 重命名）；不传则全清（如任务根目录变更）。 */
export function invalidateTaskFileFields(path?: string): void {
	if (typeof path !== 'string') {
		fieldsByPath.clear();
		return;
	}

	fieldsByPath.delete(path);
}

export function getTaskFileFieldCacheSize(): number {
	return fieldsByPath.size;
}
