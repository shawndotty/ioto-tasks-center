import type { App } from 'obsidian';

/**
 * 解析缓存的跨会话持久化层（[[Plan-20261127-142715]] §P0-1）。
 *
 * 内存缓存本体与 serialize/hydrate 纯函数在 `task-file-cache.ts`；
 * 这里只放分片结构定义与 vault adapter 读写。本模块**不 import 任何上层模块**
 * （`isPathInsideRoot` 等由调用方注入），避免与 `data.ts → task-file-cache`
 * 形成值级循环（`npm run dep:check` 门禁）。
 *
 * 分片写在插件自身目录、不进 `data.json`：避免污染设置、避免与 `saveData` 竞争。
 * 缓存是加速器不是功能：读写异常一律吞掉降级为冷扫描，只 `console.warn`，不弹 `Notice`。
 */
export const TASK_FILE_CACHE_FILE_NAME = 'task-parse-cache.json';

/** 与 `types.ts` 的 `TaskFileStatusKey` 保持一致（此处内联以免 import 上层）。 */
const VALID_STATUS_KEYS = ['todo', 'in-progress', 'completed', 'empty'] as const;

/** 与 `task-file-cache.ts` 的 `TaskFileFields` 结构一致（此处独立定义以免反向 import）。 */
export interface PersistedTaskFileFields {
	status: {
		key: string;
		label: string;
		totalTaskCount: number;
		completedTaskCount: number;
		summary: string;
	};
	starred: boolean;
	priority?: number;
	upTaskTitles: string[];
}

export interface PersistedTaskFileCacheEntry {
	mtime: number;
	size: number;
	fields: PersistedTaskFileFields;
}

export interface PersistedTaskFileCache {
	version: number;
	savedAt: number;
	tasksRootPath: string;
	entries: Array<[string, PersistedTaskFileCacheEntry]>;
}

/** 条目级脏数据判定：缺 mtime/size 或 fields 形状不符即视为脏。 */
export function isPersistedCacheEntry(value: unknown): value is [string, PersistedTaskFileCacheEntry] {
	if (!Array.isArray(value) || value.length !== 2) {
		return false;
	}
	const pair: [unknown, unknown] = [value[0], value[1]];
	const [path, entry] = pair;
	if (typeof path !== 'string' || !entry || typeof entry !== 'object') {
		return false;
	}
	const candidate = entry as Partial<PersistedTaskFileCacheEntry>;
	if (
		typeof candidate.mtime !== 'number' ||
		typeof candidate.size !== 'number' ||
		!candidate.fields ||
		typeof candidate.fields !== 'object'
	) {
		return false;
	}
	const fields = candidate.fields as Partial<PersistedTaskFileFields>;
	const status = fields.status as
		| { key?: unknown; label?: unknown; totalTaskCount?: unknown; completedTaskCount?: unknown; summary?: unknown }
		| undefined;
	return (
		typeof status?.key === 'string' &&
		// 与 types.ts 的 TaskFileStatusKey 四值枚举一致；不在其中即脏条目
		(VALID_STATUS_KEYS as readonly string[]).includes(status.key) &&
		typeof status.label === 'string' &&
		typeof status.totalTaskCount === 'number' &&
		typeof status.completedTaskCount === 'number' &&
		typeof status.summary === 'string' &&
		typeof fields.starred === 'boolean' &&
		(fields.priority === undefined || typeof fields.priority === 'number') &&
		Array.isArray(fields.upTaskTitles) &&
		fields.upTaskTitles.every((title) => typeof title === 'string')
	);
}

export function getTaskFileCachePath(pluginDir: string): string {
	return `${pluginDir.replace(/\/+$/g, '')}/${TASK_FILE_CACHE_FILE_NAME}`;
}

/** 读分片；不存在 / 解析失败返回 null（调用方降级冷扫描）。 */
export async function readCacheShard(
	app: App,
	path: string,
): Promise<unknown> {
	try {
		const adapter = app.vault.adapter;
		if (!(await adapter.exists(path))) {
			return null;
		}
		const raw = await adapter.read(path);
		return JSON.parse(raw);
	} catch (error) {
		console.warn('[ioto-tasks-center] 解析缓存分片读取失败，降级冷扫描', error);
		return null;
	}
}

/** 写分片；异常吞掉返回 false，不干扰主流程。 */
export async function writeCacheShard(
	app: App,
	path: string,
	payload: unknown,
): Promise<boolean> {
	try {
		await app.vault.adapter.write(path, JSON.stringify(payload));
		return true;
	} catch (error) {
		console.warn('[ioto-tasks-center] 解析缓存分片写入失败，忽略', error);
		return false;
	}
}
