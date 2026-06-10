# 计划：任务右键菜单顶部增加“添加子任务”

## Summary

- 在任务中心任务列表的每个任务项右键菜单顶部新增“添加子任务”入口。
- 若插件设置中启用了多种任务类型，则点击“添加子任务”后，用**模拟二级菜单**让用户选择子任务类型。
- 若只启用了一种任务类型，则不显示二级菜单，直接进入对应的创建流程。
- 创建出的子任务会保留该类型原本应有的属性，并自动追加 `UpTask` 属性，值为当前右键选中的父任务。

## Current State Analysis

- 当前任务列表的右键菜单入口位于 [iotoTasksCenterView.ts:L1153-L1157](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1153-L1157)，统一调用 `showTaskPriorityMenu(event, task)`。
- 当前右键菜单内容位于 [iotoTasksCenterView.ts:L2510-L2563](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2510-L2563)：
  - 核心任务开关
  - 优先级相关项
  - 删除任务
  - 还没有“添加子任务”
- 顶部“添加任务”按钮已经具备“根据已启用任务类型决定是否直接创建 / 先弹菜单”的现成逻辑，见 [showTaskCreationMenu/handleCreateTask](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1993-L2100)：
  - 已启用类型来自 `this.getEnabledTaskCreationTypes()`
  - 若只启用一种类型则直接进入创建流程
  - 否则显示类型菜单
