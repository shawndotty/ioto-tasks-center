# 计划：搜索框关闭但仍有搜索条件时显示提示条

## Summary

在任务中心任务列表的搜索功能中，如果搜索条件（`taskSearchQuery`）仍然存在，但搜索 popover 已关闭，则在搜索图标左侧显示一个“当前搜索内容提示”，并提供清空按钮。用户点击清空即可取消搜索。用户再次点击搜索图标时，隐藏该提示，仅在弹出的搜索框内展示关键词。

## Current State Analysis

- 搜索状态字段：
  - `taskSearchQuery`：已生效的搜索条件（用于过滤任务列表）
  - `taskSearchInputValue`：输入框当前值（可能未应用）
  - `isTaskSearchPopoverOpen`：popover 是否打开
- 搜索图标与 popover 打开逻辑位于 [iotoTasksCenterView.ts:renderTasksPane](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L684-L754) 与 `toggleTaskSearchPopover/openTaskSearchPopover`（见 [iotoTasksCenterView.ts:L1465-L1526](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L1465-L1526)）。
- popover 点击外部会关闭，并仅更新 `isTaskSearchPopoverOpen` / `shouldFocusTaskSearchPopover`，不会清空 `taskSearchQuery`，因此过滤条件仍生效但 UI 无提示。

## Decisions (User Confirmed)

- 提示样式：**文字 + X 清空按钮**。
- 点击搜索图标：**保留条件**（打开 popover 时输入框带当前关键词，并隐藏提示）。

## Proposed Changes

### 1) 任务中心：渲染“搜索提示条”

**文件**：`src/views/iotoTasksCenterView.ts`

- 在 `renderTasksPane()` 的 `actionsEl` 中、创建搜索图标按钮之前插入提示条渲染：
  - 显示条件：
    - `shouldShowSearchIcon === true`
    - `!this.isTaskSearchPopoverOpen`
    - `this.taskSearchQuery.trim().length > 0`
  - 提示条结构（都放在右侧 actions 区域，紧贴搜索图标左侧）：
    - `div.ioto-tasks-center__task-search-hint`
      - `span.ioto-tasks-center__task-search-hint-text`：显示当前关键词（可做截断）
      - `button.ioto-tasks-center__task-search-hint-clear`：显示 “X”，点击调用 `this.clearTaskSearch()`
  - 交互细节：
    - 点击清空按钮：只清空搜索，不打开 popover
    - 当用户点击搜索图标打开 popover：因为 `isTaskSearchPopoverOpen` 变为 true，提示条自然消失；popover 输入框会显示当前关键词（现有逻辑已经用 `taskSearchInputValue` / `taskSearchQuery` 作为 value）

### 2) CSS：提示条样式与布局

**文件**：`styles.css`

- 新增样式：
  - `.ioto-tasks-center__task-search-hint`
    - `display:inline-flex; align-items:center; gap:6px;`
    - `max-width: 220px; padding: 4px 8px;`
    - `border: 1px solid var(--background-modifier-border); border-radius: 999px;`
    - `background: var(--background-secondary); color: var(--text-muted);`
  - `.ioto-tasks-center__task-search-hint-text`
    - `overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`
  - `.ioto-tasks-center__task-search-hint-clear`
    - 小号按钮：`width/height: 18px; border-radius: 999px; border: 0; background: transparent;`
    - hover 状态略微高亮

### 3) 无需新增 i18n key

- 提示条仅展示用户输入的关键词；清空按钮沿用现有 `view.search.clear` / `view.search.clearShort` 作为 ariaLabel/title（可复用）。

## Verification

- 自动化：`npm test && npm run build && npm run lint`
- 手动（Obsidian）：
  1. 点击搜索图标 → 输入关键词 → 执行搜索
  2. 点击页面其他位置关闭搜索框：任务列表仍过滤，同时搜索图标左侧出现提示条 + X
  3. 点击 X：清空搜索并恢复完整列表，提示条消失
  4. 在提示条存在时点击搜索图标：提示条消失，popover 打开且输入框带当前关键词

