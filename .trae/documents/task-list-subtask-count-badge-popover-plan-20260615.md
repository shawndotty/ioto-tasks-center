## Summary

在任务中心任务列表里，为“有子任务”的任务在标题后增加一个数字 Badge：

- Badge 显示该任务的**直接子任务数量**
- 鼠标悬浮 Badge 时，弹出与“出链 Badge”一致风格的 Popover，列出该任务的**直接子任务链接**（按层级顺序）
- 点击 Popover 中的子任务条目，打开对应子任务笔记（在任务中心右侧预览 pane）
- 在插件**基本设置**中新增开关：是否显示子任务数量 Badge（默认开启）
- 子任务数量可随任务/子任务创建、删除、UpTask 变更等自动刷新更新（依赖现有 vault 变更自动刷新机制）

## Current State Analysis

### Task list rendering

- 任务列表渲染集中在 [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
  - `renderTaskRows(...)` 通过 `indentLevel` + “下一个任务 indentLevel”判断 `hasChildren`（是否存在子任务）
  - 出链 Badge 的 UI 与 Popover 复用 [task-outlink-popover.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/task-outlink-popover.ts)：
    - `.ioto-tasks-center__task-outlink-count` 为 Badge 样式
    - `bindTaskOutlinkPopover(...)` 在 hover 时打开 popover
- 当前的任务树顺序通过 [task-hierarchy.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/task-hierarchy.ts) 的 `buildVisibleTaskHierarchy(...)` 生成（基于 `UpTask`）

### Settings

- 设置结构在 [settings.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/settings.ts) 中定义
- `main.ts` 在注册 `IOTOTasksCenterView` 时通过一系列 getter 把设置注入 view；设置变更通过 `handleSettingsChange()` 触发 view 刷新

## Decisions (confirmed)

- 统计范围：**仅直接子任务**
- Popover 列表来源：**当前项目全部**（即使不在当前 Tab/搜索结果中也展示）
- 排序方式：**按层级顺序**（与任务树展示顺序一致）

## Proposed Changes

### 1) Task hierarchy：提供“直接子任务列表”映射

**Files**
- Update: `src/views/task-hierarchy.ts`

**What / How**
- 在 `task-hierarchy.ts` 中新增导出函数：
  - `buildDirectChildTasksByParentPath(tasks: TaskFileEntry[]): Map<string, TaskFileEntry[]>`
- 复用当前 `buildVisibleTaskHierarchy(...)` 的 parent 解析逻辑（`UpTaskTitles` + `firstTaskPathByTitle`），保证“缩进/折叠子任务”的层级识别与“子任务数量/列表”完全一致
- 返回的 `Map` 中每个 parent path 对应其**直接子任务数组**，数组顺序与 `buildVisibleTaskHierarchy` 追加顺序一致（满足“按层级顺序”）

**Why**
- 避免在 `renderTaskRows` 里每个任务都 O(n) 扫描后续任务计算数量；同时保证与现有子任务树逻辑一致

### 2) Task list：渲染子任务数量 Badge + hover Popover

**Files**
- Update: `src/views/iotoTasksCenterView.ts`

**What / How**
- 在 view 中新增一个设置 getter：`getShowTaskSubtaskCount: () => boolean`
- 在 `renderTaskRows(...)` 开始处（或调用前）基于 `this.tasks` 计算：
  - `const directChildMap = buildDirectChildTasksByParentPath(this.tasks)`
- 对每个任务：
  - 若 `getShowTaskSubtaskCount()` 为 true 且 `directChildMap.get(task.path)?.length > 0`：
    - 在 `.ioto-tasks-center__task-title-text` 之后插入一个 Badge（span）
    - Badge 复用出链 badge 的视觉：使用 `.ioto-tasks-center__task-outlink-count`（可追加一个语义类如 `.ioto-tasks-center__task-subtask-count` 便于未来扩展）
    - 文本为子任务数量
    - ariaLabel 使用 i18n：`task.subtasks.badge`（例如：`子任务：{0}`）
    - 绑定 hover 行为：`bindTaskSubtaskPopover(badgeEl, task.path)`
- 新增 `bindTaskSubtaskPopover(...)`：
  - 复用 `this.outlinkPopover` 打开 popover（保持样式/交互一致）
  - `items` 来自 `directChildMap.get(parentPath)`，并转换为 `TaskOutlinkPopoverItem[]`：
    - `file = vault.getAbstractFileByPath(child.path)`（必须是 `TFile`）
    - `title = child.title`
  - `categoryTitle` 使用 i18n：`task.subtasks.popover.title`（例如：`子任务` / `Subtasks`）
  - `emptyText` 使用 i18n：`task.subtasks.popover.empty`（例如：`暂无子任务。`）
  - 点击条目时：调用 `openFileInPreview(file)`（保证右侧预览 pane 打开，并更新 `openedTaskPath` 等状态）

**Why**
- 与现有出链 badge 保持一致的视觉与交互（hover 出 popover，点击打开）
- 使用 `this.tasks`（当前项目全部任务）计算，满足“当前项目全部”范围
- 借助现有 vault 变更自动刷新逻辑，确保数量随任务/子任务创建、删除、UpTask 变更而更新

### 3) Settings：新增“显示子任务数量”开关（默认开启）

**Files**
- Update: `src/settings.ts`
- Update: `src/main.ts`

**What / How**
- 在 `IOTOTasksCenterSettings` 增加字段：
  - `showTaskSubtaskCount: boolean`
- 在 `DEFAULT_SETTINGS` 里默认设置为 `true`
- 在 `IOTOTasksCenterSettingTab` 的“基本设置”页增加一个 Setting（位置建议紧挨着“任务出链计数”区域之后）：
  - name: `settings.subtasks.showCount.name`
  - desc: `settings.subtasks.showCount.desc`
  - toggle value: `this.plugin.settings.showTaskSubtaskCount`
  - onChange：新增 `this.plugin.updateShowTaskSubtaskCount(value)`
- 在 `main.ts`：
  - 注册 view 时新增 getter 参数 `() => this.settings.showTaskSubtaskCount`
  - 新增 `updateShowTaskSubtaskCount(show: boolean)`：保存设置并 `applySettingsToOpenViews()`

### 4) i18n：新增文案

**Files**
- Update: `src/lang/locale/zh-cn.ts`
- Update: `src/lang/locale/zh-tw.ts`
- Update: `src/lang/locale/en.ts`

**New keys**
- `settings.heading.subtasks`
- `settings.subtasks.showCount.name`
- `settings.subtasks.showCount.desc`
- `task.subtasks.badge`（带占位符 `{0}`）
- `task.subtasks.popover.title`
- `task.subtasks.popover.empty`

## Verification

### Automated
- `npm run build`
- `npm run lint`
- `npm run test`
  - 新增单元测试：`tests/task-hierarchy-subtasks.test.mjs`
    - 给定一组 `TaskFileEntry`（含 `upTaskTitles`），验证 `buildDirectChildTasksByParentPath`：
      - 能正确统计直接子任务数量
      - 返回顺序符合层级顺序
      - 与 `buildVisibleTaskHierarchy` 的父子识别一致（至少覆盖一个简单树）

### Manual (in Obsidian)
- 在任务列表里确认：
  - 有子任务的任务标题后出现数字 Badge
  - hover Badge 出现 popover，列表为该任务的直接子任务
  - 点击 popover 项能在右侧预览 pane 打开对应子任务
- 切换设置“显示子任务数量”：
  - 关闭后 Badge 消失
  - 开启后 Badge 恢复
- 创建/删除子任务、或修改子任务的 `UpTask`：
  - parent 的 Badge 数量会随自动刷新更新

