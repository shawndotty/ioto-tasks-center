/**
 * 项目范围的字符串编解码（[[Plan-20261116-161225]] §三 步骤 1）。
 *
 * 独立叶子模块：零 `obsidian` 运行时依赖，可被 `constants` / `filter-storage`
 * 直接 jiti 直载；编码形状与 `timeFilter: "preset:..."` 同风格。
 */

import type { QuadrantProjectScope } from '../../tasks-center/quadrant-data';

export function encodeQuadrantScope(scope: QuadrantProjectScope): string {
	if (scope.kind === 'project') {
		return `project:${scope.projectName ?? ''}`;
	}
	return scope.kind;
}

/** 外部输入（leaf state / localStorage）严格解析：非法值返回 undefined，不伪装成「全部」。 */
export function parseQuadrantProjectScope(
	value: unknown,
): QuadrantProjectScope | undefined {
	if (typeof value !== 'string') return undefined;
	if (value === 'all') return { kind: 'all' };
	// 历史值：三态时期「未归档」与现在的「全部」语义等同，静默迁移（[[Plan-20261117-092238]] §5.4）。
	if (value === 'unarchived') return { kind: 'all' };
	if (!value.startsWith('project:')) return undefined;
	const projectName = value.slice('project:'.length);
	// `project:` 前缀天然容纳项目名里的冒号；空名视为脏数据。
	return projectName.length > 0
		? { kind: 'project', projectName }
		: undefined;
}

/** 下拉框用「永不失败」版本，保持 filter-bar 既有行为。 */
export function decodeQuadrantScope(value: string): QuadrantProjectScope {
	return parseQuadrantProjectScope(value) ?? { kind: 'all' };
}
