/**
 * 任务类型推断：以文件名为唯一权威信号（[[Research-20261117-083812]] §4.1）。
 *
 * 零 `obsidian` 运行时依赖（日期用正则，不引 moment），零 IO，可单测。
 */

/** 与 `buildTaskFileName` 的产物顺序对齐：普通任务无项目前缀，放首位便于菜单展示。 */
export const QUADRANT_TASK_TYPES = ['normal', 'date', 'topic', 'plan'] as const;
export type QuadrantTaskType = (typeof QUADRANT_TASK_TYPES)[number];

/** 与 task.type.fileName.* 三语言对齐；创建时取当时语言，读取时全认。 */
const PLAN_MARKERS = ['计划', '計畫', 'Plan'];
const TOPIC_MARKERS = ['主题', '主題', 'Subject'];

export const DATE_PATTERNS: readonly RegExp[] = [
	/^\d{4}-\d{2}-\d{2}$/, // YYYY-MM-DD  —— 当前配置
	/^\d{4}-\d{2}-W$/, // YYYY-MM-W   —— 本库遗留周格式
	/^\d{4}-W\d{2}$/, // YYYY-Www
	/^\d{4}-\d{2}-\d{2}-W\d{2}$/, // YYYY-MM-DD-Www
	/^\d{4}年\d{1,2}月\d{1,2}日$/, // 中文日期（dateTaskDateFormat 可配置）
];

export function isQuadrantTaskType(value: unknown): value is QuadrantTaskType {
	return (
		typeof value === 'string' &&
		(QUADRANT_TASK_TYPES as readonly string[]).includes(value)
	);
}

/**
 * 只认「项目名-」之后的首段做标记判定；日期整段锚定 `rest`。
 * 顺序即优先级：plan/topic 先于 date，避免 `项目-计划-2026-06-24` 被判成日期型。
 */
export function inferTaskType(
	basename: string,
	projectName: string,
): QuadrantTaskType {
	const prefix = `${projectName.trim()}-`;
	const rest =
		projectName.trim() && basename.startsWith(prefix)
			? basename.slice(prefix.length)
			: basename;
	const head = rest.split('-')[0] ?? '';
	if (PLAN_MARKERS.includes(head)) return 'plan';
	if (TOPIC_MARKERS.includes(head)) return 'topic';
	if (DATE_PATTERNS.some((re) => re.test(rest))) return 'date';
	return 'normal';
}
