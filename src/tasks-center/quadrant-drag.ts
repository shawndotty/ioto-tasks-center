/**
 * 优先级四象限拖拽的纯逻辑（[[Plan-20261116-112945]] §4.1）。
 *
 * 只做「落点 → 写入值」「同桶短路」「手势意图」三件事，零 DOM、零 i18n，
 * 便于单测。依赖约束：只允许同层纯模块 + `import type`，禁止导入 `views/**`
 * 或 `obsidian` 运行时。
 */

import {
	QUADRANT_KEYS,
	type QuadrantBucketKey,
} from './quadrant-data';
import type { TaskPriorityValue } from './task-priority';

/** 落点桶 → 写入值；`unlabeled` 返回 undefined 表示删除 Priority。 */
export function priorityForQuadrantDrop(
	bucketKey: QuadrantBucketKey,
): TaskPriorityValue | undefined {
	if (bucketKey === 'unlabeled') return undefined;
	const index = QUADRANT_KEYS.indexOf(bucketKey);
	return index as TaskPriorityValue;
}

/** 同桶短路：源桶与目标桶相同则不写盘（同桶放置 = no-op）。 */
export function isSameQuadrantDrop(
	sourceBucketKey: string | undefined,
	targetBucketKey: QuadrantBucketKey,
): boolean {
	return sourceBucketKey === targetBucketKey;
}

export type QuadrantDragIntent = 'pending' | 'drag' | 'scroll-abort';

export interface QuadrantDragIntentInput {
	pointerType: string;
	longPressFired: boolean;
	/** 已调用 beginDrag 后恒为 true，用于保持拖拽态。 */
	dragStarted: boolean;
	distance: number;
	/** 鼠标/触屏各自的位移阈值，默认 8。 */
	moveThreshold?: number;
}

/**
 * 桌面：位移超阈值即拖；
 * 触屏/笔：必须先长按，再位移超阈值；未长按就滑动 = 交给原生滚动。
 */
export function resolveQuadrantDragIntent(
	input: QuadrantDragIntentInput,
): QuadrantDragIntent {
	if (input.dragStarted) return 'drag';
	if (input.distance < (input.moveThreshold ?? 8)) return 'pending';
	if (input.pointerType === 'mouse') return 'drag';
	return input.longPressFired ? 'drag' : 'scroll-abort';
}
