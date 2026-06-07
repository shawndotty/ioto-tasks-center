# 计划：任务列表点击不回顶 + 移除父任务 Drop 区域悬浮

## Summary

修复任务中心右侧任务列表在任务过多时的两个体验问题：

1. 当滚动到超过第一屏后点击任务打开预览，任务列表不再回滚到第一屏（保持当前位置）。
2. “移除父任务”的 drop 区域不再跟随列表滚动；仅在拖拽任务时悬浮显示在列表顶部，便于拖拽操作。

## Current State Analysis

### 1) 点击任务导致列表回顶

- 点击任务行会调用 `openTaskFile()` → `openFileInPreview()`（见 [iotoTasksCenterView.ts:L859-L1025](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L859-L1025)、[iotoTasksCenterView.ts:L2426-L2560](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2426-L2560)）。
- `openFileInPreview()` 会在打开文件前后分别 `this.render()` 两次（用于 `opening` 状态），而 `render()` 会 `root.empty()` 重建整个 DOM（见 [iotoTasksCenterView.ts:L429-L456](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L429-L456)）。
- 任务列表 `.ioto-tasks-center__task-list` 是滚动容器（CSS `overflow:auto`，见 [styles.css:L417-L433](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L417-L433)）。DOM 被重建后滚动位置丢失，表现为回到顶部。
- 现有“项目列表”已有滚动位置缓存/恢复实现（`captureProjectListScrollTop` / `restoreProjectListScrollTop`，见 [project-list-scroll.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/project-list-scroll.ts)），任务列表尚无同类机制。

### 2) 移除父任务 Drop 区域跟随滚动

- “移除父任务” drop 区域当前创建在 `listEl`（任务列表滚动容器）内部（见 [iotoTasksCenterView.ts:L694-L856](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L694-L856)），因此会随着列表一起滚动。
- 该区域样式目前是普通块级元素（无 sticky/absolute），见 [styles.css:L774-L804](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L774-L804)。
- 任务分组 header 已使用 `position: sticky; top: 0;`（见 [styles.css:L446-L473](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L446-L473)），如果 drop zone 也要悬浮，需要处理与分组 sticky header 的顶端占位冲突。

## Decisions (User Confirmed)

- 点击任务打开预览：**保持当前位置**（不自动滚动到激活任务）。
- “移除父任务” drop 区域：**仅拖拽时悬浮显示**。

## Proposed Changes

### A) 任务列表滚动位置缓存/恢复

#### A1. 新增滚动工具文件

- 新增：`src/views/task-list-scroll.ts`
- 与项目列表滚动工具对齐，提供：
  - `TASK_LIST_SELECTOR = '.ioto-tasks-center__task-list'`
  - `captureTaskListScrollTop(container, fallbackScrollTop)`
  - `restoreTaskListScrollTop(listEl, scrollTop)`（含 `requestAnimationFrame` 二次设置）
- 捕获策略：优先读取旧 DOM 的 `scrollTop`；无法找到元素时回退到 `fallbackScrollTop`。

#### A2. 在 `IOTOTasksCenterView` 中接入

- 修改：`src/views/iotoTasksCenterView.ts`
- 新增字段：
  - `private taskListScrollTop = 0;`
- 在 `render()` 中、`root.empty()` 前新增捕获：
  - `this.taskListScrollTop = captureTaskListScrollTop(this.contentEl, this.taskListScrollTop);`
- 在 `renderTasksPane()` 中：
  - 创建 `listEl` 后绑定 `scroll` 事件更新 `this.taskListScrollTop`
  - 在各个 return 分支（loading/empty/success）里调用 `restoreTaskListScrollTop(listEl, this.taskListScrollTop)`
  - 在“成功渲染任务列表”（渲染完 sections/rows）后再 restore，避免内容未渲染导致 scrollTop 被钳制为 0
- 为避免切换项目时保留旧滚动位置影响体验，在 `selectProject(projectName)` 开始时重置：
  - `this.taskListScrollTop = 0;`

#### A3. 单测

- 新增：`tests/task-list-scroll-state.test.mjs`
- 覆盖：
  - 未找到任务列表容器时回退到 fallback
  - 能从旧任务列表元素读取 scrollTop
  - 能把缓存 scrollTop 恢复到新任务列表元素

### B) “移除父任务” Drop 区域仅拖拽时悬浮显示

#### B1. 渲染结构保持不变，改为“默认隐藏 + 拖拽时显示”

- 修改：`src/views/iotoTasksCenterView.ts`
- 仍然在 `listEl` 顶部创建 drop zone（现有行为），保持现有 dragover/dragleave/drop 逻辑不变（见 [iotoTasksCenterView.ts:L778-L793](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L778-L793)）。
- 增加“可见性”控制：
  - 在 `renderTasksPane()` 创建 `listEl` 后：
    - `listEl.toggleClass('has-remove-up-task-drop-zone', Boolean(this.draggingTaskPath));`
  - 在 `handleTaskDragStart()` 中：
    - 给当前任务列表容器增加 `has-remove-up-task-drop-zone`（通过 `this.contentEl.querySelector(TASK_LIST_SELECTOR)` 获取）
  - 在 `clearTaskDragState()` 里移除 `has-remove-up-task-drop-zone`

#### B2. CSS：悬浮与占位冲突处理

- 修改：`styles.css`
- 让 drop zone 悬浮于列表顶部：
  - `.ioto-tasks-center__remove-up-task-drop-zone` 增加 `position: sticky; top: 0; z-index: 2;`
  - 默认隐藏（避免平时占位和干扰）：
    - `.ioto-tasks-center__remove-up-task-drop-zone { display: none; }`
    - `.ioto-tasks-center__task-list.has-remove-up-task-drop-zone .ioto-tasks-center__remove-up-task-drop-zone { display: block; }`
- 处理分组 sticky header 与 drop zone 叠加：
  - 把 `.ioto-tasks-center__task-group-header { top: 0; }` 改为使用 CSS 变量：
    - `top: var(--ioto-task-sticky-top, 0px);`
  - 当 drop zone 可见时，为任务列表容器提供偏移量：
    - `.ioto-tasks-center__task-list.has-remove-up-task-drop-zone { --ioto-task-sticky-top: 54px; }`
  - `54px` 作为固定偏移量，用于给 drop zone 预留顶部空间（实际值可在执行阶段根据 UI 微调，但会保持小范围、可读、稳定）。

## Verification

### 自动化

- `npm test`
- `npm run build`
- `npm run lint`

### 手动（Obsidian）

1. 打开任务中心，选择一个任务很多的项目
2. 滚动到第二屏及以下，点击任意任务打开预览，任务列表保持当前位置不回顶
3. 开始拖拽一个任务：
   - 顶部出现“移除父任务” drop 区域，并在滚动任务列表时仍悬浮在顶部
4. 拖拽结束（drop 或取消）：
   - drop 区域自动隐藏

