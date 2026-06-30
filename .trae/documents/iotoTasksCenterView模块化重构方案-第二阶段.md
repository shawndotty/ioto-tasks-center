# iotoTasksCenterView.ts 模块化重构方案（第二阶段）

## 概述

第一阶段已完成，主文件从 ~3994 行降至 3237 行，6 个模块（constants、helpers、preview-leaf、drag-controller、search-controller、menus）已成功提取。本计划覆盖第二阶段——提取剩余的高耦合集群，将主文件进一步缩减至约 1500-1700 行。

**策略**（延续第一阶段）：
- **提取函数 + 上下文接口**：方法体提取为接收 `view: IOTOTasksCenterView` 参数的独立函数，主类保留单行委托包装，签名与行为完全不变。
- **按风险递增分步**：先拆分耦合度最低的加载集群，再拆分操作集群，最后拆分渲染集群。
- **不新建类/Controller**：延续既有兄弟模块（`task-preview-state.ts` 等）的纯函数风格。

---

## Phase 1 完成状态回顾

| 文件 | 行数 | 内容 |
| --- | --- | --- |
| `src/views/iotoTasksCenterView.ts` | **3237** | 主类（含委托包装及剩余方法） |
| `src/views/tasks-center/constants.ts` | 113 | 常量、State 接口、parseViewState 等纯函数 |
| `src/views/tasks-center/helpers.ts` | 62 | 菜单文案、CSS 类名等辅助函数 |
| `src/views/tasks-center/preview-leaf.ts` | 106 | 预览 leaf 管理（8 函数） |
| `src/views/tasks-center/drag-controller.ts` | 324 | 拖放控制器（14 函数） |
| `src/views/tasks-center/search-controller.ts` | 120 | 搜索控制器（7 函数） |
| `src/views/tasks-center/menus.ts` | 431 | 上下文菜单（7 函数） |

- TypeScript 严格模式编译零错误
- 所有单元测试通过
- 对外契约（27 参数构造函数）零改动

---

## 第二阶段目标集群

基于代码分析，剩余方法按业务逻辑分为 3 个可提取集群：

| # | 集群 | 约行数 | 耦合等级 | 依赖的 this 字段数 |
| --- | --- | --- | --- | --- |
| 2A | 项目/任务加载 (Loading) | ~220 | **低** | ~15 |
| 2B | 任务操作 (Operations) | ~550 | **中** | ~18 |
| 2C | 渲染 (Rendering) | ~1000 | **高** | ~30+ |

> 主文件剩余方法还包括各集群的委托包装（~120 行）、Obsidian 生命周期方法（~80 行）、预览 leaf 代理（~70 行）、小工具方法（~50 行）。这些无需提取。

---

## 变更详情

### 通用模式：上下文接口 + 委托包装

延续第一阶段模式，每个新模块中的函数签名为 `function xxxx(view: IOTOTasksCenterView, ...args): ReturnType`。主类中对应方法变为单行委托：

```typescript
// 主类内（签名不变）
async loadProjects(preferredProject?: string | null): Promise<void> {
    return loadProjects(this, preferredProject);
}
```

为减少样板，新模块统一使用 `import type { IOTOTasksCenterView } from '../iotoTasksCenterView'` 作为参数类型。

---

### 变更 2A：拆分项目/任务加载集群

**新建文件**：`src/views/tasks-center/data-loader.ts`

迁移内容（方法体提取为独立函数，接收 `view` 参数）：

| 原方法 | 行号 | 说明 |
| --- | --- | --- |
| `refreshFromVaultChange` | 446-463 | 外部变更刷新入口 |
| `loadProjects` | 469-511 | 加载项目列表 + 排序 + 元数据 |
| `resolveSelectedProject` | 513-527 | 选中项目兜底逻辑 |
| `selectProject` | 529-548 | 切换项目（含滚动/折叠重置） |
| `loadTasks` | 550-576 | 按项目加载任务列表 |
| `getCachedTaskPath` | 2920-2929 | 获取上次打开的任务路径（缓存） |
| `buildProjectIncompleteCounts` | 2847-2866 | 计算项目未完成任务数 |
| `buildProjectCategoryByName` | 2868-2891 | 计算项目分类名 |
| `applyProjectSorting` | 2893-2899 | 应用项目排序/重新分组 |

