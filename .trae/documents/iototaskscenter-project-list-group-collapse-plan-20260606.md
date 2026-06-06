# 任务中心项目列表分组折叠 - 开发计划（2026-06-06）

## Summary

在 **任务中心（Tasks Center）** 的“项目列表”启用 **按项目分类分组** 时，为每个分类分组加入与“任务列表分组”一致的 **折叠/展开**能力：

- 分组标题行可点击折叠/展开
- 标题行显示 chevron 图标与分组内项目数量
- 折叠状态在当前 view 生命周期内保持（刷新仍保持），分组模式关闭时清空

## Current State Analysis

- 项目列表渲染入口： [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)
  - 当前分组标题是 `div.ioto-tasks-center__project-group-header`，不可交互
  - 分组逻辑来自 `buildProjectListSections(...)`，会输出多个 section（groupKey + projects）
- 任务列表分组折叠已有成熟实现（可直接对齐）：
  - `collapsedTaskGroups: Set<string>`
  - `toggleTaskGroupCollapsed()` / `isTaskGroupCollapsed()` / `syncCollapsedTaskGroups()`
  - 渲染结构：`button.ioto-tasks-center__task-group-header` + `div.ioto-tasks-center__task-group-body`
  - 参见： [iotoTasksCenterView.ts:L679-L740](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts#L679-L740)
- 样式中已有任务分组折叠相关 class：
  - `.ioto-tasks-center__task-group`, `.is-collapsed`, `.is-expanded`, `.ioto-tasks-center__task-group-body.is-hidden`
  - 项目分组当前只有 `.ioto-tasks-center__project-group-header` 的基础样式：[styles.css](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css)

## Proposed Changes

### 1) 新增项目分组折叠状态与同步逻辑

修改文件： [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

- 新增字段：
  - `private readonly collapsedProjectGroups = new Set<string>();`
- 新增方法（仿照任务分组实现）：
  - `private isProjectGroupCollapsed(groupKey: string): boolean`
  - `private toggleProjectGroupCollapsed(groupKey: string): void`（切换后 `this.render()`）
  - `private syncCollapsedProjectGroups(sections: Array<{ groupKey: string }>): void`
    - 当 `projectListGroupMode === 'none'`：`collapsedProjectGroups.clear()`
    - 当 `projectListGroupMode === 'category'`：只保留仍存在的 groupKey

### 2) 调整项目列表分组渲染结构（header + body）

修改文件： [iotoTasksCenterView.ts](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/src/views/iotoTasksCenterView.ts)

当前结构（简化）：

- listEl
  - `div.project-group-header`（仅 category 模式）
  - 若干 `button.project-item`

改为（对齐任务分组结构）：

- listEl
  - `div.ioto-tasks-center__project-group`（每个 section 一个）
    - `button.ioto-tasks-center__project-group-header`（仅 category 模式）
      - `span ...-icon`（chevron-right）
      - `span ...-label`（分类名或“未设置分类”）
      - `span ...-count`（该组项目数）
    - `div.ioto-tasks-center__project-group-body`（包含该组项目 item）
      - 若干 `button.project-item`

交互与无障碍属性：

- header 按钮：
  - `aria-expanded` / `aria-controls`（body id）
  - `ariaLabel/title` 复用已有 `view.group.expand` / `view.group.collapse`（传入分组 label）
- 折叠时：
  - group container 加 `is-collapsed` / `is-expanded`
  - body 加 `is-hidden` 并跳过渲染项目 item

body id 生成：

- 使用稳定、安全的 id：`ioto-tasks-center-project-group-${encodeURIComponent(groupKey || 'uncategorized').replace(/%/g, '_')}`

### 3) 样式补齐（项目分组 header/body）

修改文件： [styles.css](file:///Users/johnnylearns/Documents/Sync/IOTO-Plugins/.obsidian/plugins/ioto-tasks-center/styles.css)

- 新增/调整样式（尽量复用任务分组视觉）：
  - `.ioto-tasks-center__project-group` 容器
  - `.ioto-tasks-center__project-group-header`（button，hover/选中态）
  - `.ioto-tasks-center__project-group-header-icon`（chevron 旋转跟随 is-expanded）
  - `.ioto-tasks-center__project-group-header-label`
  - `.ioto-tasks-center__project-group-header-count`
  - `.ioto-tasks-center__project-group-body` + `.is-hidden`
- 保留现有 `.ioto-tasks-center__project-group-header`（div）样式迁移到新 button class，避免 UI 退化

### 4) 测试与验证

本次改动主要是 UI 交互，单元测试价值有限；保持最小验证：

- `npm test`
- `npm run build`
- Obsidian 手工验收：
  - 启用 **按项目分类分组**
  - 点击任意分类标题：项目列表内容可折叠/展开
  - 折叠某组后点击 slider 切换排序：折叠状态仍保持（只要分组仍为 category）
  - 切换分组为“不分组”：所有折叠状态清空

## Assumptions & Decisions

- 默认所有分组为展开状态（与任务列表分组一致）
- 折叠状态不写入 settings（与任务分组折叠一致），只在当前 view 生命周期内保持

