import {
	buildTaskFileName,
	normalizeCustomTaskName,
} from './task-creation';
import type { TaskCreationType } from './task-template-config';

// 批量模板支持的任务类型（排除 date，因 date 文件名不接受 customName）
export const BATCH_TASK_TYPES: readonly TaskCreationType[] = [
	'normal',
	'topic',
	'plan',
] as const;
export type BatchTaskType = (typeof BATCH_TASK_TYPES)[number];

export interface BatchTaskTemplate {
	id: string;
	name: string;
	taskType: BatchTaskType;
	listContent: string;
}

export interface BatchTemplateConfig {
	enabled: boolean;
	templates: BatchTaskTemplate[];
}

export interface BatchTaskItem {
	name: string;
	level: number;
	parentIndex: number | null;
}

export const DEFAULT_BATCH_TEMPLATE_CONFIG: BatchTemplateConfig = {
	enabled: false,
	templates: [],
};

const LIST_ITEM_PATTERN = /^(\s*)-\s+(.+?)\s*$/;
const DEFAULT_INDENT_UNIT = 2;

export function createBatchTemplateId(): string {
	try {
		if (typeof crypto !== 'undefined' && crypto.randomUUID) {
			return crypto.randomUUID();
		}
	} catch {
		// 回退到时间戳 + 随机数
	}

	return `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isBatchTaskType(value: unknown): value is BatchTaskType {
	return (
		value === 'normal' || value === 'topic' || value === 'plan'
	);
}

export function parseBatchList(content: string): BatchTaskItem[] {
	if (typeof content !== 'string' || content.length === 0) {
		return [];
	}

	const lines = content.split(/\r?\n/);
	const rawEntries: Array<{ indent: number; name: string }> = [];

	for (const line of lines) {
		const match = line.match(LIST_ITEM_PATTERN);
		if (!match) {
			continue;
		}

		const indent = match[1] ?? '';
		const rawName = match[2] ?? '';
		const trimmedName = rawName.trim();
		if (!trimmedName) {
			continue;
		}

		rawEntries.push({
			indent: computeRawIndent(indent),
			name: trimmedName,
		});
	}

	if (rawEntries.length === 0) {
		return [];
	}

	// 自动检测缩进单位：取首个非零缩进作为 1 个层级单位
	const indentUnit = resolveIndentUnit(rawEntries);

	const items: BatchTaskItem[] = [];
	for (const entry of rawEntries) {
		const level = Math.floor(entry.indent / indentUnit);
		const parentIndex = resolveParentIndex(items, level);
		items.push({
			name: entry.name,
			level,
			parentIndex,
		});
	}

	return items;
}

function computeRawIndent(indent: string): number {
	let spaces = 0;
	for (const ch of indent) {
		if (ch === '\t') {
			spaces += 4;
		} else {
			spaces += 1;
		}
	}
	return spaces;
}

function resolveIndentUnit(
	entries: Array<{ indent: number }>,
): number {
	for (const entry of entries) {
		if (entry.indent > 0) {
			return entry.indent;
		}
	}
	return DEFAULT_INDENT_UNIT;
}

function resolveParentIndex(
	items: BatchTaskItem[],
	currentLevel: number,
): number | null {
	for (let i = items.length - 1; i >= 0; i -= 1) {
		const candidate = items[i];
		if (!candidate) {
			continue;
		}
		if (candidate.level < currentLevel) {
			return i;
		}
	}
	return null;
}

export function applyPrefix(name: string, prefix: string): string {
	return `${prefix ?? ''}${name ?? ''}`;
}

export function formatBatchItemsForPreview(
	items: BatchTaskItem[],
	prefix: string,
): Array<{ indent: number; text: string }> {
	return items.map((item) => ({
		indent: item.level,
		text: applyPrefix(item.name, prefix),
	}));
}

export function buildBatchTaskTitleForUpTask(
	projectName: string,
	taskType: BatchTaskType,
	fullName: string,
): string {
	const fileName = buildTaskFileName(
		projectName,
		taskType,
		new Date(),
		'YYYY-MM-DD',
		fullName,
	);
	return fileName.replace(/\.md$/i, '');
}

export function normalizeBatchTemplateConfig(
	input: unknown,
): BatchTemplateConfig {
	if (!input || typeof input !== 'object') {
		return { ...DEFAULT_BATCH_TEMPLATE_CONFIG };
	}

	const candidate = input as Partial<BatchTemplateConfig>;
	const enabled =
		typeof candidate.enabled === 'boolean'
			? candidate.enabled
			: DEFAULT_BATCH_TEMPLATE_CONFIG.enabled;
	const templates = Array.isArray(candidate.templates)
		? candidate.templates
				.map((entry) => normalizeBatchTemplate(entry))
				.filter((entry): entry is BatchTaskTemplate => entry !== null)
		: [];

	return { enabled, templates };
}

export function normalizeBatchTemplate(
	input: unknown,
): BatchTaskTemplate | null {
	if (!input || typeof input !== 'object') {
		return null;
	}

	const candidate = input as Partial<BatchTaskTemplate>;
	const id =
		typeof candidate.id === 'string' && candidate.id.trim().length > 0
			? candidate.id.trim()
			: createBatchTemplateId();
	const name =
		typeof candidate.name === 'string' ? candidate.name.trim() : '';
	const taskType = isBatchTaskType(candidate.taskType)
		? candidate.taskType
		: 'normal';
	const listContent =
		typeof candidate.listContent === 'string' ? candidate.listContent : '';

	return { id, name, taskType, listContent };
}

export function isBatchTemplateValid(
	template: BatchTaskTemplate,
): boolean {
	if (!template.name.trim()) {
		return false;
	}
	const items = parseBatchList(template.listContent);
	return items.length > 0;
}

export function areBatchTemplateConfigsEqual(
	left: BatchTemplateConfig,
	right: BatchTemplateConfig,
): boolean {
	if (left.enabled !== right.enabled) {
		return false;
	}
	if (left.templates.length !== right.templates.length) {
		return false;
	}
	return left.templates.every((template, index) => {
		const other = right.templates[index];
		if (!other) {
			return false;
		}
		return (
			template.id === other.id &&
			template.name === other.name &&
			template.taskType === other.taskType &&
			template.listContent === other.listContent
		);
	});
}

// 保持 normalizeCustomTaskName 可被外部复用（与 task-creation 行为一致）
export { normalizeCustomTaskName };