**主文件改动**：
- 上述 9 个方法体迁移至 `data-loader.ts`，主类保留同名委托方法
- 9 个 `private` 字段需移除 `private` 关键字（使外部模块可访问）：
  - `projectIncompleteCounts`（200 行）
  - `projectCategoryByName`（201 行）
  - `isProjectsLoading`（235 行）
  - `projectResult`（230 行）
  - `refreshToken`（246 行）
  - `lastOpenedTaskByProject`（216 行）
  - `pendingVaultRefresh`（227 行）
  - `deferredVaultRefreshTimer`（228 行）
  - `openedTaskPath`（209 行）— 已是 package 可见性，无需改

**依赖分析**：该集群主要调用 `this.app`、各 settings getter（`getTasksRootPath`、`getHiddenProjectNames` 等）、导入纯函数（`listProjectFolders` 等）、及内部方法 `shouldDeferVaultRefresh`/`scheduleDeferredVaultRefresh`（这些方法虽在渲染相关代码中但被加载流程引用，需要保留或提取）。回调 `render()`、`loadTasks()` 通过 `view` 委托访问。

**为什么先做**：纯数据流水线，副作用最少，与渲染解耦较好，风险最低。

**预期效果**：主文件减少约 220 行。

---

### 变更 2B：拆分任务操作集群

**新建文件**：`src/views/tasks-center/task-operations.ts`

迁移内容：

| 子集群 | 方法 | 原行号 | 说明 |
| --- | --- | --- | --- |
| **单任务创建** | `showTaskCreationMenu` | 2261-2294 | 点击 + 按钮弹出创建菜单 |
| | `handleCreateTask` | 2296-2378 | 根据类型创建任务文件 |
| | `getAddTaskButtonLabel` | 2175-2189 | 获取创建按钮文案 |
| | `canCreateTask` | 1983-1993 | 判断是否可创建任务 |
| **子任务创建** | `handleCreateSubtask` | 2380-2486 | 创建子任务并分配 up task |
| | `applyCreatedTaskSettings` | 2488-2519 | 写入 frontmatter 设置 |
| **批量创建** | `triggerBatchCreateFromTemplate` | 864-924 | 批量创建入口（模板选择 → 名称前后缀 → 确认） |
| | `executeBatchCreate` | 926-1047 | 执行批量创建 |
| **项目创建** | `handleCreateProject` | 2218-2259 | 创建项目文件夹 |
| | `canCreateProject` | 2191-2197 | 判断是否可创建项目 |
| | `getAddProjectButtonLabel` | 2199-2216 | 获取创建项目按钮文案 |
| **任务写操作** | `updateTaskPriority` | 3023-3043 | 设置任务优先级 |
| | `clearTaskPriority` | 3045-3062 | 清除任务优先级 |
| | `updateTaskStarred` | 3064-3081 | 设置任务星标 |
| | `clearTaskStarred` | 3083-3100 | 清除任务星标 |
| | `confirmAndDeleteTask` | 3102-3132 | 确认并删除任务 |
| | `refreshCurrentProjectTasks` | 3134-3142 | 刷新当前项目任务列表 |

**主文件改动**：
- 上述 16 个方法体迁移至 `task-operations.ts`
- 7 个 `private` 字段需移除 `private`：
  - `isCreatingTask`（238 行）
  - `isCreatingProject`（237 行）
  - `isProjectsLoading`（235 行，如 2A 已改则跳过）
  - `isTasksLoading`（236 行，已是 public）
  - `deferVaultRefreshForSubtaskCreation`（229 行）
  - `lastOpenedTaskByProject`（216 行，如 2A 已改则跳过）
  - `previewLeaf`（215 行，已是 package 可见性）
- Settings getter：`getTasksRootPath`、`getEnabledTaskCreationTypes`、`getTaskTemplateConfig`、`getDateTaskDateFormat`、`getBatchTemplateConfig` 已是 `readonly` 属性，提取的函数通过 `view.getTasksRootPath()` 访问即可。

