# 计划：任务搜索条件保留时的提示条（popover 关闭）

## Summary

在任务中心中，当任务搜索的已生效条件（`taskSearchQuery`）仍存在、但搜索 popover 已关闭时，在搜索图标左侧显示“当前搜索关键词提示条 + 清空按钮”。点击清空按钮取消搜索过滤。用户再次点击搜索图标打开 popover 时，不显示提示条，仅在 popover 输入框中展示当前关键词。

## Current State Analysis

- 搜索相关状态（见 [iotoTasksCenterView.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)）：
  - `taskSearchQuery`：已应用并生效的过滤条件
  - `taskSearchInputValue`：输入框临时值（可能未应用）
  - `isTaskSearchPopoverOpen`：popover 是否打开
- popover 关闭方式（见 [task-search-popover.ts](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/ui/task-search-popover.ts#L91-L123)）：
  - 点击外部或按 `Escape` 会关闭 popover，并调用 `onClose` 回调，仅更新 `isTaskSearchPopoverOpen`，不会清空 `taskSearchQuery`，因此过滤仍然生效但缺少可见提示。
- 任务面板 header actions 区域渲染在 `renderTasksPane()`（见 [iotoTasksCenterView.ts:L684-L765](file:///Users/johnny/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L684-L765)），搜索图标同处该区域。

## Assumptions & Decisions

- “提示条”仅展示关键词本身（`taskSearchQuery.trim()`），不额外增加固定前缀文案。
- 清空按钮复用现有 i18n：`view.search.clear` / `view.search.clearShort`（ariaLabel/title），按钮文字使用现有模式 `X`。
- 提示条只反映“已应用的搜索条件”（`taskSearchQuery`），不展示未应用的输入值（`taskSearchInputValue`）。

## Proposed Changes

### 1) 任务中心：渲染搜索提示条

**文件**：`src/views/iotoTasksCenterView.ts`

- 在 `renderTasksPane()` 的 `actionsEl` 中、创建搜索图标按钮之前插入提示条。
- 显示条件：
  - `shouldShowSearchIcon === true`（确保仅在任务列表可搜索时出现）
  - `!this.isTaskSearchPopoverOpen`（popover 打开时不显示提示条）
  - `this.taskSearchQuery.trim().length > 0`（存在已生效的关键词）
- DOM 结构：
  - `div.ioto-tasks-center__task-search-hint`
    - `span.ioto-tasks-center__task-search-hint-text`：展示关键词（ellipsis）
    - `button.ioto-tasks-center__task-search-hint-clear`：点击调用 `this.clearTaskSearch()`，并 `preventDefault/stopPropagation`，避免触发其他 header 点击逻辑
- 交互结果：
  - popover 关闭但仍有过滤：提示条可见
  - 点击搜索图标打开 popover：提示条隐藏，popover 输入框仍显示当前值（现有 popover `value` 使用 `taskSearchInputValue`）
  - 点击清空：清空过滤并触发 `render()`（复用现有 `clearTaskSearch()`）

### 2) CSS：提示条样式

**文件**：`styles.css`

- 新增样式，满足“紧贴搜索图标左侧、可截断、清空按钮可点击”的展示需求：
  - `.ioto-tasks-center__task-search-hint`：inline-flex + pill 样式 + 最大宽度
  - `.ioto-tasks-center__task-search-hint-text`：单行截断
  - `.ioto-tasks-center__task-search-hint-clear`：18×18 清空按钮，hover 高亮

## Verification

- 自动化：
  - `npm test`
  - `npm run build`
  - `npm run lint`
- 手动（Obsidian）验收步骤：
  1. 打开任务中心 → 点击搜索图标 → 输入关键词 → 执行搜索（列表被过滤）
  2. 点击界面空白处关闭 popover：过滤仍在，同时搜索图标左侧出现提示条 + 清空按钮
  3. 点击清空按钮：过滤取消、提示条消失、列表恢复
  4. 在提示条存在时点击搜索图标：提示条消失，popover 打开，输入框中仍展示当前关键词

