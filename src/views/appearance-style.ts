/**
 * 外观风格类名映射：IOTOTask 视图与优先级四象限共用一份真值。
 *
 * `card` 为基线，不挂任何风格类；另外四档各挂一个 `is-*` 类且互斥。
 * 叶子模块，只 `import type`，不会产生值级依赖环（[[Plan-20261116-052507]] §3.2）。
 */

import type { TaskViewAppearanceStyle } from '../settings-types';

export interface AppearanceClassTarget {
	toggleClass(cls: string, on: boolean): void;
}

export function applyAppearanceStyleClasses(
	el: AppearanceClassTarget,
	style: TaskViewAppearanceStyle,
): void {
	el.toggleClass('is-glass', style === 'glass');
	el.toggleClass('is-modern', style === 'modern');
	el.toggleClass('is-simple', style === 'simple');
	el.toggleClass('is-morandi', style === 'morandi');
}
