# IOTO Tasks Center — 任务搜索框改为图标 + 悬浮搜索框

## Summary

把任务中心任务列表上方的“常驻搜索框”改为默认隐藏：在“添加任务”按钮左侧显示一个搜索图标；点击图标后在其附近弹出悬浮搜索框（popover）。当“当前项目没有任何任务”时，不显示搜索图标。搜索框执行搜索后保持打开，点击外部或按 Esc 关闭。

## Current State Analysis

### 搜索框渲染与过滤逻辑

- 任务面板渲染入口：`renderTasksPane()`  
  [iotoTasksCenterView.ts:L671-L706](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L671-L706)
  - 当前在任务描述下方固定调用 `this.renderTaskSearch(container)`，导致搜索框常驻占空间。
- 搜索框 UI：`renderTaskSearch()`  
  [iotoTasksCenterView.ts:L1312-L1363](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1312-L1363)
  - `input[type=search]` 更新 `taskSearchInputValue`
  - Enter 或点击按钮触发 `applyTaskSearchQuery()`，把 `taskSearchInputValue` 提交到 `taskSearchQuery` 并 `render()`
  - `clearTaskSearch()` 清空并 `render()`
- 过滤生效点：
  - `getVisibleTasks()`：tab 过滤后再 `filterTasksBySearchQuery(..., this.taskSearchQuery)`  
    [iotoTasksCenterView.ts:L2029-L2034](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L2029-L2034)
  - `filterTasksBySearchQuery()`：对 title/basename 做 includes 匹配  
    [task-search.ts:L21-L31](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/task-search.ts#L21-L31)

### Header actions 区域

- `renderTasksPane()` header actions 当前仅有 add-task button：  
  [iotoTasksCenterView.ts:L671-L696](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L671-L696)
- 项目面板已有 icon button 先例（`ioto-tasks-center__icon-button` + `setIcon`）：  
  [iotoTasksCenterView.ts:L482-L503](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L482-L503)
- icon button CSS：  
  [styles.css:L115-L151](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css#L115-L151)

### 已确认偏好（来自用户选择）

- 执行搜索后弹窗保持打开（直到点外部或按 Esc）。
- “没有任务不显示图标”按“当前项目全部任务”口径判断（即 `this.tasks.length === 0`）。

## Proposed Changes

### 1) 任务搜索 UI 改造：从“常驻”改为“图标 + popover”

**修改文件**

- [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

**新增状态字段**

- `private isTaskSearchPopoverOpen = false;`
- `private shouldFocusTaskSearchPopover = false;`
- `private taskSearchAnchorEl: HTMLElement | null = null;`（用于 render 后重新绑定 anchor）
- `private taskSearchPopover: TaskSearchPopover | null = null;`

**renderTasksPane 调整**

- 移除固定调用 `this.renderTaskSearch(container)`。
- 在 header 的 `actionsEl` 中：
  - 先渲染“搜索图标按钮”（`ioto-tasks-center__icon-button` + `setIcon(..., 'search')`），再渲染 add-task button。
  - 图标显示条件：
    - `this.selectedProject` 已选择
    - `this.taskResult?.status === 'success'`（任务已加载）
    - `this.tasks.length > 0`（当前项目至少有一条任务；与用户口径一致）
  - 点击图标：
    - toggle `isTaskSearchPopoverOpen`
    - 打开时 `shouldFocusTaskSearchPopover = true`
    - 调用 `this.openTaskSearchPopover(anchorEl)` / `this.closeTaskSearchPopover()`（不触发 render，或按需要 render）
- 在 `render()` 末尾/`renderTasksPane()` 内部：
  - 如果 `isTaskSearchPopoverOpen` 为 true 且本次仍满足显示条件，确保 popover 已经打开并锚定到最新的 icon DOM（解决 render() 重建 DOM 后 anchor 失效的问题）。
  - 若不再满足显示条件（例如 tasks 变为 0），强制关闭 popover 并将 `isTaskSearchPopoverOpen = false`。

**关闭策略**

- 点击外部：关闭 popover，并把 `isTaskSearchPopoverOpen = false`
- 按 Esc：关闭 popover，并把 `isTaskSearchPopoverOpen = false`
- 执行搜索（Enter/按钮）：仅调用 `applyTaskSearchQuery()`，保持 popover 打开（不额外关闭）

### 2) 新增 TaskSearchPopover 组件（复用现有搜索控件 DOM 结构/样式）

**新增文件**

- `src/ui/task-search-popover.ts`

**接口**

- `interface TaskSearchPopoverOptions { anchorEl: HTMLElement; doc: Document; placeholder: string; value: string; canSearch: boolean; showClear: boolean; onChange: (v: string) => void; onApply: () => void; onClear: () => void; onClose: () => void; shouldFocus: boolean }`
- `class TaskSearchPopover { open(opts); close(); destroy(); }`

**实现要点**

- 采用 `position: fixed` + `getBoundingClientRect()` 定位到 icon 下方；空间不足则放上方（逻辑可参考现有 outlink popover 的定位实现）。
- popover 内容使用现有 class 复用样式：
  - `div.ioto-tasks-center__task-search-controls`
  - `div.ioto-tasks-center__task-search-input-wrapper`
  - `input.ioto-tasks-center__task-search-input`
  - `button.ioto-tasks-center__task-search-clear-button`（按 `showClear` 条件渲染）
  - `button.ioto-tasks-center__task-search-button`
- 打开时：
  - 注册 document 捕获阶段 `mousedown`（点外部关闭）
  - 注册 document 捕获阶段 `keydown`（Esc 关闭）
  - 如 `shouldFocus`，在 `requestAnimationFrame` 后 focus input
- 关闭时：
  - 清理 DOM 与监听器
  - 调用 `onClose()` 回写 view 状态

### 3) CSS：新增 popover 容器样式（不占布局空间）

**修改文件**

- [styles.css](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css)

**新增 class**

- `.ioto-tasks-center__task-search-popover`
  - `position: fixed; z-index: 9999;`
  - 背景/边框/阴影与 outlink popover 风格一致
  - `width: min(420px, calc(100vw - 16px))`
  - `padding: 10px`

说明：搜索控件本身的样式沿用现有 `.ioto-tasks-center__task-search-*`，避免重复造轮子。

### 4) i18n：新增“打开搜索”图标按钮文案

**修改文件**

- [en.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/en.ts)
- [zh-cn.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-cn.ts)
- [zh-tw.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/lang/locale/zh-tw.ts)

**新增 key（建议）**

- `view.search.toggle`：用于搜索图标按钮的 ariaLabel/title

## Assumptions & Decisions

- “没有任务”按“当前项目 tasks 总数”为 0 判断（与用户选择一致），而不是按当前 tab 或当前搜索结果。
- 搜索 popover 执行搜索后不自动关闭（与用户选择一致）。
- popover 仅在任务已加载成功时显示；加载中/未选项目/根目录缺失时不显示搜索图标。

## Acceptance Criteria

- 默认不再显示常驻搜索框，任务面板顶部视觉更简洁。
- 在“添加任务”按钮左侧出现搜索图标；点击后弹出悬浮搜索框。
- 悬浮搜索框支持：
  - 输入关键字、Enter 或点击 Search 触发过滤
  - Clear 清空关键字与结果
  - 点击外部或按 Esc 关闭
  - 执行搜索后弹窗保持打开
- 当当前项目没有任何任务时，不显示搜索图标。
- 多语言：搜索图标按钮 ariaLabel/title 随语言变化。

## Verification Steps

1. `npm test`
2. `npm run build`
3. Obsidian 手动验证：
   - 选择有任务的项目：确认顶部不再有常驻搜索框，显示搜索图标；点击图标弹出搜索框并可正常过滤；执行搜索后 popover 不关闭；点外部/Esc 关闭。
   - 选择无任何任务的项目：确认不显示搜索图标。
   - 切换项目 / 切换 tab / 编辑搜索关键字：过滤逻辑保持一致，且不出现位置错乱或残留 popover。

