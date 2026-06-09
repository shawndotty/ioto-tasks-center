# 计划：任务列表父任务折叠/展开子任务

## Summary

在任务中心右侧任务列表中，当任务存在子任务（subtask）时，为父任务行增加一个折叠图标。用户点击该图标可折叠/展开该父任务下的所有子任务（包含多级子任务）。

## Current State Analysis

- 任务列表渲染在 [iotoTasksCenterView.ts:renderTaskRows](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L927-L1090)。
  - 每个任务行是一个 `button.ioto-tasks-center__task-row`。
  - 子任务通过 `indentLevel` 标记，并在行上加 `is-subtask` 类（见同文件）。
- 子任务层级顺序由 [buildVisibleTaskHierarchy](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/task-hierarchy.ts#L3-L77) 生成：
  - 返回的数组是深度优先的“可视顺序”，并对每条任务附加 `indentLevel`。
  - 当前并没有“父任务 → 子任务列表”的显式结构；但在该顺序下，父任务的所有后代会连续出现在其后，直到 `indentLevel` 回落到不大于父任务的层级。
- CSS 层面任务缩进由 `--ioto-task-indent-level` 控制（见 [styles.css:L705-L717](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L705-L717)），但当前没有“折叠子任务”的 UI 控件或状态。

## Proposed Changes

### 1) 任务中心：增加“折叠子任务”的状态与切换方法

**文件**：`src/views/iotoTasksCenterView.ts`

- 新增字段：
  - `private readonly collapsedSubtaskParents = new Set<string>();`
- 新增方法：
  - `private toggleSubtasksCollapsed(taskPath: string): void`
    - 若已折叠则删除，否则加入 `collapsedSubtaskParents`
    - 调用 `this.render()` 触发刷新
- 在切换项目时重置：
  - `selectProject(projectName)` 内追加 `this.collapsedSubtaskParents.clear()`，避免不同项目复用折叠状态

### 2) 任务列表：渲染父任务折叠图标，并跳过被折叠父任务的后代

**文件**：`src/views/iotoTasksCenterView.ts`

改造 `renderTaskRows(container, tasks, activeTaskPath)`：

- 将 `for (const task of tasks)` 改为带索引循环，计算：
  - `indent = task.indentLevel ?? 0`
  - `nextIndent = tasks[i + 1]?.indentLevel ?? 0`
  - `hasChildren = nextIndent > indent`（表示该任务在可视顺序上存在后代）
- 引入一个“折叠栈”以控制隐藏范围（支持多级折叠）：
  - 当某父任务 `hasChildren` 且在 `collapsedSubtaskParents` 中时，将其 `indent` 推入栈
  - 当遍历到新任务时，若 `indent <= 栈顶indent` 则弹栈（表示离开了该折叠范围）
  - 若栈非空，说明当前任务是某个折叠父任务的后代，直接 `continue` 不渲染
- 当 `hasChildren` 时，为该任务行标题左侧增加折叠图标：
  - 在 `.ioto-tasks-center__task-title` 内创建 icon 容器（span）
  - 使用现有 `setIcon(..., 'chevron-right')`
  - 通过 class 控制旋转来表达展开/折叠（与任务分组 header 的交互一致）
  - 点击 icon 时 `preventDefault + stopPropagation`，只切换折叠，不触发打开任务
- 可访问性：
  - icon 设置 `ariaLabel`：
    - 展开状态：显示“折叠子任务”
    - 折叠状态：显示“展开子任务”

### 3) 样式：子任务折叠图标布局与旋转

**文件**：`styles.css`

- 新增图标样式（命名示例）：
  - `.ioto-tasks-center__subtask-toggle-icon`
    - `display:inline-flex; width/height:16px; flex:0 0 auto; color: var(--text-faint); transition: transform 120ms ease;`
  - `.ioto-tasks-center__subtask-toggle-icon.is-expanded { transform: rotate(90deg); }`
  - `.ioto-tasks-center__subtask-toggle-icon:hover { color: var(--text-muted); }`（保持轻量交互，不改变整体风格）

### 4) 文案：新增 i18n key

**文件**：
- `src/lang/locale/en.ts`
- `src/lang/locale/zh-cn.ts`
- `src/lang/locale/zh-tw.ts`

新增键：
- `view.subtasks.collapse`：折叠子任务 / Collapse subtasks / 折疊子任務
- `view.subtasks.expand`：展开子任务 / Expand subtasks / 展開子任務

## Assumptions & Decisions

- 默认显示为“展开状态”（不自动折叠）。
- 折叠状态仅在内存中维护：
  - 重新渲染保留
  - 切换项目时清空
  - 不写入 settings（避免引入持久化与迁移成本）
- 若用户折叠导致当前激活任务（activeTaskPath）不可见，不自动强制展开（用户可通过再次点击父任务图标展开）。

## Verification

### 自动化

- `npm test`
- `npm run build`
- `npm run lint`

### 手动（Obsidian）

1. 打开任务中心，进入一个包含父子任务的项目
2. 在父任务行点击折叠图标：
   - 所有缩进更深的后代任务消失
3. 再次点击该图标：
   - 后代任务恢复显示，顺序与缩进保持不变
4. 多级子任务：
   - 折叠父任务应同时隐藏孙子任务
5. 切换项目后返回：
   - 默认展开（折叠状态不跨项目保留）

