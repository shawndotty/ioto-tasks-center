# 计划：修复任务列表右键标记优先级/核心任务后回顶

## Summary

- 修复任务中心任务列表中，用户通过右键菜单“设置优先级”或“标记为核心任务”后，任务列表自动回滚到第一屏的问题。
- 本次修复只针对“当前项目内的任务刷新”场景，确保列表在右键操作后保留原有滚动位置。
- 不改变“真正切换项目时回到顶部”的现有行为。

## Current State Analysis

- 任务列表滚动状态由 `taskListScrollTop` 缓存，定义在 [iotoTasksCenterView.ts:L157-L160](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L157-L160)。
- `render()` 开头会先读取旧 DOM 里的任务列表滚动位置，再重建整棵视图，见 [iotoTasksCenterView.ts:L452-L483](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L452-L483)。
- 当前滚动工具 [task-list-scroll.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/task-list-scroll.ts) 的 `captureTaskListScrollTop()` 只做最简单的 `listEl.scrollTop` 读取：
  - 找到列表就直接返回 `scrollTop`
  - 不判断当前这一帧是否处于“不可滚动的 loading/empty state”
- 右键菜单中“设置优先级 / 清除优先级 / 标记核心任务 / 取消核心任务”最终都走 [refreshCurrentProjectTasks()](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2808-L2816)：
  1. `isTasksLoading = true`
  2. `render()` 显示 loading
  3. `loadTasks(this.selectedProject)`
  4. 再次 `render()` 显示刷新后的任务列表
- 这里的关键问题是：第二次 `render()` 前，旧 DOM 已经是 loading 状态列表；该列表通常不可滚动、`scrollTop === 0`，于是当前 helper 会把之前的真实滚动位置覆盖成 `0`，导致最终恢复时回到第一屏。
- 项目中心此前已经处理过同类问题，见 [project-center-scroll.ts:L19-L38](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/project-center-scroll.ts#L19-L38)：
  - 当容器当前不可滚动，且位置是顶部时，不覆盖已有 fallback
- 当前任务列表滚动测试 [task-list-scroll-state.test.mjs](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/tests/task-list-scroll-state.test.mjs) 只覆盖“找不到容器 / 读取旧值 / 恢复新值”，还没有覆盖“loading 态不可滚动时保留 fallback”。

## Assumptions & Decisions

- 本次不修改 `selectProject()` 中的 `this.taskListScrollTop = 0`，因为那是用户真正切换项目时的预期行为。
- 本次优先复用项目中心已验证过的修复思路，而不是在 `updateTaskPriority()` / `updateTaskStarred()` 单独做一次性补丁。
- 修复应放在滚动 helper 层，这样所有“当前项目内刷新但不应回顶”的任务列表场景都能受益，而不仅限于优先级和核心任务菜单。
- 本次不新增 UI、设置项或用户可见文案。

## Proposed Changes

### 1) 增强任务列表滚动捕获逻辑，避免 loading 态覆盖缓存

**文件**：`src/views/task-list-scroll.ts`

- 扩展 `ScrollableElementLike`，增加可选字段：
  - `scrollHeight?: number`
  - `clientHeight?: number`
- 修改 `captureTaskListScrollTop()`：
  - 先读取任务列表元素
  - 若列表不存在，继续返回 `fallbackScrollTop`
  - 若当前元素满足以下条件，则返回 `fallbackScrollTop` 而不是 `0`
    - `scrollHeight` 与 `clientHeight` 都可用
    - `scrollHeight <= clientHeight + 1`
    - `scrollTop === 0`
  - 否则返回真实 `scrollTop`
- 这样在“旧 DOM 已经变成 loading/empty state、无法滚动”的中间 render 中，不会把之前真实的滚动位置覆盖掉。
- `restoreTaskListScrollTop()` 维持现状，不需要修改。

### 2) 为任务列表滚动状态补充回归测试

**文件**：`tests/task-list-scroll-state.test.mjs`

- 在现有 3 个测试基础上，新增与项目中心同类的回归用例：
  - 当任务列表容器不可滚动，且 `scrollTop` 为 `0` 时，应保留传入的 fallback
- 测试模拟对象至少包含：
  - `scrollTop`
  - `scrollHeight`
  - `clientHeight`
- 预期行为示例：
  - fallback 为 `320`
  - 当前列表对象是 `{ scrollTop: 0, scrollHeight: 480, clientHeight: 480 }`
  - `captureTaskListScrollTop(...)` 应返回 `320`

### 3) 复核右键刷新链路无需额外改动

**文件**：`src/views/iotoTasksCenterView.ts`

- 当前右键菜单操作位于：
  - [updateTaskPriority](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2697-L2717)
  - [clearTaskPriority](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2719-L2736)
  - [updateTaskStarred](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2738-L2755)
  - [clearTaskStarred](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2757-L2774)
  - 它们统一调用 [refreshCurrentProjectTasks](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2808-L2816)
- 计划上先不改这些方法本身，因为问题根因在通用滚动捕获 helper；若 helper 修复后滚动仍丢失，再考虑在 `refreshCurrentProjectTasks()` 前显式快照并在完成后恢复。
- 以当前仓库状态判断，大概率无需改动该文件。

## Verification Steps

- 单元测试：
  - `node --test tests/task-list-scroll-state.test.mjs`
- 全量校验：
  - `npm test`
  - `npm run build`
  - `npm run lint`
- 手动回归（Obsidian）：
  1. 进入任务中心，确保某项目任务列表超过一屏
  2. 滚动到中下部任务
  3. 右键任务，设置优先级或取消优先级
  4. 确认任务列表刷新后仍停留在原滚动位置，不回到第一屏
  5. 右键任务，标记为核心任务或取消核心任务
  6. 确认任务列表同样保留当前位置
  7. 再验证真正切换到另一个项目时，列表仍从顶部开始，行为不变

