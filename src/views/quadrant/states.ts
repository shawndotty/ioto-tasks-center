/** 四象限整页状态：加载中 / 任务根目录缺失（[[Plan-20261115-201917]] §3.5）。 */

import { t } from '../../lang/helpter';

export function renderQuadrantState(
	container: HTMLElement,
	kind: 'loading' | 'root-missing',
	tasksRootPath: string,
): void {
	container.empty();
	const root = container.createDiv({ cls: `ioto-pq-state is-${kind}` });
	root.createDiv({
		cls: 'ioto-pq-state__title',
		text:
			kind === 'loading'
				? t('priorityQuadrant.state.loadingTitle')
				: t('priorityQuadrant.state.rootMissingTitle'),
	});
	root.createDiv({
		cls: 'ioto-pq-state__desc',
		text:
			kind === 'loading'
				? t('priorityQuadrant.state.loadingDesc', [tasksRootPath])
				: t('priorityQuadrant.state.rootMissingDesc', [tasksRootPath]),
	});
}
