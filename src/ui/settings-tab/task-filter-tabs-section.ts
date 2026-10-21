import { Setting, type ToggleComponent } from 'obsidian';
import { t } from '../../lang/helpter';
import {
	getTaskFilterTabDefinitions,
	resolveVisibleTaskFilterTabs,
	setTaskFilterTabVisible,
	type TaskFilterTab,
} from '../../views/task-filter-tabs';
import type IOTOTasksCenter from '../../main';

/**
 * 「任务列表筛选标签」小节：5 个内置 tab 的显隐开关。
 *
 * 隐藏结果写进全局设置（`hiddenTaskFilterTabs`），不进 view state —— 否则两个
 * 任务中心叶子会不一致。至少保留一个可见 tab：最后一个仍为开的开关直接禁用，
 * 用户点不到非法值，因此不需要弹 Notice。
 */
export function renderTaskFilterTabsSection(
	containerEl: HTMLElement,
	plugin: IOTOTasksCenter,
): void {
	new Setting(containerEl)
		.setName(t('settings.heading.taskFilterTabs'))
		.setHeading();

	containerEl.createEl('p', {
		cls: 'setting-item-description',
		text: t('settings.taskFilterTabs.desc'),
	});

	const toggleEntries: Array<{
		id: TaskFilterTab;
		toggle: ToggleComponent;
	}> = [];

	/** 用设置值回写开关状态与禁用态（写入失败时也能自愈）。 */
	const syncToggleState = (): void => {
		const hiddenIds = plugin.settings.hiddenTaskFilterTabs;
		const visibleCount = resolveVisibleTaskFilterTabs(hiddenIds).length;
		for (const entry of toggleEntries) {
			const isVisible = !hiddenIds.includes(entry.id);
			entry.toggle.setValue(isVisible);
			entry.toggle.setDisabled(isVisible && visibleCount === 1);
		}
	};

	for (const definition of getTaskFilterTabDefinitions()) {
		new Setting(containerEl)
			.setName(t(`task.filter.${definition.id}`))
			.setDesc(t(`settings.taskFilterTabs.${definition.id}.desc`))
			.addToggle((toggle) => {
				toggle
					.setValue(
						!plugin.settings.hiddenTaskFilterTabs.includes(
							definition.id,
						),
					)
					.onChange(async (value) => {
						const next = setTaskFilterTabVisible(
							plugin.settings.hiddenTaskFilterTabs,
							definition.id,
							value,
						);
						await plugin.updateHiddenTaskFilterTabs(next);
						syncToggleState();
					});

				toggleEntries.push({ id: definition.id, toggle });
			});
	}

	syncToggleState();
}
