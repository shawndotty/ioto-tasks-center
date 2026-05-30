export const TASK_TEMPLATE_TASK_TYPES = [
	'date',
	'plan',
	'topic',
	'normal',
] as const;

export type TaskCreationType = (typeof TASK_TEMPLATE_TASK_TYPES)[number];
export type TaskTemplateSourceMode = 'file' | 'inline';

export interface TaskTemplateConfig {
	sourceMode: TaskTemplateSourceMode;
	templatePath: string;
	inlineContent: string;
}

export type TaskTemplateConfigMap = Record<TaskCreationType, TaskTemplateConfig>;

export type ResolvedTaskTemplateSource =
	| {
			kind: 'file';
			templatePath: string;
	  }
	| {
			kind: 'inline';
			inlineContent: string;
	  }
	| {
			kind: 'none';
	  };

export const DEFAULT_TASK_TEMPLATE_CONFIG: TaskTemplateConfig = {
	sourceMode: 'file',
	templatePath: '',
	inlineContent: '',
};

export function createDefaultTaskTemplateConfigMap(): TaskTemplateConfigMap {
	return {
		date: { ...DEFAULT_TASK_TEMPLATE_CONFIG },
		plan: { ...DEFAULT_TASK_TEMPLATE_CONFIG },
		topic: { ...DEFAULT_TASK_TEMPLATE_CONFIG },
		normal: { ...DEFAULT_TASK_TEMPLATE_CONFIG },
	};
}

export function normalizeTaskTemplateSourceMode(
	value: unknown,
): TaskTemplateSourceMode {
	return value === 'inline' ? 'inline' : 'file';
}

export function normalizeTaskTemplateConfig(
	value: unknown,
): TaskTemplateConfig {
	if (!value || typeof value !== 'object') {
		return { ...DEFAULT_TASK_TEMPLATE_CONFIG };
	}

	const candidate = value as Partial<TaskTemplateConfig>;
	return {
		sourceMode: normalizeTaskTemplateSourceMode(candidate.sourceMode),
		templatePath:
			typeof candidate.templatePath === 'string'
				? candidate.templatePath.trim()
				: '',
		inlineContent:
			typeof candidate.inlineContent === 'string'
				? candidate.inlineContent
				: '',
	};
}

export function normalizeTaskTemplateConfigMap(
	value: unknown,
	legacyTemplatePath?: string,
): TaskTemplateConfigMap {
	const defaults = createDefaultTaskTemplateConfigMap();
	if (value && typeof value === 'object') {
		for (const taskType of TASK_TEMPLATE_TASK_TYPES) {
			defaults[taskType] = normalizeTaskTemplateConfig(
				(value as Partial<Record<TaskCreationType, unknown>>)[taskType],
			);
		}
	}

	const normalizedLegacyTemplatePath = legacyTemplatePath?.trim() ?? '';
	if (
		normalizedLegacyTemplatePath &&
		!hasAnyConfiguredTaskTemplate(defaults)
	) {
		for (const taskType of TASK_TEMPLATE_TASK_TYPES) {
			defaults[taskType] = {
				sourceMode: 'file',
				templatePath: normalizedLegacyTemplatePath,
				inlineContent: '',
			};
		}
	}

	return defaults;
}

export function hasAnyConfiguredTaskTemplate(
	configMap: TaskTemplateConfigMap,
): boolean {
	return TASK_TEMPLATE_TASK_TYPES.some((taskType) => {
		const config = configMap[taskType];
		return (
			config.templatePath.trim().length > 0 ||
			config.inlineContent.trim().length > 0
		);
	});
}

export function resolveTaskTemplateSource(
	config: TaskTemplateConfig,
): ResolvedTaskTemplateSource {
	const normalizedConfig = normalizeTaskTemplateConfig(config);

	if (normalizedConfig.sourceMode === 'inline') {
		return normalizedConfig.inlineContent.trim().length > 0
			? {
					kind: 'inline',
					inlineContent: normalizedConfig.inlineContent,
				}
			: { kind: 'none' };
	}

	return normalizedConfig.templatePath
		? {
				kind: 'file',
				templatePath: normalizedConfig.templatePath,
			}
		: { kind: 'none' };
}

export function areTaskTemplateConfigsEqual(
	left: TaskTemplateConfig,
	right: TaskTemplateConfig,
): boolean {
	return (
		left.sourceMode === right.sourceMode &&
		left.templatePath === right.templatePath &&
		left.inlineContent === right.inlineContent
	);
}

export function mergeTaskTemplateConfig(
	current: TaskTemplateConfig,
	patch: Partial<TaskTemplateConfig>,
): TaskTemplateConfig {
	return normalizeTaskTemplateConfig({
		...current,
		...patch,
	});
}
