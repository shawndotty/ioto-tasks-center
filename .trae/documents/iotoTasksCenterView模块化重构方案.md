# iotoTasksCenterView.ts 模块化重构方案（第一阶段）

## 概述

将 3994 行的 `src/views/iotoTasksCenterView.ts`（约 90 个方法的「上帝类」）按业务集群解耦拆分到独立子文件。

**策略**（已与用户确认）：
- **提取函数 + 上下文接口**：各集群方法提取为接收 `view` 实例的独立函数；主类保留为入口，原方法变为单行委托包装，**签名与行为完全不变**，对外契约（`main.ts` 的 27 参数构造函数）零改动。
- **分阶段优先拆分**：本计划为**第一阶段**，仅拆分边界清晰、共享状态少、风险最低的 5 个集群。高耦合集群（渲染、创建/任务操作、项目/任务加载）留待第二阶段。

**目录约定**：拆分后的子文件统一放入与原文件**同目录**的新建文件夹 `src/views/tasks-center/`，保持目录规整。

---

## 当前状态分析

### 文件结构概览（基于实际阅读）

| 区域 | 行号 | 说明 |
| --- | --- | --- |
| 导入块 | 1–137 | 已规范的 `import type` 拆分 |
| `IOTOTasksCenterViewState` 接口 | 142–149 | 视图持久化状态 |
| 常量 | 139–141, 3867–3894 | 视图类型、断点、各 `*_MODE_ORDER` 数组 |
| 主类 `IOTOTasksCenterView` | 151–3845 | ItemView 子类，约 90 个方法 |
| 类外纯函数 | 3847–3994 | 10 个独立辅助函数 |

### 已分离的兄弟模块（`src/views/`）

`task-drag.ts`、`task-filter-tabs.ts`、`task-hierarchy.ts`、`task-hover-preview.ts`、`task-list-presentation.ts`、`task-list-scroll.ts`、`task-preview-state.ts`、`task-search.ts`、`project-list-group.ts`、`project-list-scroll.ts` 等——**这些已是纯函数 + 状态接口模式**，是本次拆分的参考样板（见 `task-preview-state.ts` 的 `TaskPreviewOpenState` 接口 + 纯函数签名）。

### 核心耦合点（重构约束）

- **`render()`**（531 行）、**`refreshFromVaultChange()`**（399 行）、**`loadTasks()`**（503）、**`selectProject()`**（482）、**`ensurePreviewLeaf()`**（3773）是被广泛调用的枢纽方法，任何集群提取后仍需通过 `view` 实例回调它们。
- **`selectedProject`/`tasks`/`projects`** 等字段被多集群共享——本次拆分的 5 个集群对这些字段的依赖较轻（多为只读判断），适合先落地。
- **27 参数构造函数**是对外契约，本阶段**不改动**。

### 第一阶段目标集群（按风险从低到高排序）

| # | 集群 | 原方法（行号） | 行数 | 共享状态依赖 | 拆分文件 |
| --- | --- | --- | --- | --- | --- |
| 1 | 纯函数/常量 | 类外函数 3847–3994 + 常量 3867–3894 | ~150 | 无（纯函数） | `tasks-center/constants.ts` + `tasks-center/helpers.ts` |
| 2 | 预览 leaf 管理 | 3744–3844 | ~100 | previewLeaf 字段 | `tasks-center/preview-leaf.ts` |
| 3 | 拖放控制器 | 2178–2474 | ~297 | 拖放字段组（164–167）+ isUpdatingUpTask | `tasks-center/drag-controller.ts` |
| 4 | 搜索控制器 | 2066–2176 + 2966–3096 部分 | ~120 | taskSearch* 字段（158–161） | `tasks-center/search-controller.ts` |
| 5 | 上下文菜单 | 796–854, 2846–2911, 3066–3399 | ~400 | 主要读 projects/tasks + 调用其他集群方法 | `tasks-center/menus.ts` |

> 集群 5（菜单）依赖最重（调用创建/删除/优先级等方法），但通过 `view` 委托即可解耦，方法签名不变。

---

## 拟定变更

### 通用模式：上下文接口 + 委托包装

每个新模块定义一个 `Context`/`Deps` 接口（或直接复用主类类型），把原方法体提取为接收 `view` 的独立函数。主类中对应方法改为单行委托：

```typescript
// 主类内（签名不变）
private handleTaskDragStart(event, task, rowEl): void {
    handleTaskDragStart(this, event, task, rowEl);
}
```

为减少样板，新模块统一用 `import type { IOTOTasksCenterView } from '../iotoTasksCenterView'` 作为参数类型（主类导出该类型）。这避免为每个模块重复定义庞大的 Context 接口，同时保持类型安全。

---

### 变更 1：拆分纯函数与常量

**新建文件**：`src/views/tasks-center/constants.ts`

