## 概要

在“创建任务 / 创建子任务”的弹窗中新增两个设置项：

- 优先级（写入 frontmatter `Priority`，可选未设置 / P0–P3）
- 是否核心任务（写入 frontmatter `Starred: true`，未勾选则移除 `Starred`）

用户确认创建后，插件会在新建的任务笔记中写入对应属性，且会覆盖模板中可能已存在的 `Priority/Starred`。

## 现状分析（基于仓库实际实现）

- 任务创建入口在 [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
  - 创建任务：`handleCreateTask(type)`
    - `type !== 'date'` 时使用 [taskNameModal.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/taskNameModal.ts) 只收集“名称”
    - `type === 'date'` 直接创建，不弹窗
  - 创建子任务：`handleCreateSubtask(parentTask, type)`
    - 同样 `type !== 'date'` 才弹出 TaskNameModal
- `createTaskFile(...)` 在 [task-creation.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-creation.ts) 创建文件并写入基础属性（如 `Project/Subject/Plan`），可能会应用模板后再写入属性。
- 已有写入/清除属性的工具函数：
  - 优先级：`setTaskFilePriority / clearTaskFilePriority`（写入 `Priority`）见 [task-priority.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-priority.ts)
  - 核心任务：`setTaskFileStarred / clearTaskFileStarred`（写入/移除 `Starred`）见 [task-starred.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/tasks-center/task-starred.ts)

## 需求确认（来自本次对话回答）

- 日期任务：仍然直接创建，不额外弹窗设置优先级/核心任务
- 模板冲突：以弹窗选择为准；选择“未设置/未勾选”时会移除模板中已有的 `Priority/Starred`
- 默认值：固定默认（优先级=未设置，核心任务=否），不记住上次选择，也不新增插件设置项

## 方案设计

### 1) 新增“创建任务弹窗”组件

新增文件：
- `src/ui/taskCreationModal.ts`

弹窗能力：
- 复用当前 modal 的布局风格（描述文案 + 输入区 + 操作按钮区，沿用 `ioto-tasks-center__modal-*` 相关样式类）
- 字段
  - 名称输入：可选（用于 `type !== 'date'` 的任务/子任务）
  - 优先级下拉：未设置 / P0 / P1 / P2 / P3
  - 核心任务开关：是/否
- 返回值（Promise）
  - 取消：返回 `null`
  - 确认：返回 `{ name: string | null; priority: TaskPriorityValue | null; starred: boolean }`

### 2) 改造任务创建流程（主任务 / 子任务）

修改文件：
- `src/views/iotoTasksCenterView.ts`

改造点：
- `handleCreateTask(type)`
  - `type !== 'date'`：用新的 `TaskCreationModal` 替换现有 `TaskNameModal`
  - 创建文件成功后，在 `refreshFromVaultChange()` 之前对新文件写入属性：
    - `priority === null` → `clearTaskFilePriority(app, file)`
    - `priority !== null` → `setTaskFilePriority(app, file, priority)`
    - `starred === true` → `setTaskFileStarred(app, file)`
    - `starred === false` → `clearTaskFileStarred(app, file)`
- `handleCreateSubtask(parentTask, type)`
  - `type !== 'date'`：同样改用 `TaskCreationModal`
  - 子任务创建后，在触发刷新前完成属性写入与 `UpTask` 写入
    - 推荐顺序：`createTaskFile` → 写入 `Priority/Starred` → `assignUpTaskToFile` → 再执行当前已有的刷新逻辑
    - 保持既有的 `deferVaultRefreshForSubtaskCreation` 机制不变，避免新增“先普通任务后子任务”的闪动
- 日期任务（`type === 'date'`）：保持现状直接创建，不增加新弹窗；因此其 `Priority/Starred` 均为默认空/否（不额外写入）

### 3) i18n 文案

修改文件：
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`
- `src/lang/locale/en.ts`

新增 key（用于优先级下拉的“未设置”选项）：
- `modal.taskSettings.priority.none`
  - zh-CN：`未设置`
  - zh-TW：`未設定`
  - en：`None`

其余标签可直接复用已有 key：
- 优先级 label：`menu.category.priority`
- 核心任务 label：`view.taskCoreBadge.label`

## 边界与失败场景

- 用户取消弹窗：不创建任务/子任务
- 名称为空（仅 `type !== 'date'` 需要）：视为取消创建
- 模板已写 `Priority/Starred`：弹窗默认值也会覆盖（默认未设置/未勾选会移除对应属性）

## 验证方式

自动化检查：
- `npm run build`
- `npm run lint`
- `npm run test`（至少应覆盖现有 `task-priority.test.mjs`、`task-starred*.test.mjs`，以及本次新增/变更不应破坏现有测试）

手动验证（Obsidian 内）：
- 创建普通/主题/计划任务：弹窗可设置 Priority 与核心任务，创建后打开笔记检查 frontmatter
- 创建普通/主题/计划子任务：同上，并确认同时写入 `UpTask`，列表呈现无闪动
- 创建日期任务：仍然直接创建，且不出现新增弹窗
