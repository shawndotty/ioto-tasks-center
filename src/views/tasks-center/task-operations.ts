import { Menu, Notice, TFile } from 'obsidian';
import type { IOTOTasksCenterView } from '../iotoTasksCenterView';
import { getTaskCreationOptions } from './helpers';
import { createTaskFile } from '../../tasks-center/task-creation';
import { createProjectFolder } from '../../tasks-center/project-creation';
import { trashTaskFile } from '../../tasks-center/task-deletion';
import {
    setTaskFilePriority,
    clearTaskFilePriority,
    type TaskPriorityValue,
} from '../../tasks-center/task-priority';
import {
    setTaskFileStarred,
    clearTaskFileStarred,
} from '../../tasks-center/task-starred';
import {
    assignUpTaskToFile,
} from '../../tasks-center/up-task-assignment';
import {
    applyAffix,
    buildBatchTaskTitleForUpTask,
    parseBatchList,
    resolveTaskTypeForLevel,
    type BatchTaskItem,
    type BatchTaskTemplate,
} from '../../tasks-center/batch-task-template';
import type { TaskCreationType } from '../../tasks-center/task-template-config';
import type { TaskFileEntry } from '../../tasks-center/types';
import { resolveCurrentTaskContext } from '../../tasks-center/selected-text-subtask';
import { TaskCreationModal } from '../../ui/taskCreationModal';
import { ConfirmModal } from '../../ui/confirmModal';
import {
    BatchCreateConfirmModal,
    BatchNameAffixModal,
    BatchTemplateSelectModal,
} from '../../ui/batchTaskModals';
import { TaskNameModal } from '../../ui/taskNameModal';
import { t } from '../../lang/helpter';

// Function 1
export async function triggerBatchCreateFromTemplate(view: IOTOTasksCenterView): Promise<void> {
    const projectName = view.selectedProject;
    if (
        !projectName ||
        !view.projects.some((project) => project.name === projectName)
    ) {
        new Notice(t('view.notice.currentProjectUnavailable'));
        return;
    }

    const batchConfig = view.getBatchTemplateConfig();
    if (!batchConfig.enabled) {
        new Notice(t('notice.batchCreate.disabled'));
        return;
    }
    if (batchConfig.templates.length === 0) {
        new Notice(t('notice.batchCreate.noTemplates'));
        return;
    }

    const template = await new BatchTemplateSelectModal(
        view.app,
        batchConfig.templates,
        projectName,
    ).openAndGetValue();
    if (!template) {
        return;
    }

    const nameAffix = await new BatchNameAffixModal(
        view.app,
    ).openAndGetValue();
    if (nameAffix === null) {
        return;
    }

    const items = parseBatchList(template.listContent);
    if (items.length === 0) {
        new Notice(t('notice.batchCreate.emptyContent'));
        return;
    }

    const confirmed = await new BatchCreateConfirmModal(view.app, {
        templateName: template.name,
        prefix: nameAffix.prefix,
        suffix: nameAffix.suffix,
        projectName,
        items,
        levelTaskTypes: template.levelTaskTypes,
    }).openAndConfirm();
    if (!confirmed) {
        return;
    }

    await executeBatchCreate(
        view,
        template,
        nameAffix.prefix,
        nameAffix.suffix,
        items,
    );
}