迁移内容（从 `iotoTasksCenterView.ts` 移出）：
- 常量：`COMPACT_LAYOUT_BREAKPOINT`（140）、`HOVER_PREVIEW_REFRESH_RETRY_MS`（141）、`PROJECT_LIST_SORT_MODE_ORDER`（3867–3872）、`PROJECT_LIST_GROUP_MODE_ORDER`（3874–3877）、`TASK_LIST_SORT_MODE_ORDER`（3879–3888）、`TASK_LIST_GROUP_MODE_ORDER`（3890–3894）。
- 类外纯函数：`getTaskDropValidationMessage`（3983–3994）、`isIncompleteTaskStatus`（3977–3981）、`parseViewState`（3944–3975）、`getWorkspaceLeafId`（3935–3942）。

**新建文件**：`src/views/tasks-center/helpers.ts`

迁移内容：
- 类外纯函数：`getTaskCreationOptions`（3847–3857）、`buildProjectGroupBodyId`（3859–3865）、`getTaskPriorityVisibilityOptions`（3895–3900）、`formatPriorityMenuTitle`（3902–3907）、`formatMenuOptionTitle`（3909–3917）、`getTaskPriorityClassName`（3919–3933）。

**主文件改动**：删除上述定义，改为从新模块 `import`。`IOTOTasksCenterViewState` 接口（142–149）也一并迁入 `constants.ts` 并 re-export，主文件 `import type` 引用。

**为什么先做**：纯函数无 `this` 依赖，零风险，立即减少 ~150 行；为后续集群拆分提供落点。

---

### 变更 2：拆分预览 leaf 管理

**新建文件**：`src/views/tasks-center/preview-leaf.ts`

迁移方法（提取为接收 `view: IOTOTasksCenterView` 的函数）：
- `getActiveTaskPath`（3744–3752）
- `getPreviewLeafFilePath`（3754–3761）
- `activatePreviewLeaf`（3763–3771）
- `ensurePreviewLeaf`（3773–3790）
- `isLeafAvailable`（3792–3800）
- `findReusablePreviewLeaf`（3802–3811）
- `findLeafByFilePath`（3813–3828）
- `findLeafById`（3830–3844）

**主文件改动**：这 8 个方法改为委托调用，签名不变。

**依赖**：仅访问 `view.app`、`view.previewLeaf`、`view.openedTaskPath`、`view.leaf`，耦合面小。

---

### 变更 3：拆分拖放控制器

**新建文件**：`src/views/tasks-center/drag-controller.ts`

迁移方法：
- `handleTaskDragStart`（2178–2200）
- `handleTaskDragOver`（2202–2226）
- `handleTaskDragLeave`（2228–2246）
- `handleTaskDrop`（2248–2275）
- `setCurrentDropTarget`（2277–2301）
- `clearTaskDragState`（2303–2322）
- `getTaskRowElements`（2324–2330）
- `findTaskRowByPath`（2332–2340）
- `assignDraggedTaskToParent`（2342–2376）
- `handleRemoveUpTaskDragOver`（2378–2393）
- `handleRemoveUpTaskDragLeave`（2395–2406）
- `handleRemoveUpTaskDrop`（2408–2421）
- `clearCurrentTaskDropTargetClasses`（2423–2442）
- `removeDraggedTaskParent`（2444–2474）

**主文件改动**：14 个方法改为委托。

**依赖**：访问拖放字段组（`draggingTaskPath` 等）、`isUpdatingUpTask`、`tasks`、`contentEl`，并回调 `loadTasks`、`render`、`assignUpTaskToFile`/`removeUpTaskFromFile`。这些均通过 `view.xxx` 访问，无需新增参数。

---

### 变更 4：拆分搜索控制器

**新建文件**：`src/views/tasks-center/search-controller.ts`

迁移方法：
- `canSearchTasks`（2066–2073）
- `shouldShowTaskSearchIcon`（2075–2082）
- `toggleTaskSearchPopover`（2084–2097）
- `openTaskSearchPopover`（2099–2144）
- `closeTaskSearchPopover`（2146–2150）
- `applyTaskSearchQuery`（2152–2163）
- `clearTaskSearch`（2165–2176）

**主文件改动**：7 个方法改为委托。

**依赖**：访问 `taskSearch*` 字段组、`taskSearchPopover` 实例、`selectedProject`、`taskResult`、`isTasksLoading`，回调 `render`、`applyTaskSearchQuery`。耦合面可控。

> **死代码清理**：`renderTaskSearch`（2013–2064）经 grep 确认无任何调用方（搜索已改用 popover 流）。本次**移除该方法**，减少 ~52 行死代码。

---

### 变更 5：拆分上下文菜单

**新建文件**：`src/views/tasks-center/menus.ts`

迁移方法：
- `showProjectContextMenu`（796–838）
- `openProjectSpecByProject`（840–854）
- `showProjectSwitcherMenu`（2846–2874）
- `showProjectPresentationMenu`（3105–3169）
- `showTaskPresentationMenu`（3171–3261）
- `showTaskPriorityMenu`（3263–3374）
- `showTaskSubtaskTypeMenu`（3376–3399）

