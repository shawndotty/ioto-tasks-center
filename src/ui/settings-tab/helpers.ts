import type { App } from 'obsidian';
import { t } from '../../lang/helpter';
import { listProjectFolders } from '../../tasks-center/data';
import type { TaskCreationType } from '../../tasks-center/task-template-config';

/**
 * Templater 插件配置的模板文件夹；不存在时返回 null。
 * 仅用于「任务模板」选择文件时的默认定位目录。
 */
export function getTemplaterTemplatesFolder(app: App): string | null {
	const templater = (
		app as App & {
			plugins?: {
				plugins?: Record<
					string,
					{ settings?: { templates_folder?: unknown } }
				>;
			};
		}
	).plugins?.plugins?.['templater-obsidian'];
	const templatesFolder = templater?.settings?.templates_folder;
	return typeof templatesFolder === 'string' && templatesFolder.length > 0
		? templatesFolder
		: null;
}

/** 任务创建类型的展示文案映射（与 locale 一一对应）。 */
export function getTaskTypeTemplateLabels(): Record<TaskCreationType, string> {
	return {
		date: t('task.type.date'),
		plan: t('task.type.plan'),
		topic: t('task.type.topic'),
		normal: t('task.type.normal'),
	};
}

/** 「任务模板」标签页内遍历的任务类型顺序。 */
export const TASK_TEMPLATE_TYPES: TaskCreationType[] = [
	'normal',
	'topic',
	'plan',
	'date',
];

/**
 * 解析当前 tasks 根目录下可用的项目名列表，供批量 / 条目模板编辑器用作项目候选。
 */
export function resolveAvailableProjectNames(
	app: App,
	tasksRootPath: string,
): string[] {
	if (!tasksRootPath) {
		return [];
	}
	const result = listProjectFolders(app, tasksRootPath);
	return result.status === 'success'
		? result.projects.map((project) => project.name)
		: [];
}