**依赖分析**：
- 严重依赖 `this.app.vault`、`this.selectedProject`、`this.tasks`、`this.projects`
- 回调 `render()`、`refreshFromVaultChange()`、`loadProjects()`、`loadTasks()`、`ensurePreviewLeaf()`、渲染等方法
- 使用导入的业务函数：`createTaskFile`、`createProjectFolder`、`trashTaskFile`、`setTaskFilePriority`、`clearTaskFilePriority`、`setTaskFileStarred`、`clearTaskFileStarred`、`assignUpTaskToFile`、`removeUpTaskFromFile`、`resolveCurrentTaskContext` 等
- 调用 UI 组件：`TaskCreationModal`、`BatchCreateConfirmModal`、`BatchNameAffixModal`、`BatchTemplateSelectModal`、`ConfirmModal`、`TaskNameModal`
- 所有依赖通过 `view.xxx` 或直接 import 访问，无需新增参数

**为什么次做**：该集群依赖多个字段和回调，但所有写入操作语义清晰，方法间逻辑相对独立，适合提取。

**预期效果**：主文件减少约 550 行。

---

### 变更 2C：拆分渲染集群（预留，本阶段可选）

**说明**：渲染集群约 1000 行，是耦合最重的集群（访问约 30 个 `this` 字段），包含 `render`、`renderProjectsPane`、`renderTasksPane`、`renderTaskRows`、`renderTaskTabs`、折叠状态、popover 绑定、悬停预览、resize 观察器等。

**本阶段的策略**：渲染集群**可部分提取**——将最独立的子集群先拆分，将核心 `render()`/`renderProjectsPane()`/`renderTasksPane()` 三个入口方法留在主文件作为"枢纽"。

**可部分提取的子集群**：

| 子集群 | 方法 | 约行数 | 独立程度 |
| --- | --- | --- | --- |
| **折叠状态管理** | `isTaskGroupCollapsed`、`isProjectGroupCollapsed`、`toggleTaskGroupCollapsed`、`toggleProjectGroupCollapsed`、`isSubtasksCollapsed`、`toggleSubtasksCollapsed`、`syncCollapsedTaskGroups`、`syncCollapsedProjectGroups` | ~85 | 高（仅操作 Set + DOM，可纯函数化） |
| **Outlink 徽章更新** | `queueOutlinkBadgeUpdate`、`updateTaskOutlinkBadges`、`syncTaskOutlinkBadge`、`cleanupTaskOutlinkCountsContainer`、`getTaskOutlinkBadgeLabel` | ~130 | 高（主要是 DOM 操作 + 定时器） |
| **悬停预览** | `triggerTaskHoverPreview`、`shouldDeferVaultRefresh`、`scheduleDeferredVaultRefresh`、`refreshAfterDeferredHoverPreview`、`clearDeferredVaultRefreshState` | ~50 | 中（依赖字段多但操作内聚） |
| **Resize 观察器** | `startResizeObserver`、`stopResizeObserver`、`syncCompactLayout` | ~40 | 中（依赖 isCompactLayout + contentEl） |
| **Tab/过滤辅助** | `renderTaskTabs`、`getTasksForActiveTab`、`getVisibleTasks`、`getTaskPresentationSections`、`getTaskFilterCounts`、`matchesTaskFilterTab`、`getTaskListDescription`、`renderTaskFilterEmptyState`、`renderTaskSearchEmptyState` | ~140 | 中（依赖 activeTaskFilterTab、taskSearchQuery 等） |

以上子集群合计约 445 行。如果全部提取，主文件额外减少约 445 行，合计主文件约 **1800-2000 行**（3237 - 220 - 550 - 445 = ~2022）。

> **风险提示**：渲染集群的子集群之间存在调用关系（如 `renderProjectsPane` 调用折叠检查方法），提取后需特别注意函数间的依赖链。建议完成 2A 和 2B 后，根据实际效果决定 2C 的具体拆分方案。

---

## 假设与决策

