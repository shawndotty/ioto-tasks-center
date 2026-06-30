# iotoTasksCenterView.ts 清理未使用导入与死代码方案

## 概述

Phase 1 和 Phase 2 重构完成后，主文件和若干关联文件中遗留了大量未使用的 import 以及重复的死方法。本任务清理这些冗余代码，进一步缩减文件体积、消除 lint 警告。

当前状态：
- 主文件 `iotoTasksCenterView.ts`：2654 行，56 个 lint `no-unused-vars` 警告
- 关联文件也有少量未使用导入/导出

---

## 当前问题分析

### 问题根源

重构过程中将方法体提取到独立模块（data-loader.ts、task-operations.ts 等）后，原文件中直接使用的导入（如 `createTaskFile`、`trashTaskFile`、`ConfirmModal` 等）不再被主文件引用，因为逻辑已移入子模块。但这些导入声明被遗留在导入块中。

此外，Phase 2A 实施时有 4 个方法（`resolveSelectedProject`、`buildProjectIncompleteCounts`、`buildProjectCategoryByName`、`applyProjectSorting`）的方法体未被替换为委托包装，仍然保留完整实现，但其 data-loader.ts 版本已在 data-loader.ts 内部被独立调用，这 4 个类方法已成为孤立的死代码。

### 未使用导入分类（主文件 iotoTasksCenterView.ts）

| # | 来源模块 | 需移除的符号 | 备注 |
| --- | --- | --- | --- |
| 1 | `../tasks-center/data` | `listProjectFolders` | 保留 `getIncompleteChecklistItems`, `listProjectTaskFiles` |
| 2 | `../tasks-center/project-creation` | 整行删除 | `createProjectFolder` 无人使用 |
| 3 | `../tasks-center/project-sort` | `filterHiddenProjectEntries` | 保留 `sortProjectEntries` |
| 4 | `../tasks-center/task-creation` | 整行删除 | `createTaskFile` 无人使用 |
| 5 | `../tasks-center/task-priority` | `clearTaskFilePriority`, `setTaskFilePriority`, `TASK_PRIORITY_VALUES` | 保留 `type TaskPriorityValue` |
| 6 | `../tasks-center/task-deletion` | 整行删除 | `trashTaskFile` 无人使用 |
| 7 | `../tasks-center/task-starred` | 整块删除 | `clearTaskFileStarred`, `setTaskFileStarred` 均不用 |
| 8 | `../tasks-center/up-task-assignment` | 整块删除 | `assignUpTaskToFile`, `removeUpTaskFromFile` 均不用 |
| 9 | `../tasks-center/batch-task-template` | `applyAffix`, `buildBatchTaskTitleForUpTask`, `parseBatchList`, `resolveTaskTypeForLevel` | 保留所有 `type` 导入（签名引用） |
| 10 | `../settings` | `getProjectListGroupModeOptions`, `getProjectListSortModeOptions` | 保留其他 4 个导入 |
| 11 | `../ui/confirmModal` | 整行删除 | `ConfirmModal` 无人使用 |
| 12 | `../ui/taskCreationModal` | 整行删除 | `TaskCreationModal` 无人使用 |
| 13 | `../ui/batchTaskModals` | 整块删除 | 三个 modal 类均不用 |
| 14 | `../ui/taskNameModal` | 整行删除 | `TaskNameModal` 无人使用 |
| 15 | `./tasks-center/drag-controller` | `handleTaskDrop`, `handleRemoveUpTaskDragLeave` | 类中有自有实现 |
| 16 | `./task-filter-tabs` | `isTaskFilterTab` | 保留其他 3 个导入 |
| 17 | `./tasks-center/data-loader` | `resolveSelectedProject`, `selectProject`, `buildProjectIncompleteCounts`, `buildProjectCategoryByName`, `applyProjectSorting` | 类中有自有实现或死方法 |
| 18 | `./tasks-center/task-operations` | `canCreateProject`, `getAddProjectButtonLabel`, `showTaskCreationMenu`, `refreshCurrentProjectTasks` | 类中有自有实现 |
| 19 | `./task-list-scroll` | `TASK_LIST_SELECTOR` | 保留其他 2 个导入 |
| 20 | `../tasks-center/selected-text-subtask` | 整行删除 | `resolveCurrentTaskContext` 无人使用 |
| 21 | `./tasks-center/constants` | `PROJECT_LIST_GROUP_MODE_ORDER`, `PROJECT_LIST_SORT_MODE_ORDER`, `TASK_LIST_GROUP_MODE_ORDER`, `TASK_LIST_SORT_MODE_ORDER` | 保留其他 7 个导入 |
| 22 | `./tasks-center/preview-leaf` | `getActiveTaskPath`, `getPreviewLeafFilePath`, `activatePreviewLeaf`, `ensurePreviewLeaf`, `findReusablePreviewLeaf` | 类中有自有实现，保留 `isLeafAvailable`, `findLeafByFilePath`, `findLeafById` |
| 23 | `./tasks-center/helpers` | `getTaskPriorityVisibilityOptions`, `formatPriorityMenuTitle`, `formatMenuOptionTitle` | 保留其他 3 个导入 |
| 24 | `./tasks-center/menus` | `openProjectSpecByProject`, `showProjectSwitcherMenu` | 类中有自有实现，保留其他 5 个导入 |

