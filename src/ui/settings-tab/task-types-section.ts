import { Notice, Setting } from 'obsidian';
import { t } from '../../lang/helpter';
import type { TaskCreationType } from '../../tasks-center/task-template-config';
import { ENABLED_TASK_CREATION_TYPE_ORDER } from '../../tasks-center/enabled-task-creation-types';
import type IOTOTasksCenter from '../../main';
import { getTaskTypeTemplateLabels } from './helpers';

/** 「任务类型」标签页：勾选启用的任务创建类型（normal / topic / plan / date）。 */
export function renderTaskTypesSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.taskCreation'))
		.setHeading();

	new Setting(containerEl)
		.setName(t('settings.enabledTaskTypes.name'))
		.setDesc(t('settings.enabledTaskTypes.desc'));

	const enabledTaskTypes = new Set<TaskCreationType>(
		plugin.settings.enabledTaskCreationTypes,
	);
	const taskTypeLabels = getTaskTypeTemplateLabels();
	for (const taskType of ENABLED_TASK_CREATION_TYPE_ORDER) {
		new Setting(containerEl)
			.setName(taskTypeLabels[taskType])
			.addToggle((toggle) =>
				toggle
					.setValue(enabledTaskTypes.has(taskType))
					.onChange(async (value) => {
						if (
							!value &&
							enabledTaskTypes.has(taskType) &&
							enabledTaskTypes.size === 1
						) {
							toggle.setValue(true);
							new Notice(t('settings.enabledTaskTypes.atLeastOne'));
							return;
						}

						if (value) {
							enabledTaskTypes.add(taskType);
						} else {
							enabledTaskTypes.delete(taskType);
						}

						await plugin.updateEnabledTaskCreationTypes([
							...enabledTaskTypes,
						]);
					}),
			);
	}
}
