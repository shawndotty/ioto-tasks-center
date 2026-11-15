/**
 * 优先级四象限视图的常量（[[Plan-20261115-201917]] §3.4 / §五 #2）。
 *
 * 视图类型刻意放在独立叶子模块：`task-view-routing` 只依赖常量、不依赖视图类，
 * 避免「routing → view → routing」的值级环。
 */

export const IOTO_PRIORITY_QUADRANT_VIEW_TYPE = 'IOTOPriorityQuadrant';

export const QUADRANT_COMPACT_BREAKPOINT = 720;

export const QUADRANT_LOADING_RENDER_DELAY_MS = 120;

export const QUADRANT_BODY_CLASS = 'ioto-pq-body';

export const QUADRANT_CARD_CLASS = 'ioto-pq-card';