> **注意**：`setIcon` 虽被 ESLint 标记为未使用，但 grep 确认其在第 581、698、871、1076、1189、2171 行被使用——这是 ESLint 误报，**保留**。

### 死方法（主文件 iotoTasksCenterView.ts）

以下 4 个 `private` 方法在代码库中**无任何调用方**，且已有 `data-loader.ts` 中的同名独立函数提供服务：

| 方法 | 行号 | 行数 | 说明 |
| --- | --- | --- | --- |
| `resolveSelectedProject` | 487-501 | 15 | 与 data-loader.ts 中的实现完全重复 |
| `buildProjectIncompleteCounts` | 2359-2378 | 20 | 与 data-loader.ts 中的实现完全重复 |
| `buildProjectCategoryByName` | 2380-2403 | 24 | 与 data-loader.ts 中的实现完全重复 |
| `applyProjectSorting` | 2405-2411 | 7 | 与 data-loader.ts 中的实现完全重复 |

> 确认方法：grep 搜索 `this.resolveSelectedProject(`、`this.buildProjectIncompleteCounts(`、`this.buildProjectCategoryByName(`、`this.applyProjectSorting(` 在整个 `src/` 目录中返回**零匹配**。

### 关联文件清理

| 文件 | 问题 | 行数 |
| --- | --- | --- |
| `tasks-center/menus.ts` | `openProjectSpecByProject`（76-91）、`showProjectSwitcherMenu`（93-124）两个导出函数无任何外部调用方 | ~48 行 |
| `tasks-center/search-controller.ts` | `setIcon` 导入（行 1）、`TaskFilterTab` 类型导入（行 3）未使用 | 2 行 |
| `tasks-center/task-operations.ts` | `TASK_PRIORITY_VALUES` 导入（行 10）未使用 | 1 行 |

---

## 拟定变更

### 变更 1：清理 iotoTasksCenterView.ts 导入块

**文件**：`src/views/iotoTasksCenterView.ts`

按上表逐项移除未使用的导入符号。操作原则：
- 如果某个 import 语句中**所有**符号均未使用 → 删除整条 import 语句
- 如果只有**部分**符号未使用 → 从解构中移除未使用符号，保留仍使用的符号
- 如果 import 语句变为空 → 删除整行

**涉及修改的 import 行**（以当前文件行号为准）：

| 当前行 | 操作 |
| --- | --- |
| 13-17 | 从解构中移除 `listProjectFolders`，保留 `getIncompleteChecklistItems, listProjectTaskFiles` |
| 18 | 整行删除 `import { createProjectFolder } from '../tasks-center/project-creation';` |
| 19-22 | 从解构中移除 `filterHiddenProjectEntries`，保留 `sortProjectEntries` |
| 28 | 整行删除 `import { createTaskFile } from '../tasks-center/task-creation';` |
| 33-38 | 从解构中移除 `clearTaskFilePriority, setTaskFilePriority, TASK_PRIORITY_VALUES`，保留 `type TaskPriorityValue` |
| 39 | 整行删除 `import { trashTaskFile } from '../tasks-center/task-deletion';` |
| 40-43 | 整块删除 `clearTaskFileStarred, setTaskFileStarred` 导入 |
| 44-47 | 整块删除 `assignUpTaskToFile, removeUpTaskFromFile` 导入 |
| 48-56 | 从解构中移除 `applyAffix, buildBatchTaskTitleForUpTask, parseBatchList, resolveTaskTypeForLevel`，保留 `type BatchTaskItem, type BatchTaskTemplate, type BatchTemplateConfig` |
| 68-73 | 从解构中移除 `getProjectListGroupModeOptions, getProjectListSortModeOptions`，保留 `getTaskListGroupModeOptions, getTaskListSortModeOptions` |
| 92 | 整行删除 `import { ConfirmModal } from '../ui/confirmModal';` |
| 93 | 整行删除 `import { TaskCreationModal } from '../ui/taskCreationModal';` |
| 94-98 | 整块删除 `BatchCreateConfirmModal, BatchNameAffixModal, BatchTemplateSelectModal` 导入 |
| 100 | 整行删除 `import { TaskNameModal } from '../ui/taskNameModal';` |
| 106-121 | 从解构中移除 `handleTaskDrop, handleRemoveUpTaskDragLeave`，保留其余 12 个导入 |
| 122-128 | 从解构中移除 `isTaskFilterTab`，保留其余 3 个导入 |
| 130-140 | 从解构中移除 `resolveSelectedProject, selectProject, buildProjectIncompleteCounts, buildProjectCategoryByName, applyProjectSorting`，保留其余 4 个导入 |
| 141-159 | 从解构中移除 `canCreateProject, getAddProjectButtonLabel, showTaskCreationMenu, refreshCurrentProjectTasks`，保留其余 13 个导入 |
| 165-169 | 从解构中移除 `TASK_LIST_SELECTOR`，保留其余 2 个导入 |
| 184 | 整行删除 `import { resolveCurrentTaskContext } from '../tasks-center/selected-text-subtask';` |
| 185-196 | 从解构中移除 `PROJECT_LIST_GROUP_MODE_ORDER, PROJECT_LIST_SORT_MODE_ORDER, TASK_LIST_GROUP_MODE_ORDER, TASK_LIST_SORT_MODE_ORDER`，保留其余 7 个导入 |
| 198-207 | 从解构中移除 `getActiveTaskPath, getPreviewLeafFilePath, activatePreviewLeaf, ensurePreviewLeaf, findReusablePreviewLeaf`，保留其余 3 个导入 |
| 208-215 | 从解构中移除 `getTaskPriorityVisibilityOptions, formatPriorityMenuTitle, formatMenuOptionTitle`，保留其余 3 个导入 |
| 216-224 | 从解构中移除 `openProjectSpecByProject, showProjectSwitcherMenu`，保留其余 5 个导入 |