**主文件改动**：7 个方法改为委托。

**依赖**：这是依赖最重的集群——菜单项回调会触发创建任务、删除、优先级/星标切换、排序/分组变更等。但这些回调全部通过 `view.handleCreateTask()`、`view.confirmAndDeleteTask()` 等方法委托，无需改动被调用方签名。仅访问 `projects`、`tasks`、配置 getter 字段（只读）。

---

## 假设与决策

1. **不引入 Controller 类**：采用「函数 + view 参数」而非独立 Controller 类，与既有兄弟模块（`task-preview-state.ts` 等）的纯函数风格一致，改动面最小。
2. **参数类型用主类类型**：新模块函数参数统一为 `view: IOTOTasksCenterView`，避免为每个模块维护庞大的 Context 接口。主类需 `export`（已导出）。这是 TypeScript 结构类型，不会产生循环运行时依赖（仅类型导入）。
3. **委托包装保留原签名**：主类中原方法保留为 `private`/`public` 单行委托，确保所有内部调用点（`this.handleTaskDrop(...)`）和外部调用点无需改动。
4. **不改动对外契约**：27 参数构造函数、`getViewType`、`getState/setState`、`onOpen/onClose` 等**全部不动**。
5. **死代码清理**：仅移除已确认无引用的 `renderTaskSearch`，不做其他「顺手优化」。
6. **目录结构**：新建 `src/views/tasks-center/` 文件夹收纳所有新模块，与既有 `src/views/*.ts` 兄弟模块平级但隔离，命名空间清晰。
7. **第一阶段范围**：只拆 5 个集群（约 1070 行 + 150 行纯函数）。渲染集群（~870 行）、创建/任务操作集群（~400 行）、项目/任务加载集群（~150 行）留待第二阶段，因其与 `render`/`refreshFromVaultChange` 枢纽深度耦合，需更谨慎设计。
8. **循环依赖规避**：新模块仅 `import type` 主类（类型 only），主类 `import` 新模块的函数（值），方向单一，无循环。

---

## 验证步骤

### 自动化验证（每完成一个集群即执行）

1. **编译 + 类型检查**：
   ```bash
   npm run build
   ```
   tsc 严格模式无错误（重点关注：导出完整性、`view` 参数类型推断、`import type` 正确性）。

2. **Lint**：
   ```bash
   npm run lint
   ```
   无新增告警（关注 `no-unused-vars`——委托包装的方法若变为单行可能触发，需保留调用）。

3. **单元测试**：
   ```bash
   npm test
   ```
   全量通过，无回归（既有测试覆盖纯函数；UI/方法无测试，依赖编译保证）。

### 静态确认（避免遗漏）

- 全局搜索每个被迁移的方法名，确认主类仍有同名委托方法、且新模块函数被正确 import。
- 确认 `iotoTasksCenterView.ts` 行数显著下降（第一阶段目标：从 ~3994 行降至 ~2900 行以下）。
- 确认 `main.ts` 未被改动（对外契约零变更）。

### 手动验证（在 Obsidian 中，重构全部完成后）

1. **视图加载**：打开 IOTO Tasks Center 视图，项目列表与任务列表正常渲染。
2. **拖放**：拖动任务到另一任务建立父子关系；拖到移除区解除父子关系——功能正常。
3. **搜索**：点击搜索图标打开 popover，输入关键词过滤，清空搜索——正常。
4. **菜单**：项目右键菜单、任务右键菜单（优先级/星标/子任务/删除）、排序/分组设置菜单——全部可正常触发。
5. **预览**：点击任务在右侧预览打开；切换任务预览跟随——正常。
6. **紧凑布局**：缩窄窗口至 720px 以下，项目切换器出现——正常。
7. **状态持久化**：切换项目/标签后关闭重开视图，状态恢复——正常。

---

## 相关文件清单

| 文件路径 | 修改类型 | 说明 |
| --- | --- | --- |
| `src/views/tasks-center/constants.ts` | 新建 | 常量 + 纯函数（parseViewState 等）+ State 接口 |
| `src/views/tasks-center/helpers.ts` | 新建 | 纯辅助函数（菜单文案、CSS 类名等） |
| `src/views/tasks-center/preview-leaf.ts` | 新建 | 预览 leaf 管理（8 方法） |
| `src/views/tasks-center/drag-controller.ts` | 新建 | 拖放控制器（14 方法） |
| `src/views/tasks-center/search-controller.ts` | 新建 | 搜索控制器（7 方法） |
| `src/views/tasks-center/menus.ts` | 新建 | 上下文菜单（7 方法） |
| `src/views/iotoTasksCenterView.ts` | 修改 | 删除迁移代码、改为委托调用、删除死代码 renderTaskSearch、import 新模块 |

> `src/main.ts` 及其他文件**不改动**。