// Function 2
export async function executeBatchCreate(
    view: IOTOTasksCenterView,
    template: BatchTaskTemplate,
    prefix: string,
    suffix: string,
    items: BatchTaskItem[],
): Promise<void> {
    const projectName = view.selectedProject;
    if (!projectName) {
        return;
    }

    view.isCreatingTask = true;
    view.render();

    let successCount = 0;
    let failureCount = 0;
    let firstCreatedFile: TFile | null = null;

    try {
        const previewLeaf = view.ensurePreviewLeaf();
        const createdFiles: Array<{ file: TFile; item: BatchTaskItem }> =
            [];

        for (const item of items) {
            const fullName = applyAffix(item.name, prefix, suffix);
            const taskType = resolveTaskTypeForLevel(
                template.levelTaskTypes,
                item.level,
            );
            try {
                const result = await createTaskFile({
                    app: view.app,
                    tasksRootPath: view.getTasksRootPath(),
                    projectName,
                    type: taskType,
                    customName: fullName,
                    templateConfig: view.getTaskTemplateConfig(taskType),
                    dateTaskDateFormat: view.getDateTaskDateFormat(),
                    targetLeaf: previewLeaf,
                    sourceLeaf: view.leaf,
                });
                createdFiles.push({ file: result.file, item });
                if (!firstCreatedFile) {
                    firstCreatedFile = result.file;
                }
                successCount += 1;
            } catch (error) {
                failureCount += 1;
                const message =
                    error instanceof Error
                        ? error.message
                        : t('notice.batchCreate.failed', [item.name]);
                new Notice(message);
            }
        }

        // 建立父子关系（依赖已创建文件，串行执行）
        for (const { file, item } of createdFiles) {
            if (item.parentIndex === null) {
                continue;
            }
            const parentEntry = createdFiles[item.parentIndex];
            if (!parentEntry) {
                continue;
            }
            const parentFullName = applyAffix(
                parentEntry.item.name,
                prefix,
                suffix,
            );
            const parentTaskType = resolveTaskTypeForLevel(
                template.levelTaskTypes,
                parentEntry.item.level,
            );
            const parentTitle = buildBatchTaskTitleForUpTask(
                projectName,
                parentTaskType,
                parentFullName,
            );
            try {
                await assignUpTaskToFile(view.app, file, parentTitle);
            } catch {
                new Notice(
                    t('notice.batchCreate.parentAssignFailed', [
                        file.basename,
                    ]),
                );
            }
        }

        view.previewLeaf = previewLeaf;
        await view.refreshFromVaultChange();

        if (firstCreatedFile) {
            await view.openFileInPreview(firstCreatedFile);
        }

        if (failureCount === 0) {
            new Notice(
                t('notice.batchCreate.success', [String(successCount)]),
            );
        } else {
            new Notice(
                t('notice.batchCreate.partialFail', [
                    String(successCount),
                    String(failureCount),
                ]),
            );
        }
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('notice.batchCreate.failed', [
                        error instanceof Error ? error.message : '',
                    ]);
        new Notice(message);
    } finally {
        view.isCreatingTask = false;
        view.render();
    }
}

// Function 3
export function canCreateTask(view: IOTOTasksCenterView): boolean {
    return Boolean(
        view.selectedProject &&
        !view.isProjectsLoading &&
        !view.isTasksLoading &&
        !view.isCreatingTask &&
        view.projects.some(
            (project) => project.name === view.selectedProject,
        ),
    );
}

// Function 4
export function getAddTaskButtonLabel(view: IOTOTasksCenterView): string {
    if (view.isCreatingTask) {
        return t('view.tasksPane.addTaskCreating');
    }

    if (!view.selectedProject) {
        return t('view.tasksPane.addTaskSelectProject');
    }

    if (view.isProjectsLoading || view.isTasksLoading) {
        return t('view.tasksPane.addTaskLoading');
    }

    return t('view.tasksPane.addTaskReady', [view.selectedProject]);
}

// Function 5
export function canCreateProject(view: IOTOTasksCenterView): boolean {
    return (
        !view.isProjectsLoading &&
        !view.isCreatingProject &&
        view.projectResult.status !== 'root-missing'
    );
}