**预期效果**：导入块从约 220 行缩减至约 170 行（减少约 50 行）。

---

### 变更 2：删除 iotoTasksCenterView.ts 中 4 个死方法

**文件**：`src/views/iotoTasksCenterView.ts`

删除以下 4 个 `private` 方法（完整方法体，包括签名和实现）：

1. **`resolveSelectedProject`**（约行 487-501，~15 行）
2. **`buildProjectIncompleteCounts`**（约行 2359-2378，~20 行）
3. **`buildProjectCategoryByName`**（约行 2380-2403，~24 行）
4. **`applyProjectSorting`**（约行 2405-2411，~7 行）

**预期效果**：减少约 66 行。

---

### 变更 3：清理 menus.ts 死导出

**文件**：`src/views/tasks-center/menus.ts`

删除以下 2 个导出函数：

1. **`openProjectSpecByProject`**（约行 76-91，~16 行）
2. **`showProjectSwitcherMenu`**（约行 93-124，~32 行）

**预期效果**：`menus.ts` 从 431 行缩减至约 383 行（减少 48 行）。

---

### 变更 4：清理 search-controller.ts 未使用导入

**文件**：`src/views/tasks-center/search-controller.ts`

移除：
- `setIcon` 从 `obsidian` 导入中移除（行 1）
- `TaskFilterTab` 类型导入删除（行 3）

**预期效果**：减少 2 行。

---

### 变更 5：清理 task-operations.ts 未使用导入

**文件**：`src/views/tasks-center/task-operations.ts`

从 `../../tasks-center/task-priority` 导入中移除 `TASK_PRIORITY_VALUES`（行 10）。

**预期效果**：减少 1 行。

---

## 假设与决策

1. **`setIcon` 保留**：ESLint 误报，grep 确认在渲染方法中多处使用。
2. **`IOTOTasksCenterViewState` 保留**：`import type` 用于类型契约，保留。
3. **类中自有实现的方法保留**：`handleTaskDrop`、`handleRemoveUpTaskDragLeave` 等类方法保留其自有实现（它们仍被 `this.xxx()` 调用），仅移除未使用的 import 符号。不改为委托包装——那是另一个重构任务。
4. **死方法直接删除**：4 个死方法确认无调用方后才删除。不改为委托包装，因为 data-loader.ts 内部已独立使用其自己的函数版本，与类方法无耦合。
5. **不新增功能/不改逻辑**：本任务仅做清理（删除），不新增任何逻辑或改变任何行为。
6. **每个变更后立即验证**：每完成一个文件变更即运行 `npm run build && npm run lint` 确保无破坏。

---

## 验证步骤

### 自动化验证（每完成一个变更即执行）

```bash
# 编译 + 类型检查
npx tsc --noEmit

# 构建
npm run build

# Lint（警告数应显著下降）
npm run lint

# 测试（确保无回归）
npm test
```

### 静态确认

- `iotoTasksCenterView.ts` lint 警告从 56 降至接近 0
- `menus.ts`、`search-controller.ts`、`task-operations.ts` 的 lint 警告消失
- 主文件行数从 2654 降至约 2538（减少约 116 行导入 + 死方法）
- 所有测试 268/268 通过

---

## 相关文件清单

| 文件路径 | 修改类型 | 说明 |
| --- | --- | --- |
| `src/views/iotoTasksCenterView.ts` | 修改 | 移除 ~50 个未使用导入符号 + 删除 4 个死方法 |
| `src/views/tasks-center/menus.ts` | 修改 | 删除 2 个死导出函数 |
| `src/views/tasks-center/search-controller.ts` | 修改 | 移除 2 个未使用导入 |
| `src/views/tasks-center/task-operations.ts` | 修改 | 移除 1 个未使用导入 |

> 其他文件**不改动**。