- 已启用任务类型的标准化逻辑已经存在，见 [enabled-task-creation-types.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/enabled-task-creation-types.ts#L1-L38)。
- 任务创建底层能力已经存在，见 [createTaskFile](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts#L15-L32) 与其调用入口 [handleCreateTask](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2028-L2100)：
  - `date` 类型直接创建
  - 其他类型先通过 `TaskNameModal` 输入名称后创建
- “创建子任务并自动写入 UpTask” 的关键能力其实已经在“将选中文本转为子任务”链路中出现：
  - 当前任务上下文解析：`resolveCurrentTaskContext()`，见 [selected-text-subtask.ts:L128-L149](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/selected-text-subtask.ts#L128-L149)
  - 自动写入 `UpTask`：`assignUpTaskToFile()`，见 [up-task-assignment.ts:L26-L42](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/up-task-assignment.ts#L26-L42)
  - 该上下文里已经能拿到：
    - `projectName`
    - `currentDirectoryPath`
    - `parentTaskTitle`
- 经过检索，当前仓库和本地 `obsidian` 类型定义里都没有公开的原生 submenu API，因此“二级菜单”需要用“点击一级项后再弹出第二个 Menu”的方式模拟，而不是直接调用官方 submenu 方法。

## Assumptions & Decisions

- “任务邮件菜单”按上下文理解为“任务右键菜单”。
- 新入口名称使用“添加子任务”，并固定放在当前右键菜单**最顶部**。
- 多任务类型时采用你确认的方式：**模拟二级菜单**。
- 子任务默认创建在当前父任务所在目录，复用 `resolveCurrentTaskContext()` 的 `currentDirectoryPath`。
- `UpTask` 属性值使用当前右键选中的父任务标题（与现有 `assignUpTaskToFile()` 行为一致，最终写成 `[[父任务标题]]`）。
- 日期任务不弹名称输入框，直接创建；非日期任务继续复用当前 `TaskNameModal` 输入名称后创建。
- 本次不改变顶部“添加任务”按钮的现有逻辑，只新增右键子任务入口。

## Proposed Changes

### 1) 抽出“创建子任务”专用流程

**文件**：`src/views/iotoTasksCenterView.ts`

- 在视图类中新增子任务创建方法，例如：
  - `private async handleCreateSubtask(parentTask: TaskFileEntry, type: TaskCreationType): Promise<void>`
- 实现流程：
  1. 通过当前右键选中的 `parentTask.path` 获取 `TFile`
  2. 调用 `resolveCurrentTaskContext(parentFile, this.getTasksRootPath())`
  3. 若类型不是 `date`，沿用 `TaskNameModal` 收集名称
  4. 调用 `createTaskFile({...})`
     - `projectName` 使用 `currentTaskContext.projectName`
     - `targetDirectoryPath` 使用 `currentTaskContext.currentDirectoryPath`
     - `type` 使用用户选择的子任务类型
     - 其他模板、日期格式、leaf 参数沿用当前 `handleCreateTask()` 的配置方式
  5. 创建成功后调用 `assignUpTaskToFile(this.app, result.file, currentTaskContext.parentTaskTitle)`
  6. 再走现有刷新 + 预览打开逻辑，尽量与 `handleCreateTask()` 保持一致
- 错误处理：
  - 父任务文件不存在：复用 `view.notice.taskFileUnavailable`
  - 创建失败：可新增专门文案，如 `view.notice.createSubtaskFailed`；或者在确认不需要细分时复用 `view.notice.createTaskFailed`

### 2) 在右键菜单顶部加入“添加子任务”

**文件**：`src/views/iotoTasksCenterView.ts`

- 改造 `showTaskPriorityMenu(event, task)`：
  - 在菜单最顶部先加“添加子任务”
  - 再加分隔线
  - 之后保留当前已有的“核心任务 / 优先级 / 删除任务”结构
- 新增方法，例如：
  - `private showAddSubtaskMenu(event: MouseEvent, parentTask: TaskFileEntry): void`
  - 或把这段逻辑整合进 `showTaskPriorityMenu()`
- 类型分流逻辑复用 `showTaskCreationMenu()` 的判断方式：
  - 读取 `this.getEnabledTaskCreationTypes()`
  - 标准化后：
    - 若只剩 1 种：直接 `handleCreateSubtask(parentTask, onlyType)`
    - 若多于 1 种：弹第二个菜单，让用户选择类型

### 3) 用“第二个 Menu”模拟二级菜单

**文件**：`src/views/iotoTasksCenterView.ts`

- 当前仓库无法直接使用原生 submenu API，因此需要在点击“添加子任务”后，再弹出一个新的 `Menu`。
- 推荐实现：
  - 一级菜单项点击时，读取当前鼠标位置（从右键事件中拿 `clientX/clientY`）
  - 创建第二个 `Menu`
  - 依照 `getTaskCreationOptions()` 与已启用类型过滤结果填充项
  - 用 `menu.showAtPosition({ x, y })` 或相邻偏移位置显示
- 这样视觉上就是“一级 -> 二级”的操作体验，且与当前 API 兼容。

### 4) 补充右键子任务入口与相关文案

**文件**：
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`

- 建议新增至少这些 key：
  - `view.taskMenu.addSubtask`
  - `modal.newSubtask.desc`
  - `modal.newNormalSubtask.title`
  - `modal.newNormalSubtask.placeholder`
  - `modal.newTopicSubtask.title`
  - `modal.newTopicSubtask.placeholder`
  - `modal.newPlanSubtask.title`
  - `modal.newPlanSubtask.placeholder`
  - `view.notice.createSubtaskFailed`（如决定区分）
- 文案方向：
  - 菜单顶部：添加子任务
  - 非日期任务的弹窗标题与占位文案明确体现“子任务”

### 5) 尽量复用现有 helper，避免重复业务逻辑

**文件**：
- 以 `src/views/iotoTasksCenterView.ts` 为主
- 仅在确有必要时才新增 helper 文件

- 优先复用：
  - `getTaskCreationOptions()`：类型文案来源
  - `resolveCurrentTaskContext()`：父任务上下文解析
  - `createTaskFile()`：任务文件创建
  - `assignUpTaskToFile()`：写入 `UpTask`
  - `TaskNameModal`：输入子任务名称
- 只有当视图文件会明显变得过大或出现重复逻辑时，再考虑新增如 `task-context-menu-subtask.ts` 一类的小模块。

### 6) 测试与验收策略

**文件**：
- 现有测试为主
- 如需新增，优先业务层纯函数测试，而非重 UI 测试

- 当前仓库里已对“当前任务上下文解析”和 `UpTask` 写入分别有测试：
  - [selected-text-subtask.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/selected-text-subtask.test.mjs#L55-L124)
  - `up-task-assignment` 相关测试已覆盖写入/移除行为
- 本次主要新增的是视图交互，不强行补复杂 DOM 测试。
- 自动化主要依赖：
  - `npm test`
  - `npm run build`
  - `npm run lint`

## Verification Steps

- 自动化：
  - `npm test`
  - `npm run build`
  - `npm run lint`
- 手动（Obsidian）：
  1. 在任务列表里右键某个任务
  2. 确认菜单顶部第一项是“添加子任务”
  3. 若设置里只启用 1 种任务类型，点击后直接进入对应创建流程
  4. 若设置里启用多种任务类型，点击后出现第二层菜单，让用户选择类型
  5. 选择 `date` 子任务时，直接创建成功
  6. 选择非 `date` 子任务时，先输入任务名称，再创建成功
  7. 打开新建出的子任务文件，确认：
     - 正常的任务类型属性仍然存在
     - 自动追加了 `UpTask`
     - `UpTask` 指向当前右键选中的父任务
  8. 确认新子任务位于父任务相同目录下，并在任务中心中正常显示

