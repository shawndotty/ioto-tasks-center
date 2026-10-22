import type { App } from 'obsidian';
import { t } from '../../lang/helpter';
import type IOTOTasksCenter from '../../main';
import { TabbedSettings } from '../tabbed-settings';
import { renderBatchTemplateSection } from './batch-templates-section';
import { renderEntryTemplateSection } from './entry-templates-section';
import { renderTaskTemplatesSection } from './task-templates-section';

/**
 * 「模板」标签页：任务模板 / 批量模板 / 条目模板 三个二级标签。
 *
 * 每个二级标签回调拿到的是**各自独立**的 content 容器：三个 renderer 首行都会
 * `containerEl.empty()`（切换后原地重绘），共用容器会互相清空。
 */
export function renderTemplatesSection(
	containerEl: HTMLElement,
	app: App,
	plugin: IOTOTasksCenter,
): void {
	const tabbed = new TabbedSettings(containerEl, 'ioto-tasks-center-templates');

	tabbed.addTab(t('settings.subTabs.taskTemplates'), (contentEl) => {
		renderTaskTemplatesSection(contentEl, app, plugin);
	});

	tabbed.addTab(t('settings.subTabs.batchTemplates'), (contentEl) => {
		renderBatchTemplateSection(contentEl, app, plugin);
	});

	tabbed.addTab(t('settings.subTabs.entryTemplates'), (contentEl) => {
		renderEntryTemplateSection(contentEl, app, plugin);
	});
}