// Function 6
export function getAddProjectButtonLabel(view: IOTOTasksCenterView): string {
    const tasksRootPath = view.getTasksRootPath();
    if (view.isCreatingProject) {
        return t('view.projectsPane.addProjectCreating');
    }

    if (view.isProjectsLoading) {
        return t('view.projectsPane.addProjectLoading');
    }

    if (view.projectResult.status === 'root-missing') {
        return t('view.projectsPane.addProjectRootMissing', [
            tasksRootPath,
        ]);
    }

    return t('view.projectsPane.addProjectReady', [tasksRootPath]);
}

// Function 7
export async function handleCreateProject(view: IOTOTasksCenterView): Promise<void> {
    if (!canCreateProject(view)) {
        return;
    }

    const projectNameResult = await new TaskNameModal(
        view.app,
        t('modal.newProject.title'),
        t('modal.newProject.placeholder'),
        {
            descriptionText: t('modal.newProject.desc'),
            confirmButtonText: t('modal.create'),
        },
    ).openAndGetValue();
    if (!projectNameResult) {
        return;
    }

    view.isCreatingProject = true;
    view.render();

    try {
        const result = await createProjectFolder(
            view.app,
            view.getTasksRootPath(),
            projectNameResult,
        );
        if (!result.created) {
            new Notice(t('view.notice.projectAlreadyExists'));
        }
        await view.loadProjects(result.name);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.createProjectFailed');
        new Notice(message);
    } finally {
        view.isCreatingProject = false;
        view.render();
    }
}

// Function 8
export async function showTaskCreationMenu(view: IOTOTasksCenterView, event: MouseEvent): Promise<void> {
    if (!canCreateTask(view)) {
        return;
    }

    const enabledTypes = view.getEnabledTaskCreationTypes();
    const normalizedEnabledTypes =
        enabledTypes.length > 0
            ? enabledTypes
            : getTaskCreationOptions().map((option) => option.key);
    if (normalizedEnabledTypes.length === 1) {
        const onlyType = normalizedEnabledTypes[0];
        if (!onlyType) {
            return;
        }
        void handleCreateTask(view, onlyType);
        return;
    }

    const menu = new Menu();
    const menuOptions = getTaskCreationOptions().filter((option) =>
        normalizedEnabledTypes.includes(option.key),
    );
    const resolvedMenuOptions =
        menuOptions.length > 0 ? menuOptions : getTaskCreationOptions();
    for (const option of resolvedMenuOptions) {
        menu.addItem((item) =>
            item.setTitle(option.label).onClick(() => {
                void handleCreateTask(view, option.key);
            }),
        );
    }
    menu.showAtMouseEvent(event);
}

// Function 9
export async function handleCreateTask(view: IOTOTasksCenterView, type: TaskCreationType): Promise<void> {
    const projectName = view.selectedProject;
    if (
        !projectName ||
        !view.projects.some((project) => project.name === projectName)
    ) {
        new Notice(t('view.notice.currentProjectUnavailable'));
        return;
    }

    let customName: string | undefined;
    let createdPriority: TaskPriorityValue | null = null;
    let createdStarred = false;
    if (type !== 'date') {
        const taskTypeTexts =
            type === 'plan'
                ? {
                        title: t('modal.newPlanTask.title'),
                        label: t('modal.newPlanTask.placeholder'),
                    }
                : type === 'topic'
                    ? {
                            title: t('modal.newTopicTask.title'),
                            label: t('modal.newTopicTask.placeholder'),
                        }
                    : {
                            title: t('modal.newNormalTask.title'),
                            label: t('modal.newNormalTask.placeholder'),
                        };
        const modalResult = await new TaskCreationModal(
            view.app,
            taskTypeTexts.title,
            taskTypeTexts.label,
            {
                descriptionText: t('modal.newTask.desc'),
                confirmButtonText: t('modal.create'),
            },
        ).openAndGetValue();
        if (!modalResult) {
            return;
        }
        customName = modalResult.name ?? undefined;
        createdPriority = modalResult.priority;
        createdStarred = modalResult.starred;
    }

    view.isCreatingTask = true;
    view.render();

    try {
        const previewLeaf = view.ensurePreviewLeaf();
        const result = await createTaskFile({
            app: view.app,
            tasksRootPath: view.getTasksRootPath(),
            projectName,
            type,
            customName,
            templateConfig: view.getTaskTemplateConfig(type),
            dateTaskDateFormat: view.getDateTaskDateFormat(),
            targetLeaf: previewLeaf,
            sourceLeaf: view.leaf,
        });
        if (type !== 'date') {
            await applyCreatedTaskSettings(view, result.file, {
                priority: createdPriority,
                starred: createdStarred,
            });
        }
        view.previewLeaf = previewLeaf;
        view.lastOpenedTaskByProject.set(projectName, result.file.path);
        await view.refreshFromVaultChange();
        await view.openFileInPreview(result.file);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.createTaskFailed');
        new Notice(message);
    } finally {
        view.isCreatingTask = false;
        view.render();
    }
}

