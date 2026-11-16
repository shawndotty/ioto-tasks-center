/**
 * 四象限时间过滤的纯模型（[[Plan-20261116-083330]] §3.1）。
 *
 * 预设窗口与任务中心 `filterTasksByTime` 口径逐位一致；任务中心已改为委托本模块，
 * 预设边界只保留这一份实现。零 DOM、零 i18n、零 `obsidian` 运行时。
 */

import type { TaskFileEntry } from './types';

export type TaskTimeField = 'created' | 'updated';

export const QUADRANT_TIME_PRESET_KEYS = [
	'created-week',
	'created-two-weeks',
	'created-month',
	'created-calendar-week',
	'created-calendar-month',
	'updated-week',
	'updated-two-weeks',
	'updated-month',
	'updated-calendar-week',
	'updated-calendar-month',
] as const;

export type QuadrantTimePreset = (typeof QUADRANT_TIME_PRESET_KEYS)[number];

export type QuadrantTimeFilter =
	| { kind: 'none' }
	| { kind: 'preset'; value: QuadrantTimePreset }
	| {
			kind: 'custom';
			field: TaskTimeField;
			/** `YYYY-MM-DD`，空串 / undefined = 该端开放 */
			start?: string;
			end?: string;
	  };

export interface TaskTimeBounds {
	field: TaskTimeField;
	/** 含 */
	startMs?: number;
	/** 含 */
	endMs?: number;
}

const PRESET_KEYS: ReadonlySet<string> = new Set(QUADRANT_TIME_PRESET_KEYS);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const TWO_WEEKS_MS = 14 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function startOfCalendarWeek(nowMs: number): number {
	const now = new Date(nowMs);
	const dayOfWeek = now.getDay();
	const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
	return new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() + mondayOffset,
	).getTime();
}

function presetField(preset: QuadrantTimePreset): TaskTimeField {
	return preset.startsWith('created') ? 'created' : 'updated';
}

function presetStartMs(preset: QuadrantTimePreset, nowMs: number): number {
	if (preset.endsWith('calendar-week')) return startOfCalendarWeek(nowMs);
	if (preset.endsWith('calendar-month')) {
		const now = new Date(nowMs);
		return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
	}
	if (preset.endsWith('two-weeks')) return nowMs - TWO_WEEKS_MS;
	if (preset.endsWith('-month')) return nowMs - MONTH_MS;
	return nowMs - WEEK_MS;
}

/** 本地日期字符串 → 当日 00:00:00.000 的毫秒；非法 / 不存在的日期返回 null。 */
function parseLocalDateStart(value: string): number | null {
	const match = DATE_PATTERN.exec(value.trim());
	if (!match) return null;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const date = new Date(year, month - 1, day);
	// 回读分量一致：拒绝 `2026-02-30` 这类被 Date 自动进位的日期。
	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return null;
	}
	return date.getTime();
}

/** 结束日 → 次日 00:00 减 1ms；按本地日期进位，跨 DST 不叠加固定 24h。 */
function parseLocalDateEnd(value: string): number | null {
	const startMs = parseLocalDateStart(value);
	if (startMs === null) return null;
	const start = new Date(startMs);
	return (
		new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1).getTime() -
		1
	);
}

export function validateCustomRange(
	start: string,
	end: string,
): 'ok' | 'empty' | 'invalid-order' | 'invalid-date' {
	const startText = start.trim();
	const endText = end.trim();
	if (startText.length === 0 && endText.length === 0) return 'empty';

	const startMs =
		startText.length === 0 ? null : parseLocalDateStart(startText);
	const endMs = endText.length === 0 ? null : parseLocalDateStart(endText);
	if (
		(startText.length > 0 && startMs === null) ||
		(endText.length > 0 && endMs === null)
	) {
		return 'invalid-date';
	}
	if (startMs !== null && endMs !== null && startMs > endMs) {
		return 'invalid-order';
	}
	return 'ok';
}

/** 过滤器 → 区间；`null` 表示不按时间过滤（关闭 / 双端为空 / 非法）。 */
export function resolveTaskTimeBounds(
	filter: QuadrantTimeFilter,
	nowMs: number,
): TaskTimeBounds | null {
	if (filter.kind === 'none') return null;
	if (filter.kind === 'preset') {
		return {
			field: presetField(filter.value),
			startMs: presetStartMs(filter.value, nowMs),
		};
	}

	const startText = (filter.start ?? '').trim();
	const endText = (filter.end ?? '').trim();
	if (startText.length === 0 && endText.length === 0) return null;
	if (validateCustomRange(startText, endText) !== 'ok') return null;

	const startMs =
		startText.length === 0 ? null : parseLocalDateStart(startText);
	const endMs = endText.length === 0 ? null : parseLocalDateEnd(endText);
	if (startMs === null && endMs === null) return null;
	return {
		field: filter.field,
		startMs: startMs ?? undefined,
		endMs: endMs ?? undefined,
	};
}

export function isTaskInTimeBounds(
	task: Pick<TaskFileEntry, 'ctime' | 'mtime'>,
	bounds: TaskTimeBounds,
): boolean {
	const time = bounds.field === 'created' ? task.ctime : task.mtime;
	if (bounds.startMs !== undefined && time < bounds.startMs) return false;
	if (bounds.endMs !== undefined && time > bounds.endMs) return false;
	return true;
}

export function encodeQuadrantTimeFilter(filter: QuadrantTimeFilter): string {
	switch (filter.kind) {
		case 'none':
			return 'none';
		case 'preset':
			return `preset:${filter.value}`;
		case 'custom':
			return `custom:${filter.field}:${filter.start ?? ''}:${filter.end ?? ''}`;
	}
}

/** 脏数据一律回落 `{ kind: 'none' }`，不抛错。 */
export function decodeQuadrantTimeFilter(value: unknown): QuadrantTimeFilter {
	if (typeof value !== 'string') return { kind: 'none' };
	if (value === 'none') return { kind: 'none' };

	if (value.startsWith('preset:')) {
		const preset = value.slice('preset:'.length);
		return PRESET_KEYS.has(preset)
			? { kind: 'preset', value: preset as QuadrantTimePreset }
			: { kind: 'none' };
	}

	if (value.startsWith('custom:')) {
		const parts = value.slice('custom:'.length).split(':');
		if (parts.length !== 3) return { kind: 'none' };
		const [field, start = '', end = ''] = parts;
		if (field !== 'created' && field !== 'updated') return { kind: 'none' };
		if (validateCustomRange(start, end) !== 'ok') return { kind: 'none' };
		return { kind: 'custom', field, start, end };
	}

	return { kind: 'none' };
}

function pad2(value: number): string {
	return String(value).padStart(2, '0');
}

export function toLocalDateString(ms: number): string {
	const date = new Date(ms);
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
		date.getDate(),
	)}`;
}

/** 同年只显示 `MM-DD`，跨年补全年份。 */
export function shortDate(dateStr: string, nowMs: number): string {
	const match = DATE_PATTERN.exec(dateStr.trim());
	if (!match) return dateStr;
	const now = new Date(nowMs);
	if (Number(match[1]) === now.getFullYear()) {
		return `${match[2]}-${match[3]}`;
	}
	return `${match[1]}-${match[2]}-${match[3]}`;
}
