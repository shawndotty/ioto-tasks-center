import { buildTaskFileName, normalizeCustomTaskName } from './task-creation';
import type { TaskCreationType } from './task-template-config';

// 批量模板支持的任务类型（排除 date，因 date 文件名不接受 customName）
export const BATCH_TASK_TYPES: readonly TaskCreationType[] = [
	'normal',
	'topic',
	'plan',
] as const;
export type BatchTaskType = (typeof BATCH_TASK_TYPES)[number];

// 批量模板支持的最大层级类型数（超出层级回退 normal）
export const MAX_LEVEL_TASK_TYPES = 3;
export const DEFAULT_LEVEL_TASK_TYPES: readonly BatchTaskType[] = [
	'normal',
	'normal',
	'normal',
] as const;

export interface BatchTaskTemplate {
	id: string;
	name: string;
	levelTaskTypes: BatchTaskType[];
	listContent: string;
	projects: string[]; // 所属项目列表，空数组表示可被所有项目使用
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
	return value === 'normal' || value === 'topic' || value === 'plan';
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

function resolveIndentUnit(entries: Array<{ indent: number }>): number {
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

export function resolveTaskTypeForLevel(
	levelTaskTypes: BatchTaskType[],
	level: number,
): BatchTaskType {
	if (level < 0 || level >= levelTaskTypes.length) {
		return 'normal';
	}
	const taskType = levelTaskTypes[level];
	return isBatchTaskType(taskType) ? taskType : 'normal';
}

export function resolveMaxLevel(items: BatchTaskItem[]): number {
	let maxLevel = 0;
	for (const item of items) {
		if (item.level > maxLevel) {
			maxLevel = item.level;
		}
	}
	return maxLevel;
}

export function formatLevelTaskTypes(
	levelTaskTypes: BatchTaskType[],
	getLabel: (taskType: BatchTaskType) => string,
): string {
	const padded: BatchTaskType[] = [...DEFAULT_LEVEL_TASK_TYPES];
	const source = levelTaskTypes.length > 0 ? levelTaskTypes : padded;
	for (let i = 0; i < MAX_LEVEL_TASK_TYPES && i < source.length; i += 1) {
		const taskType = source[i];
		if (taskType) {
			padded[i] = taskType;
		}
	}
	return padded
		.map((taskType, index) => `L${index + 1}: ${getLabel(taskType)}`)
		.join(', ');
}

export function formatBatchItemsForPreview(
	items: BatchTaskItem[],
	prefix: string,
	levelTaskTypes: BatchTaskType[] = [...DEFAULT_LEVEL_TASK_TYPES],
): Array<{ indent: number; text: string; taskType: BatchTaskType }> {
	return items.map((item) => ({
		indent: item.level,
		text: applyPrefix(item.name, prefix),
		taskType: resolveTaskTypeForLevel(levelTaskTypes, item.level),
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

	const candidate = input as Partial<BatchTaskTemplate> & {
		taskType?: unknown;
	};
	const id =
		typeof candidate.id === 'string' && candidate.id.trim().length > 0
			? candidate.id.trim()
			: createBatchTemplateId();
	const name =
		typeof candidate.name === 'string' ? candidate.name.trim() : '';
	const levelTaskTypes = resolveLevelTaskTypes(candidate);
	const listContent =
		typeof candidate.listContent === 'string' ? candidate.listContent : '';
	const projects = resolveProjects(candidate.projects);

	return { id, name, levelTaskTypes, listContent, projects };
}

function resolveLevelTaskTypes(
	candidate: Partial<BatchTaskTemplate> & { taskType?: unknown },
): BatchTaskType[] {
	if (
		Array.isArray(candidate.levelTaskTypes) &&
		candidate.levelTaskTypes.length > 0
	) {
		const normalized = candidate.levelTaskTypes.map((entry) =>
			isBatchTaskType(entry) ? entry : 'normal',
		);
		return padLevelTaskTypes(normalized);
	}

	if (isBatchTaskType(candidate.taskType)) {
		const legacyType = candidate.taskType;
		return [legacyType, legacyType, legacyType];
	}

	return [...DEFAULT_LEVEL_TASK_TYPES];
}

function padLevelTaskTypes(types: BatchTaskType[]): BatchTaskType[] {
	const sliced = types.slice(0, MAX_LEVEL_TASK_TYPES);
	while (sliced.length < MAX_LEVEL_TASK_TYPES) {
		sliced.push('normal');
	}
	return sliced;
}

function resolveProjects(input: unknown): string[] {
	if (!Array.isArray(input)) {
		return [];
	}
	return input
		.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
		.filter((entry) => entry.length > 0);
}

export function isTemplateAvailableForProject(
	template: BatchTaskTemplate,
	projectName: string,
): boolean {
	if (!template.projects || template.projects.length === 0) {
		return true;
	}
	return template.projects.includes(projectName);
}

export function isBatchTemplateValid(template: BatchTaskTemplate): boolean {
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
			areLevelTaskTypesEqual(
				template.levelTaskTypes,
				other.levelTaskTypes,
			) &&
			template.listContent === other.listContent &&
			areProjectsEqual(template.projects, other.projects)
		);
	});
}

function areLevelTaskTypesEqual(
	left: BatchTaskType[],
	right: BatchTaskType[],
): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((type, index) => type === right[index]);
}

function areProjectsEqual(left: unknown, right: unknown): boolean {
	const leftArr: unknown[] = Array.isArray(left) ? left : [];
	const rightArr: unknown[] = Array.isArray(right) ? right : [];
	if (leftArr.length !== rightArr.length) {
		return false;
	}
	// 排序后比较，忽略顺序差异
	const sortedLeft = [...leftArr].sort();
	const sortedRight = [...rightArr].sort();
	return sortedLeft.every((project, index) => project === sortedRight[index]);
}

// 保持 normalizeCustomTaskName 可被外部复用（与 task-creation 行为一致）
export { normalizeCustomTaskName };