// Function 10
export async function handleCreateSubtask(
    view: IOTOTasksCenterView,
    parentTask: TaskFileEntry,
    type: TaskCreationType,
): Promise<void> {
    const parentFile = view.app.vault.getAbstractFileByPath(
        parentTask.path,
    );
    if (!(parentFile instanceof TFile)) {
        new Notice(t('view.notice.taskFileUnavailable'));
        return;
    }

    const currentTaskContext = resolveCurrentTaskContext(
        parentFile,
        view.getTasksRootPath(),
    );

    let customName: string | undefined;
    let createdPriority: TaskPriorityValue | null = null;
    let createdStarred = false;
    if (type !== 'date') {
        const taskTypeTexts =
            type === 'plan'
                ? {
                        title: t('modal.newPlanSubtask.title'),
                        label: t('modal.newPlanSubtask.placeholder'),
                    }
                : type === 'topic'
                    ? {
                            title: t('modal.newTopicSubtask.title'),
                            label: t('modal.newTopicSubtask.placeholder'),
                        }
                    : {
                            title: t('modal.newNormalSubtask.title'),
                            label: t('modal.newNormalSubtask.placeholder'),
                        };
        const modalResult = await new TaskCreationModal(
            view.app,
            taskTypeTexts.title,
            taskTypeTexts.label,
            {
                descriptionText: t('modal.newSubtask.desc'),
                confirmButtonText: t('modal.create'),
            },
        ).openAndGetValue();
        if (!modalResult) {
            return;
        }
        customName = modalResult.name ?? undefined;
        createdPriority = modalResult.priority;
        createdStarred = modalResult.starred;
    }

    view.isCreatingTask = true;
    view.deferVaultRefreshForSubtaskCreation = true;
    view.render();

    try {
        const previewLeaf = view.ensurePreviewLeaf();
        const result = await createTaskFile({
            app: view.app,
            tasksRootPath: view.getTasksRootPath(),
            projectName: currentTaskContext.projectName,
            type,
            customName,
            targetDirectoryPath: currentTaskContext.currentDirectoryPath,
            templateConfig: view.getTaskTemplateConfig(type),
            dateTaskDateFormat: view.getDateTaskDateFormat(),
            targetLeaf: previewLeaf,
            sourceLeaf: view.leaf,
        });
        if (type !== 'date') {
            await applyCreatedTaskSettings(view, result.file, {
                priority: createdPriority,
                starred: createdStarred,
            });
        }
        await assignUpTaskToFile(
            view.app,
            result.file,
            currentTaskContext.parentTaskTitle,
        );
        view.previewLeaf = previewLeaf;
        view.lastOpenedTaskByProject.set(
            currentTaskContext.projectName,
            result.file.path,
        );
        view.deferVaultRefreshForSubtaskCreation = false;
        view.clearDeferredVaultRefreshState();
        await view.refreshFromVaultChange();
        await view.openFileInPreview(result.file);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.createSubtaskFailed');
        new Notice(message);
    } finally {
        view.deferVaultRefreshForSubtaskCreation = false;
        if (view.pendingVaultRefresh) {
            view.clearDeferredVaultRefreshState();
            await view.refreshFromVaultChange();
        }
        view.isCreatingTask = false;
        view.render();
    }
}

