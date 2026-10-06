/**
 * Task View「条目模板」的纯数据层（[[Plan-20261006-225329]] §二/§三）。
 *
 * 与 `batch-task-template.ts` 同风格：类型 + 纯函数，**零 obsidian 依赖**
 * （仅 `moment`），可被 `node --test` + jiti 直接导入单测。
 *
 * 模板正文是一段可多行的条目文本：可以含 `{{变量}}` / `#ioto/*` 控制项 /
 * `%%Cursor%%` 落点标记；创建时弹窗收集变量，插到选中卡下方。
 */

/* eslint-disable no-restricted-imports, import/no-extraneous-dependencies */
import moment from 'moment';

import {
	continuationIndentForTaskLine,
	indentLevelOf,
	splitTaskLine,
} from './note-structure';
import { stripCursorMarkers } from './cursor-marker';

export interface TaskEntryTemplate {
	/** 稳定 id（增删改的定位键） */
	id: string;
	/** 选择器展示名 */
	name: string;
	/** 可选说明（选择器副标题） */
	description?: string;
	/** 模板正文：可多行、可含 `{{变量}}` / `#ioto/*` / `%%Cursor%%` */
	content: string;
	/** 项目范围，空数组 = 所有项目可用 */
	projects: string[];
}

export interface EntryTemplateConfig {
	enabled: boolean;
	templates: TaskEntryTemplate[];
}

export const DEFAULT_ENTRY_TEMPLATE_CONFIG: EntryTemplateConfig = {
	enabled: false,
	templates: [],
};

/** 内置变量名（自动解析，不作为提示变量弹窗收集）。 */
export const ENTRY_TEMPLATE_BUILTIN_VARIABLES: readonly string[] = [
	'date',
	'time',
	'project',
	'subject',
	'cursor',
];

const BUILTIN_VARIABLE_SET = new Set<string>(
	ENTRY_TEMPLATE_BUILTIN_VARIABLES,
);

/** 匹配 `{{…}}`，可带一个反斜杠转义前缀（`\{{` 输出字面 `{{`）。 */
const VARIABLE_TOKEN_PATTERN = /(\\)?\{\{([^{}]*)\}\}/g;

