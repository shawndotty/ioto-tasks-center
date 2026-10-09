/**
 * 依赖门禁：只禁止「值级」循环依赖（运行期真实成环）。
 *
 * 设计说明（见 Plan-20261009-142035 §六）：
 * - 本仓存在大量**类型级**环（`import type` 反向引用宿主），它们是既有设计，
 *   靠编译期擦除保证运行期不成环，**必须放行**。
 * - `tsPreCompilationDeps: false` 表示「不把 type-only（`import type`）依赖纳入依赖图」，
 *   于是环检测只在**值图**上进行 → 类型级环天然不参与、不会被误报。
 *
 * ⚠️ 不要改成 `tsPreCompilationDeps: true` + `to.dependencyTypesNot: ['type-only']`：
 *    那样只会过滤「被报告的那条边」，而环是沿**整张图**（含 type-only 边）判定的，
 *    结果会把「值边 + 纯类型回边」的假环全部报出（实测 95 条误报），
 *    违反「类型环不误报」的验收标准（Plan §十）。
 *
 * 类型环的结构性根除见 Plan-20261009-142035 §七（叶子类型模块）。
 */
module.exports = {
	forbidden: [
		{
			name: 'no-circular-value',
			severity: 'error',
			comment:
				'禁止值级循环依赖（运行期真实成环）。类型级环（import type）不计入依赖图，天然放行。',
			from: {},
			to: { circular: true },
		},
	],
	options: {
		doNotFollow: { path: 'node_modules' },
		exclude: { path: '(^|/)node_modules/' },
		tsConfig: { fileName: 'tsconfig.json' },
		tsPreCompilationDeps: false,
		enhancedResolveOptions: { extensions: ['.ts', '.js'] },
	},
};
