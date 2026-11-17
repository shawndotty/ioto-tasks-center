/**
 * 四象限「创建任务」的项目解析纯逻辑（[[Plan-20261116-145111]] §4.1）。
 *
 * 按当前项目范围把候选项目收敛成三态：可直接创建 / 需要用户选择 / 无可用项目。
 * 候选集已由扫描层收敛为未归档项目（[[Plan-20261117-092238]] §5.6），这里不做二次过滤。
 * 零 DOM、零 i18n、零 `obsidian` 运行时；只允许 `import type` + 同层纯模块。
 */

import type { QuadrantProjectScope } from './quadrant-data';

/** 与 `views/quadrant/data-loader` 的 `QuadrantProjectOption` 结构一致；扫描层已排除归档项目。 */
export interface QuadrantCreateProjectCandidate {
	name: string;
}

export type QuadrantCreateProjectResolution =
	| { kind: 'project'; projectName: string }
	| { kind: 'pick'; candidates: QuadrantCreateProjectCandidate[] }
	| { kind: 'none' };

export function resolveQuadrantCreateProject(
	scope: QuadrantProjectScope,
	options: readonly QuadrantCreateProjectCandidate[],
): QuadrantCreateProjectResolution {
	if (scope.kind === 'project') {
		const projectName = scope.projectName ?? '';
		if (!projectName) return { kind: 'none' };
		return options.some((option) => option.name === projectName)
			? { kind: 'project', projectName }
			: { kind: 'none' };
	}

	// 候选顺序保持传入（扫描）顺序；返回副本，不修改调用方数组与对象。
	const candidates = options.map((option) => ({ name: option.name }));

	const [onlyCandidate] = candidates;
	if (!onlyCandidate) return { kind: 'none' };
	if (candidates.length === 1) {
		return { kind: 'project', projectName: onlyCandidate.name };
	}
	return { kind: 'pick', candidates };
}