export function createEntryTemplateId(): string {
	try {
		if (typeof crypto !== 'undefined' && crypto.randomUUID) {
			return crypto.randomUUID();
		}
	} catch {
		// 回退到时间戳 + 随机数
	}

	return `entry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ------------------------------------------------------------------ *
 * 规范化与校验
 * ------------------------------------------------------------------ */

export function normalizeEntryTemplate(
	input: unknown,
): TaskEntryTemplate | null {
	if (!input || typeof input !== 'object') {
		return null;
	}

	const candidate = input as Partial<TaskEntryTemplate>;
	const id =
		typeof candidate.id === 'string' && candidate.id.trim().length > 0
			? candidate.id.trim()
			: createEntryTemplateId();
	const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
	const rawDescription =
		typeof candidate.description === 'string'
			? candidate.description.trim()
			: '';
	const content =
		typeof candidate.content === 'string' ? candidate.content : '';
	const projects = resolveProjects(candidate.projects);
	const template: TaskEntryTemplate = {
		id,
		name,
		content,
		projects,
	};
	if (rawDescription.length > 0) {
		template.description = rawDescription;
	}
	return template;
}

export function normalizeEntryTemplateConfig(
	input: unknown,
): EntryTemplateConfig {
	if (!input || typeof input !== 'object') {
		return { ...DEFAULT_ENTRY_TEMPLATE_CONFIG };
	}

	const candidate = input as Partial<EntryTemplateConfig>;
	const enabled =
		typeof candidate.enabled === 'boolean'
			? candidate.enabled
			: DEFAULT_ENTRY_TEMPLATE_CONFIG.enabled;
	const templates = Array.isArray(candidate.templates)
		? candidate.templates
				.map((entry) => normalizeEntryTemplate(entry))
				.filter((entry): entry is TaskEntryTemplate => entry !== null)
		: [];

	return { enabled, templates };
}

function resolveProjects(input: unknown): string[] {
	if (!Array.isArray(input)) {
		return [];
	}
	return input
		.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
		.filter((entry) => entry.length > 0);
}

/**
 * 合法模板：`name` 非空、正文至少含一条任务行、**首个非空行必须是任务行**
 * （否则插入的「首行」不是卡片行，落点与光标语义都无处安放）。
 */
export function isEntryTemplateValid(template: TaskEntryTemplate): boolean {
	if (!template.name.trim()) {
		return false;
	}

	const lines = template.content.split(/\r?\n/);
	let firstTaskSeen = false;
	for (const line of lines) {
		if (line.trim().length === 0) {
			continue;
		}
		const parts = splitTaskLine(line);
		if (!firstTaskSeen) {
			if (!parts) {
				return false;
			}
			firstTaskSeen = true;
		}
	}
	return firstTaskSeen;
}

export function areEntryTemplateConfigsEqual(
	left: EntryTemplateConfig,
	right: EntryTemplateConfig,
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
			(template.description ?? '') === (other.description ?? '') &&
			template.content === other.content &&
			areProjectsEqual(template.projects, other.projects)
		);
	});
}

function areProjectsEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	const sortedLeft = [...left].sort();
	const sortedRight = [...right].sort();
	return sortedLeft.every((project, index) => project === sortedRight[index]);
}

/* ------------------------------------------------------------------ *
 * 变量引擎
 * ------------------------------------------------------------------ */

export interface EntryTemplateVariable {
	name: string;
	defaultValue: string | null;
}

interface ParsedVariableToken {
	name: string;
	defaultValue: string | null;
}

function parseVariableInner(inner: string): ParsedVariableToken | null {
	const separatorIndex = inner.indexOf(':');
	const rawName =
		separatorIndex === -1 ? inner : inner.slice(0, separatorIndex);
	const name = rawName.trim();
	if (name.length === 0) {
		return null;
	}
	const defaultValue =
		separatorIndex === -1 ? null : inner.slice(separatorIndex + 1);
	return { name, defaultValue };
}

/**
 * 按出现顺序抽取「提示变量」并去重；排除内置名（date/time/project/subject/cursor）。
 * `\{{` 转义与空名 token 不参与抽取。
 */
export function extractEntryTemplateVariables(
	content: string,
): EntryTemplateVariable[] {
	const ordered: EntryTemplateVariable[] = [];
	const indexByName = new Map<string, number>();

	VARIABLE_TOKEN_PATTERN.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = VARIABLE_TOKEN_PATTERN.exec(content)) !== null) {
		if (match[1] === '\\') {
			continue;
		}
		const parsed = parseVariableInner(match[2] ?? '');
		if (!parsed || BUILTIN_VARIABLE_SET.has(parsed.name)) {
			continue;
		}

		const existingIndex = indexByName.get(parsed.name);
		if (existingIndex === undefined) {
			indexByName.set(parsed.name, ordered.length);
			ordered.push({
				name: parsed.name,
				defaultValue: parsed.defaultValue,
			});
			continue;
		}

		const existing = ordered[existingIndex];
		if (existing && existing.defaultValue === null && parsed.defaultValue) {
			existing.defaultValue = parsed.defaultValue;
		}
	}

	return ordered;
}

export interface EntryTemplateRenderContext {
	now: Date;
	project: string;
	subject: string;
}

/**
 * 求值：替换内置变量与提示变量、处理 `\{{` 转义；`%%Cursor%%` / `{{cursor}}`
 * 之外的文本不改动。
 */
export function renderEntryTemplate(
	content: string,
	values: Record<string, string>,
	context: EntryTemplateRenderContext,
): string {
	return content.replace(
		VARIABLE_TOKEN_PATTERN,
		(full, escape: string | undefined, inner: string | undefined) => {
			if (escape === '\\') {
				return `{{${inner ?? ''}}}`;
			}
			const parsed = parseVariableInner(inner ?? '');
			if (!parsed) {
				return full;
			}
			return resolveVariable(parsed, values, context);
		},
	);
}

function resolveVariable(
	token: ParsedVariableToken,
	values: Record<string, string>,
	context: EntryTemplateRenderContext,
): string {
	switch (token.name) {
		case 'date':
			return moment(context.now).format(token.defaultValue ?? 'YYYY-MM-DD');
		case 'time':
			return moment(context.now).format(token.defaultValue ?? 'HH:mm');
		case 'project':
			return context.project;
		case 'subject':
			return context.subject;
		case 'cursor':
			return '%%Cursor%%';
		default:
			return values[token.name] ?? token.defaultValue ?? '';
	}
}

/* ------------------------------------------------------------------ *
 * 缩进重定位与光标换算
 * ------------------------------------------------------------------ */

export interface EntryTemplateAnchor {
	/** 锚点原始行（任务行自身），用于推导续行缩进 */
	line: string;
	/** 锚点缩进层级（0 基） */
	indentLevel: number;
	/** 锚点列表符（含其后空白），首行沿用 */
	listMarker: string;
}

export interface EntryTemplateLinesResult {
	lines: string[];
	firstLineCursorOffset: number | null;
}

const TASK_LINE_PARTS_PATTERN =
	/^([ \t]*)((?:[-*+]|\d+\.)[ \t]+)\[([ xX])\]([ \t]*)([\s\S]*)$/;

/**
 * 把已求值的模板文本按「锚点行」重定位成物理行。
 *
 * - 任务行：缩进 = `anchor.indentLevel + (lineLevel - baseLevel)`（clamp ≥ 0）；
 *   列表符号首行沿用锚点、其余 `- `；勾选态恒空格。
 * - 非任务行：作为续行块，缩进 = `continuationIndentForTaskLine(anchor.line)`
 *   叠加模板内相对层级。
 * - 返回光标偏移（相对首行 body；`null` = 无标记或标记不在首行）。
 */
export function buildEntryTemplateLines(
	rendered: string,
	anchor: EntryTemplateAnchor,
): EntryTemplateLinesResult {
	const stripped = stripCursorMarkers(rendered);
	const allLines = stripped.content.split(/\r?\n/);

	let firstTaskIndex = -1;
	for (let index = 0; index < allLines.length; index += 1) {
		if (splitTaskLine(allLines[index] ?? '') !== null) {
			firstTaskIndex = index;
			break;
		}
	}
	if (firstTaskIndex === -1) {
		return { lines: [], firstLineCursorOffset: null };
	}

	let baseLevel = Number.POSITIVE_INFINITY;
	for (const line of allLines) {
		const parts = splitTaskLine(line);
		if (parts) {
			baseLevel = Math.min(baseLevel, indentLevelOf(parts.indent));
		}
	}
	if (!Number.isFinite(baseLevel)) {
		baseLevel = 0;
	}

	const continuationIndent =
		continuationIndentForTaskLine(anchor.line) ??
		'  '.repeat(Math.max(0, anchor.indentLevel + 1));

	const lines: string[] = [];
	let isFirstTask = true;
	for (let index = firstTaskIndex; index < allLines.length; index += 1) {
		const line = allLines[index] ?? '';
		const parts = splitTaskLine(line);

		if (parts) {
			const level = indentLevelOf(parts.indent);
			const outputLevel = Math.max(
				0,
				anchor.indentLevel + (level - baseLevel),
			);
			const indent = '  '.repeat(outputLevel);
			const listMarker = isFirstTask ? anchor.listMarker : '- ';
			lines.push(
				`${indent}${listMarker}[ ] ${composeBodyWithControls(parts)}`,
			);
			isFirstTask = false;
			continue;
		}

		if (line.trim().length === 0) {
			lines.push('');
			continue;
		}

		const leading = line.match(/^[ \t]*/)?.[0] ?? '';
		const relativeLevel = Math.max(0, indentLevelOf(leading) - baseLevel);
		lines.push(
			`${continuationIndent}${'  '.repeat(relativeLevel)}${line.trimStart()}`,
		);
	}

	let firstLineCursorOffset: number | null = null;
	const firstOffset = stripped.firstOffset;
	if (firstOffset !== null) {
		const location = locateOffset(allLines, firstOffset);
		if (location && location.lineIndex === firstTaskIndex) {
			firstLineCursorOffset = mapOffsetToBodyOffset(
				allLines[firstTaskIndex] ?? '',
				location.column,
			);
		}
	}

	return { lines, firstLineCursorOffset };
}

function composeBodyWithControls(
	parts: NonNullable<ReturnType<typeof splitTaskLine>>,
): string {
	const controlText = parts.controls.map((control) => control.raw).join(' ');
	if (controlText.length === 0) {
		return parts.body;
	}
	return parts.body.length > 0 ? `${parts.body} ${controlText}` : controlText;
}

function locateOffset(
	lines: string[],
	offset: number,
): { lineIndex: number; column: number } | null {
	let cursor = 0;
	for (let index = 0; index < lines.length; index += 1) {
		const length = (lines[index] ?? '').length;
		if (offset <= cursor + length) {
			return { lineIndex: index, column: offset - cursor };
		}
		cursor += length + 1;
	}
	return null;
}

/**
 * 把「行内绝对偏移」换算成「剥离控制项后的 body 偏移」。
 * 控制项被移到行尾，故 `body` 之前的控制项长度不计入。
 */
function mapOffsetToBodyOffset(line: string, column: number): number | null {
	const match = line.match(TASK_LINE_PARTS_PATTERN);
	if (!match) {
		return null;
	}

	const prefixLength =
		(match[1] ?? '').length +
		(match[2] ?? '').length +
		3 /* [x] */ +
		(match[4] ?? '').length;
	const core = match[5] ?? '';
	const offsetInCore = column - prefixLength;
	if (offsetInCore <= 0) {
		return 0;
	}

	const coreBefore = core.slice(0, offsetInCore);
	const bodyBefore = splitTaskLine(`- [ ] ${coreBefore}`)?.body ?? '';
	const body = splitTaskLine(line)?.body ?? '';
	return Math.min(bodyBefore.length, body.length);
}