// Function 11
export async function applyCreatedTaskSettings(
    view: IOTOTasksCenterView,
    file: TFile,
    settings: { priority: TaskPriorityValue | null; starred: boolean },
): Promise<void> {
    try {
        if (settings.priority === null) {
            await clearTaskFilePriority(view.app, file);
        } else {
            await setTaskFilePriority(view.app, file, settings.priority);
        }
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.updateTaskPriorityFailed');
        new Notice(message);
    }

    try {
        if (settings.starred) {
            await setTaskFileStarred(view.app, file);
        } else {
            await clearTaskFileStarred(view.app, file);
        }
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.updateTaskCoreFailed');
        new Notice(message);
    }
}

// Function 12
export async function updateTaskPriority(
    view: IOTOTasksCenterView,
    task: TaskFileEntry,
    priority: TaskPriorityValue,
): Promise<void> {
    const file = view.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
        new Notice(t('view.notice.taskFileUnavailable'));
        return;
    }

    try {
        await setTaskFilePriority(view.app, file, priority);
        await refreshCurrentProjectTasks(view);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.updateTaskPriorityFailed');
        new Notice(message);
    }
}

// Function 13
export async function clearTaskPriority(
    view: IOTOTasksCenterView,
    task: TaskFileEntry,
): Promise<void> {
    const file = view.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
        new Notice(t('view.notice.taskFileUnavailable'));
        return;
    }

    try {
        await clearTaskFilePriority(view.app, file);
        await refreshCurrentProjectTasks(view);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.clearTaskPriorityFailed');
        new Notice(message);
    }
}

// Function 14
export async function updateTaskStarred(
    view: IOTOTasksCenterView,
    task: TaskFileEntry,
): Promise<void> {
    const file = view.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
        new Notice(t('view.notice.taskFileUnavailable'));
        return;
    }

    try {
        await setTaskFileStarred(view.app, file);
        await refreshCurrentProjectTasks(view);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.updateTaskCoreFailed');
        new Notice(message);
    }
}

// Function 15
export async function clearTaskStarred(
    view: IOTOTasksCenterView,
    task: TaskFileEntry,
): Promise<void> {
    const file = view.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
        new Notice(t('view.notice.taskFileUnavailable'));
        return;
    }

    try {
        await clearTaskFileStarred(view.app, file);
        await refreshCurrentProjectTasks(view);
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.clearTaskCoreFailed');
        new Notice(message);
    }
}

// Function 16
export async function confirmAndDeleteTask(
    view: IOTOTasksCenterView,
    task: TaskFileEntry,
): Promise<void> {
    const file = view.app.vault.getAbstractFileByPath(task.path);
    if (!(file instanceof TFile)) {
        new Notice(t('view.notice.taskFileUnavailable'));
        return;
    }

    const confirmed = await new ConfirmModal(
        view.app,
        t('modal.deleteTask.title'),
        {
            descriptionText: t('modal.deleteTask.desc', [task.title]),
            confirmButtonText: t('modal.deleteTask.confirm'),
            cancelButtonText: t('modal.cancel'),
        },
    ).openAndConfirm();
    if (!confirmed) {
        return;
    }

    try {
        await trashTaskFile(view.app, file);
        await view.refreshFromVaultChange();
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : t('view.notice.deleteTaskFailed');
        new Notice(message);
    }
}

// Function 17
export async function refreshCurrentProjectTasks(view: IOTOTasksCenterView): Promise<void> {
    if (!view.selectedProject) {
        return;
    }

    view.isTasksLoading = true;
    view.render();
    await view.loadTasks(view.selectedProject);
}