1. **延续 Phase 1 模式**：不引入 Controller 类，统一使用「函数 + view 参数」模式，与既有模块风格一致。
2. **参数类型用主类类型**：新模块函数参数统一为 `view: IOTOTasksCenterView`，通过 TypeScript 结构类型避免循环运行时依赖。
3. **委托包装保留原签名**：主类中原方法保留为单行委托，确保所有 `this.xxx()` 内部调用无需改动。
4. **不改动对外契约**：27 参数构造函数、`getViewType`、`getState/setState`、`onOpen/onClose` 全部不动。
5. **不删除方法**：只迁移方法体，保留委托包装方法，不删除任何公开/私有方法签名。`main.ts` 及其他外部调用方无需改动。
6. **PATCH 依赖处理**：`shouldDeferVaultRefresh`/`scheduleDeferredVaultRefresh` 被加载集群 `refreshFromVaultChange` 调用，需在 2A 实施时将该两方法的委托包装保留在主类中（不移走），或将其一并提取（如在 2C 中处理时注意依赖顺序）。
7. **目录结构**：2A/2B 新建文件统一放入 `src/views/tasks-center/`（与 Phase 1 模块同目录），保持规整。
8. **第二阶段顺序**：先 2A（加载集群），再 2B（操作集群）。2C（渲染集群拆分子集）为可选项，根据前两步结果决定。
9. **循环依赖规避**：新模块仅 `import type` 主类（类型 only），主类 `import` 新模块的函数（值），方向单一。

---

## 验证步骤

### 自动化验证（每完成一个变更即执行）

1. **编译 + 类型检查**：
   ```bash
   npx tsc --noEmit
   ```
   严格模式零错误（重点关注：导出完整性、`view` 参数类型推断）。

2. **Build**：
   ```bash
   npm run build
   ```
   esbuild 打包成功，`main.js` 正常生成。

3. **Lint**：
   ```bash
   npm run lint
   ```
   无新增告警。

4. **单元测试**：
   ```bash
   npm test
   ```
   全量通过，无回归。

### 静态确认

- 全局搜索每个被迁移的方法名，确认主类仍有同名委托方法且新模块函数被正确 import。
- 确认 `iotoTasksCenterView.ts` 行数持续下降。
- 确认 `main.ts` 未被改动。
- 确认无循环依赖（`import type` 只用于主类类型，值导入方向唯一）。

### 手动功能验证（在 Obsidian 中，重构全部完成后）

1. **视图加载**：打开 IOTO Tasks Center 视图，项目/任务列表正常渲染
2. **项目切换**：点击项目，任务列表跟随刷新，滚动位置保留
3. **创建任务**：点击 + 按钮，选择类型创建任务——成功
4. **创建子任务**：右键任务 → 创建子任务——成功
5. **批量创建**：点击批量创建按钮 → 选择模板 → 输入前后缀 → 确认——全部成功
6. **任务操作**：修改优先级、星标、删除任务——功能正常
7. **创建项目**：点击创建项目按钮——成功
8. **外部变更刷新**：修改 vault 文件，视图自动刷新
9. **拖放**：拖动任务建立父子关系——正常
10. **搜索**：搜索 popover 过滤——正常
11. **菜单**：所有右键菜单可正常触发

---

## 相关文件清单

| 文件路径 | 修改类型 | 说明 |
| --- | --- | --- |
| `src/views/tasks-center/data-loader.ts` | **新建** | 项目/任务加载集群（9 方法） |
| `src/views/tasks-center/task-operations.ts` | **新建** | 任务操作集群（16 方法） |
| `src/views/tasks-center/collapse-state.ts` | 新建**（可选 2C）** | 折叠状态管理（8 方法） |
| `src/views/tasks-center/outlink-badges.ts` | 新建**（可选 2C）** | Outlink 徽章更新（5 方法） |
| `src/views/tasks-center/hover-preview.ts` | 新建**（可选 2C）** | 悬停预览（5 方法） |
| `src/views/iotoTasksCenterView.ts` | **修改** | 删除方法体改委托、移除 private 关键字、新增 import |

> `src/main.ts` 及其他文件**不改动**。
