/**
 * 带并发上限的异步 map。
 *
 * `Promise.all(items.map(...))` 会在瞬间把所有 IO 请求一起放出去，任务库
 * 上千个文件时容易把磁盘与事件循环打满，表现为界面卡顿。这里用固定大小的
 * 工作池削峰，保持顺序与 `Promise.all` 一致。
 */
export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const total = items.length;
	if (total === 0) {
		return [];
	}

	const concurrency = Math.max(1, Math.min(limit, total));
	const results = new Array<R>(total);
	let nextIndex = 0;

	const runWorker = async (): Promise<void> => {
		while (nextIndex < total) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			results[currentIndex] = await mapper(
				items[currentIndex] as T,
				currentIndex,
			);
		}
	};

	const workers: Promise<void>[] = [];
	for (let i = 0; i < concurrency; i += 1) {
		workers.push(runWorker());
	}

	await Promise.all(workers);
	return results;
}

/** 项目 / 任务文件扫描的并发上限。 */
export const TASK_SCAN_CONCURRENCY = 24;
